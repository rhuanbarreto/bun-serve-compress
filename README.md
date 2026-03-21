# bun-serve-compress

Transparent HTTP response compression for `Bun.serve()` — gzip, brotli, and zstd.

A drop-in replacement for `Bun.serve()` that automatically compresses responses based on the client's `Accept-Encoding` header. No middleware, no configuration required — just swap the import.

## Why?

Bun.serve() has no built-in response compression ([oven-sh/bun#2726](https://github.com/oven-sh/bun/issues/2726)). This library fills that gap with:

- **Smart algorithm negotiation** — zstd > brotli > gzip, respecting client `Accept-Encoding` quality weights
- **Automatic skip logic** — images, fonts, video, already-compressed responses, small bodies, and SSE are never compressed
- **Sane defaults** — brotli quality 5 (not 11, which is 30x slower), gzip level 6, zstd level 3
- **Zero config** — works out of the box, but fully customizable
- **Bun-native** — uses `Bun.gzipSync()`, `Bun.zstdCompressSync()`, and `CompressionStream` for maximum performance

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
    "/api/data": () =>
      Response.json({ message: "compressed automatically" }),
    "/health": {
      GET: () => new Response("ok"),
    },
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});
```

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
    gzip: { level: 6 },    // 1-9 (default: 6)
    brotli: { level: 5 },  // 0-11 (default: 5)
    zstd: { level: 3 },    // 1-22 (default: 3)

    // Additional MIME types to skip (merged with built-in list)
    skipMimeTypes: ["application/x-custom-binary"],

    // Custom skip function
    shouldCompress: (req, res) => {
      // Return false to skip compression for this request
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
serve({
  compression: false,
  // ...
});
```

## What gets compressed?

### Compressed (by default)

- `text/*` (HTML, CSS, plain text, etc.)
- `application/json`
- `application/javascript`
- `application/xml`
- `image/svg+xml`
- Any response over 1KB without a matching skip rule

### Skipped (by default)

- Images (`image/*`, except SVG)
- Audio (`audio/*`)
- Video (`video/*`)
- Fonts (`font/*`)
- Archives (`application/zip`, `application/gzip`, etc.)
- WebAssembly (`application/wasm`)
- PDFs (`application/pdf`)
- Server-Sent Events (`text/event-stream`)
- Responses with existing `Content-Encoding`
- Responses smaller than `minSize` (default: 1KB)
- `204 No Content`, `304 Not Modified`, `101 Switching Protocols`
- `HEAD` requests

## HTTP Correctness

The library handles HTTP semantics properly:

- **`Content-Encoding`** header is set to the chosen algorithm
- **`Content-Length`** is updated after compression (sync) or removed (streaming)
- **`Vary: Accept-Encoding`** is appended to all responses (compressed or not)
- **Strong ETags** are converted to weak ETags when compressing (spec-compliant)
- **Already-compressed responses** are never double-compressed

## Compression Paths

| Body type | Strategy | When |
|-----------|----------|------|
| Buffered (known size ≤ 10MB) | Sync compression | Fastest for typical responses |
| Buffered (unknown size) | Buffer → check minSize → sync | Catches small bodies without Content-Length |
| Streaming (known size > 10MB) | `CompressionStream` | Avoids memory spikes for large responses |

## Testing

191 tests covering negotiation, skip logic, compression integrity, HTTP semantics, concurrency, and Bun-specific features. Run with:

```bash
bun test
```

### Test suite inspirations

The test suite was designed by studying the test suites of established HTTP compression implementations to ensure comprehensive coverage:

| Library / Server | What we learned | Link |
|-----------------|----------------|------|
| **Express/compression** | `Cache-Control: no-transform` (RFC 7234), Vary header semantics, ETag weak/strong handling, threshold behavior, empty body edge cases, quality weight negotiation | [test/compression.js](https://github.com/expressjs/compression/blob/master/test/compression.js) |
| **Fastify/fastify-compress** | Case-insensitive Accept-Encoding, Content-Type with charset/boundary params, missing Content-Type, custom header preservation, algorithm restriction | [test/global-compress.test.js](https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js) |
| **Koa/compress** | Unknown algorithm handling (sdch), custom shouldCompress, SVG exception for image/* skip, default/fallback encoding | [test/index.test.ts](https://github.com/koajs/compress/blob/master/test/index.test.ts) |
| **Go net/http gziphandler** | Threshold boundary conditions (exact size, off-by-one), parallel compression benchmarks, large body integrity, Accept-Encoding: identity | [gzip_test.go](https://github.com/nytimes/gziphandler/blob/master/gzip_test.go) |
| **Nginx gzip module** | Transfer-Encoding already set, MIME type prefix matching, no-transform directive | [ngx_http_gzip_module docs](https://nginx.org/en/docs/http/ngx_http_gzip_module.html) |
| **Hono compress** | Cache-Control no-transform, Transfer-Encoding checks, identity encoding handling | [compress/index.test.ts](https://github.com/honojs/hono/blob/main/src/middleware/compress/index.test.ts) |

Each test file includes a detailed header comment documenting which specific test cases came from which source.

Additionally, the test suite was validated against **Bun's own compression test suite** (`test/js/web/fetch/`, `test/regression/issue/`) to ensure compatibility with Bun's internal HTTP and compression behavior.

## Known Limitations

### Static route performance trade-off

When using static `Response` objects in routes (e.g., `"/": new Response("hello")`), Bun normally serves them via an optimized fast path that bypasses the JS event loop entirely. This library converts static routes into handler functions (to clone and compress per-request), which loses that optimization. For most applications this is negligible — the compression savings far outweigh the routing overhead.

### Future Bun auto-compression

Bun's HTTP server has a [TODO comment](https://github.com/oven-sh/bun/issues/2726) to add built-in compression. If/when Bun adds native auto-compression to `Bun.serve()`, this library could cause double-compression. We will update the library to detect and respect any future Bun compression flag. Monitor issue [#2726](https://github.com/oven-sh/bun/issues/2726) for updates.

### Bun's fetch() auto-decompression

Bun's `fetch()` client **automatically decompresses** responses and **strips the `Content-Encoding` header**. If you need to verify compression is working in your own tests or debugging, use `fetch(url, { decompress: false })` — this is a Bun-specific option that preserves the raw compressed response.

## Requirements

- **Bun ≥ 1.3.3** (for `CompressionStream` with zstd support)

## License

MIT
