import { compress, addVaryHeader } from "./compress";
import { resolveConfig } from "./config";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type { ResolvedCompressionOptions, ServeCompressOptions } from "./types";

/**
 * Minimum supported Bun version (semver range).
 * Requires Bun >= 1.3.3 for CompressionStream with zstd support.
 */
const MIN_BUN_VERSION_RANGE = ">=1.3.3";
const MIN_BUN_VERSION_DISPLAY = "1.3.3";

/**
 * Check that the current Bun version meets the minimum requirement.
 * Uses Bun's built-in semver utility for reliable version comparison.
 * Throws a clear error if not.
 */
function checkBunVersion(): void {
  if (typeof Bun === "undefined" || !Bun.version) {
    throw new Error(
      "bun-serve-compress requires the Bun runtime. " +
        "This library uses Bun-specific APIs (Bun.serve, Bun.gzipSync, CompressionStream with zstd) " +
        "and cannot run in Node.js or other runtimes.",
    );
  }

  if (!Bun.semver.satisfies(Bun.version, MIN_BUN_VERSION_RANGE)) {
    throw new Error(
      `bun-serve-compress requires Bun >= ${MIN_BUN_VERSION_DISPLAY}, but you are running Bun ${Bun.version}. ` +
        "Please upgrade Bun: bun upgrade",
    );
  }
}

// Run version check on module load
checkBunVersion();

// --- Internal types for runtime handler wrapping ---

/**
 * A fetch handler function matching Bun.serve()'s fetch signature.
 * Generic over WebSocketData to preserve the server's type through wrapping.
 */
type FetchHandler<WS> = (
  this: Bun.Server<WS>,
  req: Request,
  server: Bun.Server<WS>,
) => Response | void | undefined | Promise<Response | void | undefined>;

/**
 * A route handler function (path type erased — used internally after iterating routes).
 */
type RouteHandlerFn<WS> = (
  req: Request,
  server: Bun.Server<WS>,
) => Response | void | undefined | Promise<Response | void | undefined>;

/**
 * All possible values a single route entry can hold at runtime.
 * Matches Bun's route value types with path type erased for internal wrapping.
 */
type RouteValue<WS> =
  | Response
  | false
  | Bun.HTMLBundle
  | Bun.BunFile
  | RouteHandlerFn<WS>
  | Partial<Record<string, RouteHandlerFn<WS> | Response>>
  | null
  | undefined;

/**
 * Mutable view of the serve options we need to wrap.
 * Isolates the properties we modify (fetch, routes) while preserving
 * all other Bun.serve() options via the base options type.
 */
interface WrapTarget<WS> extends Bun.Serve.BaseServeOptions<WS> {
  fetch?: FetchHandler<WS>;
  routes?: Record<string, RouteValue<WS>>;
  [key: string]: WrapTarget<WS>[keyof Bun.Serve.BaseServeOptions<WS>]
    | FetchHandler<WS>
    | Record<string, RouteValue<WS>>
    | string
    | number
    | boolean
    | object
    | undefined;
}

const HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
]);

/**
 * The compression middleware logic applied to each response.
 */
function compressResponse(
  req: Request,
  res: Response,
  config: ResolvedCompressionOptions,
): Response | Promise<Response> {
  // Check if compression should be skipped
  if (shouldSkip(req, res, config)) {
    return res;
  }

  // Negotiate the best algorithm
  const acceptEncoding = req.headers.get("accept-encoding") ?? "";
  const algorithm = negotiate(acceptEncoding, config.algorithms);

  if (!algorithm) {
    // No acceptable algorithm, but add Vary header for caching
    return addVaryHeader(res);
  }

  // Compress the response
  return compress(res, algorithm, config);
}

/**
 * Wrap a fetch handler to add compression.
 */
function wrapFetch<WS>(
  originalFetch: FetchHandler<WS>,
  config: ResolvedCompressionOptions,
): FetchHandler<WS> {
  return async function (this: Bun.Server<WS>, req: Request, server: Bun.Server<WS>) {
    const response = await originalFetch.call(this, req, server);

    // WebSocket upgrade or void return — pass through
    if (!response) return response;

    return compressResponse(req, response, config);
  };
}

/**
 * Wrap route handlers to add compression.
 *
 * Routes can be:
 * - Response objects (static)
 * - Handler functions (req => Response)
 * - HTML imports (special Bun objects — pass through untouched)
 * - Method-specific objects { GET: handler, POST: handler }
 */
function wrapRoutes<WS>(
  routes: Record<string, RouteValue<WS>>,
  config: ResolvedCompressionOptions,
): Record<string, RouteValue<WS>> {
  const wrapped: Record<string, RouteValue<WS>> = {};

  for (const [path, handler] of Object.entries(routes)) {
    wrapped[path] = wrapRouteHandler(handler, config);
  }

  return wrapped;
}

/**
 * Wrap a single route handler.
 */
function wrapRouteHandler<WS>(
  handler: RouteValue<WS>,
  config: ResolvedCompressionOptions,
): RouteValue<WS> {
  // false: Bun falls through to the fetch handler. Pass through as-is.
  // null/undefined: no handler. Pass through as-is.
  if (handler === false || handler === null || handler === undefined) {
    return handler;
  }

  // HTML import — Bun handles these specially for frontend bundling.
  // They are objects with specific internal properties that Bun's serve recognizes.
  // We must NOT wrap these — let Bun handle them natively.
  if (isHtmlImport(handler)) {
    return handler;
  }

  // Response object (static route) — wrap in a function that clones and compresses per request
  if (handler instanceof Response) {
    return function (req: Request) {
      const cloned = handler.clone();
      return compressResponse(req, cloned, config);
    };
  }

  // Handler function
  if (typeof handler === "function") {
    return async function (this: Bun.Server<WS>, req: Request, server: Bun.Server<WS>) {
      const response = await handler.call(this, req, server);
      if (!response) return response;
      return compressResponse(req, response, config);
    };
  }

  // Method-specific object: { GET: handler, POST: handler, ... }
  if (typeof handler === "object" && !Array.isArray(handler)) {
    const handlerObj = handler as Record<string, RouteValue<WS>>;
    const hasMethodKey = Object.keys(handlerObj).some((key) => HTTP_METHODS.has(key.toUpperCase()));

    if (hasMethodKey) {
      const wrappedMethods: Partial<Record<string, RouteHandlerFn<WS> | Response>> = {};
      for (const [method, methodHandler] of Object.entries(handlerObj)) {
        wrappedMethods[method] = wrapRouteHandler(methodHandler, config) as
          | RouteHandlerFn<WS>
          | Response;
      }
      return wrappedMethods;
    }
  }

  // Unknown type — pass through unchanged (let Bun handle or error)
  return handler;
}

/**
 * Detect if a route handler is an HTML import (Bun's frontend bundling feature).
 *
 * When you do `import page from './page.html'` in Bun, it creates a special
 * module object that Bun.serve() recognizes for its built-in bundler pipeline.
 * These are NOT Response objects or functions — they're opaque module objects.
 *
 * We must pass these through untouched so Bun's asset pipeline works correctly.
 */
function isHtmlImport<WS>(handler: RouteValue<WS>): handler is Bun.HTMLBundle {
  // HTML imports are not Response, not Function, not null/undefined
  // They are objects that Bun's serve() knows how to handle internally.
  if (typeof handler !== "object") return false;
  if (handler === null) return false;
  if (handler instanceof Response) return false;
  if (handler instanceof ReadableStream) return false;
  if (Array.isArray(handler)) return false;

  // A method-specific handler would have HTTP method keys (GET, POST, etc.)
  // HTML imports are objects without those keys.
  const keys = Object.keys(handler);
  const hasMethodKey = keys.some((key) => HTTP_METHODS.has(key.toUpperCase()));
  if (hasMethodKey) return false;

  // If it's an object without HTTP method keys, it's likely an HTML import
  // or some other Bun-specific handler — pass through
  return true;
}

/**
 * Drop-in replacement for Bun.serve() that adds transparent response compression.
 *
 * Usage:
 * ```ts
 * import { serve } from 'bun-serve-compress';
 *
 * serve({
 *   port: 3000,
 *   compression: { algorithms: ['zstd', 'br', 'gzip'] },
 *   fetch(req) {
 *     return new Response('Hello!');
 *   },
 * });
 * ```
 */
export function serve<WebSocketData = undefined, R extends string = string>(
  options: ServeCompressOptions<WebSocketData, R>,
): Bun.Server<WebSocketData> {
  // Extract compression config, leaving Bun.serve() options
  const { compression, ...serveOptions } = options;

  // Resolve config with defaults
  const config = resolveConfig(compression);

  // View the options as a mutable object with typed fetch/routes properties.
  // This cast is safe: serveOptions contains all Bun.serve() properties
  // (the only removed key is `compression` which Bun doesn't know about).
  const wrapped = { ...serveOptions } as WrapTarget<WebSocketData>;

  // If compression is disabled, just pass through to Bun.serve
  if (config.disable) {
    return Bun.serve(wrapped as Bun.Serve.Options<WebSocketData, string>);
  }

  // Wrap fetch handler if present
  if (wrapped.fetch) {
    wrapped.fetch = wrapFetch(wrapped.fetch, config);
  }

  // Wrap routes if present
  if (wrapped.routes) {
    wrapped.routes = wrapRoutes(wrapped.routes, config);
  }

  // Cast to Bun.Serve.Options with erased route paths (string) because
  // the wrapped handlers lose path-specific BunRequest<Path> generics.
  return Bun.serve(wrapped as Bun.Serve.Options<WebSocketData, string>);
}
