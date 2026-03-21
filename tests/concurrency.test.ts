/**
 * Concurrency and large body tests — parallel request handling and data integrity.
 *
 * Test cases inspired by:
 *
 * - Go net/http gziphandler: parallel compression benchmarks (2KB, 20KB, 100KB payloads
 *   run concurrently), writer pool double-close protection under concurrent access
 *   https://github.com/nytimes/gziphandler/blob/master/gzip_test.go
 *
 * - Express/compression: large body compression (1MB+), multiple write() calls
 *   accumulating to large body, hex/binary encoded data integrity
 *   https://github.com/expressjs/compression/blob/master/test/compression.js
 *
 * - Fastify/fastify-compress: concurrent requests with different content types,
 *   mixed compressed/uncompressed responses in parallel
 *   https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";
import { brotliDecompressSync } from "node:zlib";

const largeBody = "Concurrent test content. ".repeat(200);
const largeJSON = JSON.stringify({
  items: Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    description: "Lorem ipsum dolor sit amet ".repeat(10),
  })),
});

describe("concurrency", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {
        algorithms: ["zstd", "br", "gzip"],
      },
      routes: {
        "/html": () =>
          new Response(largeBody, {
            headers: { "content-type": "text/html" },
          }),
        "/json": () =>
          new Response(largeJSON, {
            headers: { "content-type": "application/json" },
          }),
        "/dynamic": (req) => {
          const url = new URL(req.url);
          const id = url.searchParams.get("id") ?? "0";
          return new Response(`Response for request ${id}: ${largeBody}`, {
            headers: { "content-type": "text/plain" },
          });
        },
      },
      fetch(_req) {
        return new Response("fallback", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("handles 50 concurrent gzip requests", async () => {
    const N = 50;
    const promises = Array.from({ length: N }, (_, i) =>
      fetch(`${baseUrl}/dynamic?id=${i}`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any).then(async (res) => {
        expect(res.headers.get("content-encoding")).toBe("gzip");
        const compressed = new Uint8Array(await res.arrayBuffer());
        const decompressed = Bun.gunzipSync(compressed);
        const text = new TextDecoder().decode(decompressed);
        expect(text).toContain(`Response for request ${i}:`);
        return text;
      }),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(N);

    // Verify each response is unique
    const unique = new Set(results);
    expect(unique.size).toBe(N);
  });

  test("handles concurrent requests with different algorithms", async () => {
    const algorithms = ["gzip", "br", "zstd"];
    const requestsPerAlgo = 20;

    const promises = algorithms.flatMap((algo) =>
      Array.from({ length: requestsPerAlgo }, () =>
        fetch(`${baseUrl}/html`, {
          headers: { "accept-encoding": algo },
          decompress: false,
        } as any).then(async (res) => {
          expect(res.headers.get("content-encoding")).toBe(algo);

          const compressed = new Uint8Array(await res.arrayBuffer());
          let decompressed: Uint8Array;

          switch (algo) {
            case "gzip":
              decompressed = Bun.gunzipSync(compressed);
              break;
            case "br":
              decompressed = brotliDecompressSync(compressed);
              break;
            case "zstd":
              decompressed = Bun.zstdDecompressSync(compressed);
              break;
            default:
              throw new Error(`Unknown algo: ${algo}`);
          }

          expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
          return algo;
        }),
      ),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(algorithms.length * requestsPerAlgo);
  });

  test("handles concurrent mix of compressible and non-compressible requests", async () => {
    const promises = Array.from({ length: 30 }, (_, i) => {
      const endpoint = i % 2 === 0 ? "/html" : "/json";
      const encoding = i % 3 === 0 ? "gzip" : i % 3 === 1 ? "br" : "zstd";

      return fetch(`${baseUrl}${endpoint}`, {
        headers: { "accept-encoding": encoding },
        decompress: false,
      } as any).then(async (res) => {
        expect(res.headers.get("content-encoding")).toBe(encoding);
        expect(res.status).toBe(200);

        // Verify integrity
        const compressed = new Uint8Array(await res.arrayBuffer());
        let decompressed: Uint8Array;
        switch (encoding) {
          case "gzip":
            decompressed = Bun.gunzipSync(compressed);
            break;
          case "br":
            decompressed = brotliDecompressSync(compressed);
            break;
          case "zstd":
            decompressed = Bun.zstdDecompressSync(compressed);
            break;
          default:
            throw new Error(`Unknown encoding: ${encoding}`);
        }

        const text = new TextDecoder().decode(decompressed);
        if (endpoint === "/html") {
          expect(text).toBe(largeBody);
        } else {
          expect(JSON.parse(text)).toHaveProperty("items");
        }
      });
    });

    await Promise.all(promises);
  });

  test("handles concurrent requests with no Accept-Encoding", async () => {
    const promises = Array.from({ length: 20 }, (_, i) => {
      const wantCompression = i % 2 === 0;

      return fetch(`${baseUrl}/html`, {
        headers: wantCompression ? { "accept-encoding": "gzip" } : { "accept-encoding": "" },
        decompress: false,
      } as any).then(async (res) => {
        if (wantCompression) {
          expect(res.headers.get("content-encoding")).toBe("gzip");
          const compressed = new Uint8Array(await res.arrayBuffer());
          const decompressed = Bun.gunzipSync(compressed);
          expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
        } else {
          expect(res.headers.get("content-encoding")).toBeNull();
          const text = await res.text();
          expect(text).toBe(largeBody);
        }
      });
    });

    await Promise.all(promises);
  });
});

describe("large body integrity", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  // 1MB body
  const oneMBBody = "x".repeat(1024 * 1024);
  // 5MB body
  const fiveMBBody = "y".repeat(5 * 1024 * 1024);

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      routes: {
        "/1mb": () =>
          new Response(oneMBBody, {
            headers: { "content-type": "text/plain" },
          }),
        "/5mb": () =>
          new Response(fiveMBBody, {
            headers: { "content-type": "text/plain" },
          }),
      },
      fetch(_req) {
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("compresses 1MB body with gzip and preserves integrity", async () => {
    const res = await fetch(`${baseUrl}/1mb`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");

    const compressed = new Uint8Array(await res.arrayBuffer());
    expect(compressed.byteLength).toBeLessThan(oneMBBody.length);

    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(oneMBBody);
  });

  test("compresses 1MB body with brotli and preserves integrity", async () => {
    const res = await fetch(`${baseUrl}/1mb`, {
      headers: { "accept-encoding": "br" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("br");

    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = brotliDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(oneMBBody);
  });

  test("compresses 1MB body with zstd and preserves integrity", async () => {
    const res = await fetch(`${baseUrl}/1mb`, {
      headers: { "accept-encoding": "zstd" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("zstd");

    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(oneMBBody);
  });

  test("compresses 5MB body and preserves integrity", async () => {
    const res = await fetch(`${baseUrl}/5mb`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");

    const compressed = new Uint8Array(await res.arrayBuffer());
    expect(compressed.byteLength).toBeLessThan(fiveMBBody.length);

    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(fiveMBBody);
  });

  test("compressed size is significantly smaller than original", async () => {
    const res = await fetch(`${baseUrl}/1mb`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    const contentLength = parseInt(res.headers.get("content-length")!, 10);
    // Repeated single character should compress extremely well
    expect(contentLength).toBeLessThan(oneMBBody.length / 100);
  });
});
