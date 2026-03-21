# bun-serve-compress

Transparent HTTP response compression for `Bun.serve()` — gzip, brotli, and zstd.

A drop-in replacement for `Bun.serve()` that automatically compresses responses based on the client's `Accept-Encoding` header. No middleware, no configuration required — just swap the import.

## Why?

Bun.serve() has no built-in response compression ([oven-sh/bun#2726](https://github.com/oven-sh/bun/issues/2726)). This library fills that gap with:

- **Smart algorithm negotiation** — prefers zstd > brotli > gzip by default, respecting client `Accept-Encoding` quality weights
- **Automatic skip logic** — images, fonts, video, already-compressed responses, small bodies, SSE, and `Cache-Control: no-transform` are never compressed
- **Sane defaults** — brotli quality 5 (not 11, which is [~30x slower](https://cran.r-project.org/web/packages/brotli/vignettes/benchmarks.html)), gzip level 6, zstd level 3
- **Zero config** — works out of the box, but fully customizable
- **Bun-native** — uses `Bun.gzipSync()`, `Bun.zstdCompressSync()`, and `CompressionStream` for maximum performance; `node:zlib` brotliCompressSync for brotli (Bun has no native `Bun.brotliCompressSync()` yet)
- **HTTP spec compliant** — correct `Vary`, `Content-Encoding`, `Content-Length`, ETag, and `Cache-Control: no-transform` handling

## Install

```bash
bun add bun-serve-compress
```

## Quick Start

```typescript
import { serve } from "bun-serve-compress";

serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello, World!");
  },
});
```

That's it. Responses are now compressed automatically.

## Usage with Routes

Works with Bun's route handlers, including HTML imports:

```typescript
import { serve } from "bun-serve-compress";
import homepage from "./index.html";

serve({
  port: 3000,
  routes: {
    "/": homepage, // Bun's HTML bundling works transparently
    "/api/data": () => Response.json({ message: "compressed automatically" }),
    "/health": {
      GET: () => new Response("ok"),
    },
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});
```

## Elysia

```typescript
import { Elysia } from "elysia";
import { compress } from "bun-serve-compress/elysia";

new Elysia()
  .use(compress()) // applies globally to all routes
  .get("/", () => "Hello, World!")
  .get("/api/data", () => Response.json({ items: [1, 2, 3] }))
  .listen(3000);
```

Uses Elysia's `mapResponse` lifecycle hook. Applied globally by default — works across all routes including nested plugins.

## Hono

```typescript
import { Hono } from "hono";
import { compress } from "bun-serve-compress/hono";

const app = new Hono();

// Global — all routes
app.use(compress());

// Or per-route
app.use("/api/*", compress({ algorithms: ["br", "gzip"] }));

app.get("/", (c) => c.text("Hello, World!"));

export default app;
```

Uses Hono's middleware pattern with `await next()` to compress responses after handlers execute.

## Configuration

Pass a `compression` option to customize behavior:

```typescript
import { serve } from "bun-serve-compress";

serve({
  port: 3000,
  compression: {
    // Algorithm preference order (default: ['zstd', 'br', 'gzip'])
    algorithms: ["br", "gzip"],

    // Minimum body size in bytes to compress (default: 1024)
    minSize: 512,

    // Per-algorithm settings
    gzip: { level: 6 }, // 1-9 (default: 6)
    brotli: { level: 5 }, // 0-11 (default: 5)
    zstd: { level: 3 }, // 1-22 (default: 3)

    // Additional MIME types to skip (merged with built-in list)
    skipMimeTypes: ["application/x-custom-binary"],

    // OR: override the entire skip list (replaces built-in list completely)
    // overrideSkipMimeTypes: ["image/png", "application/zip"],

    // Custom skip function (called after all other skip checks pass)
    shouldCompress: (req, res) => {
      // Return false to skip compression for this request/response
      return !req.url.includes("/raw/");
    },
  },
  fetch(req) {
    return new Response("Hello!");
  },
});
```

### Disable compression entirely

```typescript
// Option 1: compression: false
serve({
  compression: false,
  // ...
});

// Option 2: compression.disable
serve({
  compression: { disable: true },
  // ...
});
```

## What gets compressed?

### Compressed (by default)

- `text/*` (HTML, CSS, plain text, etc.)
- `application/json`
- `application/javascript`
- `application/xml`
- `image/svg+xml` (exception to image/\* skip — SVG is text-based)
- Any response over 1KB without a matching skip rule

### Skipped (by default)

**By MIME type (prefix match):**

- `image/*` (except `image/svg+xml`)
- `audio/*`
- `video/*`
- `font/*`

**By MIME type (exact match):**

- `application/zip`, `application/gzip`, `application/x-gzip`
- `application/x-bzip2`, `application/x-7z-compressed`, `application/x-rar-compressed`
- `application/wasm`
- `application/octet-stream`
- `application/pdf`
- `text/event-stream` (SSE — compression breaks chunked event delivery)

**By HTTP semantics:**

- Responses with existing `Content-Encoding` header (already compressed)
- Responses with `Transfer-Encoding` containing a compression algorithm (gzip, deflate, br, zstd) — `Transfer-Encoding: chunked` alone does NOT skip
- Responses with `Cache-Control: no-transform` (RFC 7234 §5.2.2.4 — intermediaries MUST NOT alter the representation)
- Responses smaller than `minSize` (default: 1024 bytes)
- Responses with no body (`null` body)
- `204 No Content`, `304 Not Modified`, `101 Switching Protocols`
- `HEAD` requests

## HTTP Correctness

The library handles HTTP semantics properly:

- **`Content-Encoding`** is set to the chosen algorithm (`gzip`, `br`, or `zstd`)
- **`Content-Length`** is updated to the compressed size (sync path) or removed (streaming path)
- **`Vary: Accept-Encoding`** is appended when compression is considered — whether the response is compressed or not (for correct cache behavior). It is not added when compression is skipped entirely (e.g., images, HEAD requests)
- **Strong ETags** are converted to weak ETags (`"abc"` → `W/"abc"`) when compressing, per RFC 7232 — the compressed body is a different representation
- **Weak ETags** are preserved as-is (already weak)
- **`Cache-Control: no-transform`** is respected — responses are passed through unmodified per RFC 7234
- **Already-compressed responses** are never double-compressed (checked via `Content-Encoding` and `Transfer-Encoding` headers)
- **Status codes** are preserved through compression (200, 201, 404, 500, etc.)
- **Custom headers** are preserved through compression (X-Request-Id, etc.)

## Algorithm Negotiation

The library parses the client's `Accept-Encoding` header and selects the best algorithm:

1. Parse each algorithm and its quality value (`q=`) from the header
2. Filter to only algorithms the server supports (configurable via `algorithms` option)
3. Handle wildcard `*` — gives unlisted supported algorithms the wildcard quality
4. Handle `identity` — not a compression algorithm, ignored
5. Handle `q=0` — explicit rejection of an algorithm
6. Sort by client quality descending, then by server preference order as tiebreaker
7. Return the best match, or `null` if no acceptable algorithm found

Case-insensitive matching is supported (`GZIP`, `GZip`, `gzip` all work).

## Compression Paths

| Body type         | Strategy                                  | When                                                                              |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Known size ≤ 10MB | Sync compression (`Bun.gzipSync`, etc.)   | Fastest path for typical responses                                                |
| Unknown size      | Buffer → check minSize → sync compression | Catches small bodies without `Content-Length` (e.g., static `Response` in routes) |
| Known size > 10MB | `CompressionStream` streaming             | Avoids buffering entire body in memory                                            |

### Sync compression details

| Algorithm | Implementation                                          | Notes                                            |
| --------- | ------------------------------------------------------- | ------------------------------------------------ |
| gzip      | `Bun.gzipSync(data, { level })`                         | Native Bun API                                   |
| brotli    | `brotliCompressSync(data, { params })` from `node:zlib` | Bun has no native `Bun.brotliCompressSync()` yet |
| zstd      | `Bun.zstdCompressSync(data, { level })`                 | Native Bun API                                   |

### Streaming compression details

All three algorithms use `CompressionStream` with Bun's extended format support:

- gzip → `new CompressionStream("gzip")`
- brotli → `new CompressionStream("brotli")` (Bun extension, not in Web standard)
- zstd → `new CompressionStream("zstd")` (Bun extension, not in Web standard)

## Route Type Support

The library handles all Bun.serve() route value types:

| Route value                                    | Behavior                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Response` object                              | Cloned and compressed per request (note: loses Bun's static route fast path — see [Known Limitations](#known-limitations)) |
| Handler function `(req) => Response`           | Wrapped — response is compressed after handler returns                                                                     |
| Method object `{ GET: fn, POST: fn }`          | Each method handler is wrapped individually                                                                                |
| HTML import (`import page from './page.html'`) | Passed through to Bun's bundler pipeline untouched                                                                         |
| `false`                                        | Passed through — Bun falls through to the `fetch` handler                                                                  |
| `null` / `undefined`                           | Passed through as-is                                                                                                       |

## Exported Utilities

The library exports its internal utilities for advanced use cases:

```typescript
import {
  serve, // Drop-in Bun.serve() replacement
  negotiate, // Parse Accept-Encoding → best algorithm
  shouldSkip, // Check if compression should be skipped
  compress, // Compress a Response object
  addVaryHeader, // Add Vary: Accept-Encoding to a Response
} from "bun-serve-compress";

// Types
import type {
  CompressionAlgorithm, // "zstd" | "br" | "gzip"
  CompressionOptions, // User-facing config
  AlgorithmOptions, // Per-algorithm { level } config
  ResolvedCompressionOptions, // Fully resolved config with defaults
} from "bun-serve-compress";
```

## Testing

234 tests covering negotiation, skip logic, compression integrity, HTTP semantics, concurrency, large body integrity, Bun-specific compatibility, Elysia plugin, and Hono middleware. Run with:

```bash
bun test
```

### Test suite inspirations

The test suite was designed by studying the test suites of established HTTP compression implementations to ensure comprehensive coverage:

| Library / Server             | What we learned                                                                                                                                                   | Link                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Express/compression**      | `Cache-Control: no-transform` (RFC 7234), Vary header semantics, ETag weak/strong handling, threshold behavior, empty body edge cases, quality weight negotiation | [test/compression.js](https://github.com/expressjs/compression/blob/master/test/compression.js)                                                                            |
| **Fastify/fastify-compress** | Case-insensitive Accept-Encoding, Content-Type with charset/boundary params, missing Content-Type, custom header preservation, algorithm restriction              | [test/global-compress.test.js](https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js)                                                       |
| **Koa/compress**             | Unknown algorithm handling (sdch), custom shouldCompress, SVG exception for image/\* skip, default/fallback encoding                                              | [test/index.test.ts](https://github.com/koajs/compress/blob/master/test/index.test.ts)                                                                                     |
| **Go net/http gziphandler**  | Threshold boundary conditions (exact size, off-by-one), parallel compression benchmarks, large body integrity, Accept-Encoding: identity                          | [gzip_test.go](https://github.com/nytimes/gziphandler/blob/master/gzip_test.go)                                                                                            |
| **Nginx gzip module**        | Transfer-Encoding already set, MIME type prefix matching, no-transform directive                                                                                  | [ngx_http_gzip_module docs](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)                                                                                      |
| **Hono compress**            | Cache-Control no-transform, Transfer-Encoding checks, identity encoding handling                                                                                  | [compress/index.test.ts](https://github.com/honojs/hono/blob/main/src/middleware/compress/index.test.ts)                                                                   |
| **Bun test suite**           | Static route cloning, fetch auto-decompression, CompressionStream formats, empty body regression, double-compression prevention                                   | [test/regression/issue/](https://github.com/oven-sh/bun/tree/main/test/regression/issue), [test/js/web/fetch/](https://github.com/oven-sh/bun/tree/main/test/js/web/fetch) |

Each test file includes a detailed header comment documenting which specific test cases came from which source.

## Known Limitations

### Static route performance trade-off

When using static `Response` objects in routes (e.g., `"/": new Response("hello")`), Bun normally serves them via an optimized fast path that bypasses the JS event loop entirely. This library converts static routes into handler functions (to clone and compress per-request), which loses that optimization. For most applications this is negligible — the compression savings far outweigh the routing overhead.

### Future Bun auto-compression

Bun's HTTP server has a [TODO comment](https://github.com/oven-sh/bun/issues/2726) to add built-in compression. If/when Bun adds native auto-compression to `Bun.serve()`, this library could cause double-compression. We will update the library to detect and respect any future Bun compression flag. Monitor issue [#2726](https://github.com/oven-sh/bun/issues/2726) for updates.

### Bun's fetch() auto-decompression

Bun's `fetch()` client **automatically decompresses** responses and **strips the `Content-Encoding` header**. If you need to verify compression is working in your own tests or debugging, use `fetch(url, { decompress: false })` — this is a Bun-specific option that preserves the raw compressed response.

### Streaming compression quality

The `CompressionStream` API (used for bodies > 10MB) does not accept quality/level parameters for all formats. For the sync path (≤ 10MB), compression levels are fully configurable. For most real-world responses, the sync path is used.

## Requirements

- **Bun ≥ 1.3.3** (for `CompressionStream` with zstd support)

The library checks `Bun.version` on import and throws a clear error if the runtime is unsupported:

```
bun-serve-compress requires Bun >= 1.3.3, but you are running Bun 1.2.0. Please upgrade Bun: bun upgrade
```

If loaded outside of Bun (e.g., Node.js), it throws:

```
bun-serve-compress requires the Bun runtime. This library uses Bun-specific APIs (Bun.serve, Bun.gzipSync, CompressionStream with zstd) and cannot run in Node.js or other runtimes.
```

## License

MIT
