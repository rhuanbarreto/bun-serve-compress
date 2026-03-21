import {
  getDefaultResolvedConfig,
  SKIP_MIME_PREFIXES,
  SKIP_MIME_TYPES,
} from "./constants";
import { compress, addVaryHeader } from "./compress";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type {
  CompressionOptions,
  ResolvedCompressionOptions,
} from "./types";

/**
 * Resolve user-provided compression options into a fully-populated config
 * with all defaults applied.
 */
function resolveConfig(
  options?: CompressionOptions | false,
): ResolvedCompressionOptions {
  const defaults = getDefaultResolvedConfig();

  if (options === false || options?.disable) {
    return { ...defaults, disable: true };
  }

  if (!options) return defaults;

  const config: ResolvedCompressionOptions = {
    disable: false,
    algorithms: options.algorithms ?? defaults.algorithms,
    gzip: { level: options.gzip?.level ?? defaults.gzip.level },
    brotli: { level: options.brotli?.level ?? defaults.brotli.level },
    zstd: { level: options.zstd?.level ?? defaults.zstd.level },
    minSize: options.minSize ?? defaults.minSize,
    skipMimeTypes: defaults.skipMimeTypes,
    skipMimePrefixes: defaults.skipMimePrefixes,
    shouldCompress: options.shouldCompress,
  };

  // Handle custom skip MIME types
  if (options.overrideSkipMimeTypes) {
    config.skipMimeTypes = new Set(options.overrideSkipMimeTypes);
    config.skipMimePrefixes = []; // user took full control
  } else if (options.skipMimeTypes) {
    // Merge with defaults
    config.skipMimeTypes = new Set([...SKIP_MIME_TYPES, ...options.skipMimeTypes]);
  }

  return config;
}

/**
 * The compression middleware logic applied to each response.
 */
async function compressResponse(
  req: Request,
  res: Response,
  config: ResolvedCompressionOptions,
): Promise<Response> {
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
function wrapFetch(
  originalFetch: Function,
  config: ResolvedCompressionOptions,
): Function {
  return async function (this: any, req: Request, server: any) {
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
function wrapRoutes(
  routes: Record<string, any>,
  config: ResolvedCompressionOptions,
): Record<string, any> {
  const wrapped: Record<string, any> = {};

  for (const [path, handler] of Object.entries(routes)) {
    wrapped[path] = wrapRouteHandler(handler, config);
  }

  return wrapped;
}

/**
 * Wrap a single route handler.
 */
function wrapRouteHandler(handler: any, config: ResolvedCompressionOptions): any {
  // false: Bun falls through to the fetch handler. Pass through as-is.
  // null/undefined: no handler. Pass through as-is.
  if (handler === false || handler === null || handler === undefined) {
    return handler;
  }

  // HTML import — Bun handles these specially for frontend bundling.
  // They are objects with specific internal properties that Bun's serve recognizes.
  // We must NOT wrap these — let Bun handle them natively.
  // HTML imports are typically objects (not Response, not Function) that Bun processes
  // into its asset pipeline. We detect them by checking they're not a standard type.
  if (isHtmlImport(handler)) {
    return handler;
  }

  // Response object (static route) — wrap in a function that clones and compresses per request
  if (handler instanceof Response) {
    return async function (req: Request) {
      const cloned = handler.clone();
      return compressResponse(req, cloned, config);
    };
  }

  // Handler function
  if (typeof handler === "function") {
    return async function (this: any, req: Request, server: any) {
      const response = await handler.call(this, req, server);
      if (!response) return response;
      return compressResponse(req, response, config);
    };
  }

  // Method-specific object: { GET: handler, POST: handler, ... }
  if (typeof handler === "object" && !Array.isArray(handler)) {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    const hasMethodKey = Object.keys(handler).some((key) =>
      methods.includes(key.toUpperCase()),
    );

    if (hasMethodKey) {
      const wrappedMethods: Record<string, any> = {};
      for (const [method, methodHandler] of Object.entries(handler)) {
        wrappedMethods[method] = wrapRouteHandler(methodHandler, config);
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
function isHtmlImport(handler: any): boolean {
  // HTML imports are not Response, not Function, not null/undefined
  // They are objects that Bun's serve() knows how to handle internally.
  // The safest detection: it's an object with a default export or
  // is a module namespace object from an HTML import.
  if (typeof handler !== "object") return false;
  if (handler instanceof Response) return false;
  if (handler instanceof ReadableStream) return false;
  if (Array.isArray(handler)) return false;

  // Check for Bun's HTML module marker
  // HTML imports have a specific shape — they're typically the module itself
  // with properties that Bun uses internally for bundling
  // A method-specific handler would have HTTP method keys (GET, POST, etc.)
  const keys = Object.keys(handler);
  const httpMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  const hasMethodKey = keys.some((key) => httpMethods.includes(key.toUpperCase()));
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
export function serve(options: any): any {
  // Extract compression config
  const { compression, ...serveOptions } = options;

  // Resolve config with defaults
  const config = resolveConfig(compression);

  // If compression is disabled, just pass through to Bun.serve
  if (config.disable) {
    return Bun.serve(serveOptions);
  }

  // Wrap fetch handler if present
  if (serveOptions.fetch) {
    serveOptions.fetch = wrapFetch(serveOptions.fetch, config);
  }

  // Wrap routes if present
  if (serveOptions.routes) {
    serveOptions.routes = wrapRoutes(serveOptions.routes, config);
  }

  return Bun.serve(serveOptions);
}
