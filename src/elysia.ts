import { Elysia } from "elysia";
import { compress as compressResponse, addVaryHeader } from "./compress";
import { resolveConfig } from "./config";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type { CompressionOptions } from "./types";

/**
 * Elysia plugin that adds transparent HTTP response compression.
 *
 * Uses Elysia's `mapResponse` lifecycle hook to compress responses
 * after the handler executes. Applied globally by default.
 *
 * @example
 * ```ts
 * import { Elysia } from "elysia";
 * import { compress } from "bun-serve-compress/elysia";
 *
 * new Elysia()
 *   .use(compress())
 *   .get("/", () => "Hello, World!")
 *   .listen(3000);
 * ```
 */
export function compress(options?: CompressionOptions) {
  const config = resolveConfig(options);

  return new Elysia({ name: "bun-serve-compress" }).mapResponse(
    { as: "global" },
    ({ response, request }) => {
      // Only handle Response objects — Elysia may pass other types
      if (!(response instanceof Response)) return;

      // Skip compression when appropriate
      if (shouldSkip(request, response, config)) return response;

      // Negotiate the best algorithm
      const acceptEncoding = request.headers.get("accept-encoding") ?? "";
      const algorithm = negotiate(acceptEncoding, config.algorithms);

      if (!algorithm) {
        return addVaryHeader(response);
      }

      // Compress the response
      return compressResponse(response, algorithm, config);
    },
  );
}
