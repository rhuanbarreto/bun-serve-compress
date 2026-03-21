import { createMiddleware } from "hono/factory";
import { compress as compressResponse, addVaryHeader } from "./compress";
import { resolveConfig } from "./config";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type { CompressionOptions } from "./types";

/**
 * Hono middleware that adds transparent HTTP response compression.
 *
 * Executes after the handler via `await next()`, then compresses `c.res`.
 * Can be applied globally or to specific routes.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { compress } from "bun-serve-compress/hono";
 *
 * const app = new Hono();
 * app.use(compress());
 * app.get("/", (c) => c.text("Hello, World!"));
 *
 * export default app;
 * ```
 */
export function compress(options?: CompressionOptions) {
  const config = resolveConfig(options);

  return createMiddleware(async (c, next) => {
    // Let the handler execute first
    await next();

    const req = c.req.raw;
    const res = c.res;

    // Skip compression when appropriate
    if (shouldSkip(req, res, config)) return;

    // Negotiate the best algorithm
    const acceptEncoding = req.headers.get("accept-encoding") ?? "";
    const algorithm = negotiate(acceptEncoding, config.algorithms);

    if (!algorithm) {
      c.res = addVaryHeader(res);
      return;
    }

    // Compress the response
    c.res = await compressResponse(res, algorithm, config);
  });
}
