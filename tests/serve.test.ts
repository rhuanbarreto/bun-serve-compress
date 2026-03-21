/**
 * Integration tests — full HTTP server with real requests.
 *
 * Test cases inspired by:
 *
 * - Express/compression: end-to-end compression with algorithm selection, quality weight
 *   negotiation, Cache-Control no-transform bypass, error page compression (404, 500),
 *   Vary header set even when not compressing, custom shouldCompress function
 *   https://github.com/expressjs/compression/blob/master/test/compression.js
 *
 * - Fastify/fastify-compress: algorithm restriction (only gzip configured), method-specific
 *   route handlers, case-insensitive Accept-Encoding, static route repeated serving
 *   https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js
 *
 * - Koa/compress: compression disabled flag, custom minSize threshold, algorithm
 *   fallback when requested algorithm is not configured
 *   https://github.com/koajs/compress/blob/master/test/index.test.ts
 *
 * - Hono compress: HEAD request bypass, SSE skip, SVG compression (image/* exception)
 *   https://github.com/honojs/hono/blob/main/src/middleware/compress/index.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";
import { brotliDecompressSync } from "node:zlib";

const largeBody = "Hello, World! This is test content for compression. ".repeat(100);

describe("serve() integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {
        algorithms: ["zstd", "br", "gzip"],
      },
      routes: {
        "/text": new Response(largeBody, {
          headers: { "content-type": "text/html" },
        }),
        "/json": () =>
          new Response(JSON.stringify({ data: largeBody }), {
            headers: { "content-type": "application/json" },
          }),
        "/small": new Response("tiny", {
          headers: { "content-type": "text/html" },
        }),
        "/image": new Response("fake png data", {
          headers: { "content-type": "image/png" },
        }),
        "/svg": new Response("<svg>".repeat(300), {
          headers: { "content-type": "image/svg+xml" },
        }),
        "/no-content": new Response(null, { status: 204 }),
        "/sse": new Response("data: hello\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
        "/already-compressed": new Response("pre-compressed", {
          headers: {
            "content-type": "text/html",
            "content-encoding": "gzip",
          },
        }),
        "/with-etag": new Response(largeBody, {
          headers: {
            "content-type": "text/html",
            etag: '"abc123"',
          },
        }),
        "/no-transform": new Response(largeBody, {
          headers: {
            "content-type": "text/html",
            "cache-control": "public, no-transform, max-age=300",
          },
        }),
        "/error-page": () =>
          new Response("Error: something went wrong! ".repeat(100), {
            status: 500,
            headers: { "content-type": "text/html" },
          }),
        "/not-found-page": () =>
          new Response("Page not found. ".repeat(100), {
            status: 404,
            headers: { "content-type": "text/html" },
          }),
        "/methods": {
          GET: () =>
            new Response(largeBody, {
              headers: { "content-type": "text/html" },
            }),
          POST: () =>
            new Response(JSON.stringify({ ok: true, data: largeBody }), {
              headers: { "content-type": "application/json" },
            }),
        },
        "/with-vary": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              vary: "Origin",
            },
          }),
      },
      fetch(_req) {
        return new Response("fallback: " + largeBody, {
          headers: { "content-type": "text/plain" },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  describe("algorithm selection", () => {
    test("compresses with gzip when requested", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(res.headers.get("vary")).toInclude("Accept-Encoding");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    });

    test("compresses with brotli when requested", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "br" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("br");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = brotliDecompressSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    });

    test("compresses with zstd when requested", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "zstd" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("zstd");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.zstdDecompressSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    });

    test("prefers zstd when client accepts all", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "gzip, br, zstd" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("zstd");
    });

    test("respects client quality weights", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "zstd;q=0.1, br;q=1.0, gzip;q=0.5" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("br");
    });

    test("handles case-insensitive Accept-Encoding", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "GZIP" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  });

  describe("no compression cases", () => {
    test("serves uncompressed when no Accept-Encoding", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("does not compress small responses (below minSize)", async () => {
      const res = await fetch(`${baseUrl}/small`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
      expect(await res.text()).toBe("tiny");
    });

    test("does not compress images", async () => {
      const res = await fetch(`${baseUrl}/image`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("does not compress 204 No Content", async () => {
      const res = await fetch(`${baseUrl}/no-content`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(204);
      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("does not compress SSE", async () => {
      const res = await fetch(`${baseUrl}/sse`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("does not compress already-compressed responses", async () => {
      const res = await fetch(`${baseUrl}/already-compressed`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("does not compress when Cache-Control: no-transform", async () => {
      const res = await fetch(`${baseUrl}/no-transform`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toInclude("no-transform");
    });

    test("returns uncompressed with Vary when unsupported encoding requested", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "deflate" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toInclude("Accept-Encoding");
    });
  });

  describe("compresses various content types", () => {
    test("compresses SVG (text-based image)", async () => {
      const res = await fetch(`${baseUrl}/svg`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("compresses JSON responses", async () => {
      const res = await fetch(`${baseUrl}/json`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("compresses fetch fallback handler", async () => {
      const res = await fetch(`${baseUrl}/unknown-route`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  });

  describe("error responses", () => {
    test("compresses 500 error pages", async () => {
      const res = await fetch(`${baseUrl}/error-page`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(500);
      expect(res.headers.get("content-encoding")).toBe("gzip");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      const body = new TextDecoder().decode(decompressed);
      expect(body).toInclude("Error: something went wrong!");
    });

    test("compresses 404 error pages", async () => {
      const res = await fetch(`${baseUrl}/not-found-page`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  });

  describe("header management", () => {
    test("sets Content-Length for sync-compressed responses", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      const contentLength = res.headers.get("content-length");
      expect(contentLength).not.toBeNull();
      const len = parseInt(contentLength!, 10);
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThan(largeBody.length);
    });

    test("converts strong ETag to weak when compressing", async () => {
      const res = await fetch(`${baseUrl}/with-etag`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("etag")).toBe('W/"abc123"');
    });

    test("appends to existing Vary header", async () => {
      const res = await fetch(`${baseUrl}/with-vary`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("vary")).toBe("Origin, Accept-Encoding");
    });

    test("sets Vary even when not compressing (unsupported encoding)", async () => {
      const res = await fetch(`${baseUrl}/with-vary`, {
        headers: { "accept-encoding": "deflate" },
        decompress: false,
      } as any);

      // Vary should still include Accept-Encoding for correct caching
      expect(res.headers.get("vary")).toInclude("Accept-Encoding");
    });
  });

  describe("route types", () => {
    test("handles method-specific routes (GET)", async () => {
      const getRes = await fetch(`${baseUrl}/methods`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(getRes.headers.get("content-encoding")).toBe("gzip");
      const compressed = new Uint8Array(await getRes.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    });

    test("handles method-specific routes (POST)", async () => {
      const postRes = await fetch(`${baseUrl}/methods`, {
        method: "POST",
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(postRes.headers.get("content-encoding")).toBe("gzip");
    });

    test("handles HEAD requests on routes without compression", async () => {
      const res = await fetch(`${baseUrl}/text`, {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("static Response routes serve same content on repeated requests", async () => {
      // Verify static routes can be served multiple times (cloning works)
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${baseUrl}/text`, {
            headers: { "accept-encoding": "gzip" },
            decompress: false,
          } as any).then(async (res) => {
            const compressed = new Uint8Array(await res.arrayBuffer());
            return new TextDecoder().decode(Bun.gunzipSync(compressed));
          }),
        ),
      );

      for (const body of results) {
        expect(body).toBe(largeBody);
      }
    });
  });
});

describe("serve() with compression disabled", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: false,
      fetch(_req) {
        return new Response(largeBody, {
          headers: { "content-type": "text/html" },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("does not compress when compression is false", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });
});

describe("serve() with custom config", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {
        algorithms: ["gzip"],
        minSize: 10,
        shouldCompress: (req) => {
          return !req.headers.has("x-no-compress");
        },
      },
      fetch(_req) {
        return new Response(largeBody, {
          headers: { "content-type": "text/html" },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("only uses gzip when configured", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "br, zstd, gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("does not use br when only gzip is configured", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "br" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("respects custom shouldCompress", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: {
        "accept-encoding": "gzip",
        "x-no-compress": "true",
      },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("compresses small bodies with low minSize", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });
});
