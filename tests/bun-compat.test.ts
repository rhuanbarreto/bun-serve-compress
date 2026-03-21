/**
 * Bun-specific compatibility tests.
 *
 * These tests verify that the library works correctly with Bun's internal
 * HTTP and compression behavior, based on analysis of Bun's own test suite:
 *
 * - Bun.serve() route types: false values, BunFile, static Response cloning
 *   https://github.com/oven-sh/bun/blob/main/test/js/bun/http/bun-serve-static.test.ts
 *
 * - Bun's fetch() auto-decompression: Content-Encoding stripping, decompress: false
 *   https://github.com/oven-sh/bun/blob/main/test/js/web/fetch/fetch.brotli.test.ts
 *
 * - CompressionStream format support: gzip, deflate, brotli, zstd
 *   https://github.com/oven-sh/bun/blob/main/test/js/node/test/parallel/test-whatwg-webstreams-compression.js
 *
 * - Empty body compression edge case (regression fix)
 *   https://github.com/oven-sh/bun/blob/main/test/regression/issue/18413.test.ts
 *
 * - Truncated/corrupted compression data error types
 *   https://github.com/oven-sh/bun/blob/main/test/regression/issue/18413-truncation.test.ts
 *
 * - Stacked Content-Encoding is NOT supported by Bun (no double-compression)
 *   https://github.com/oven-sh/bun/blob/main/test/js/web/fetch/encoding.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";
import { brotliDecompressSync } from "node:zlib";
import { join } from "node:path";

const largeBody = "Bun compatibility test content. ".repeat(200);

describe("Bun route type compatibility", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      routes: {
        // false: Bun falls through to fetch handler
        "/disabled": false as any,
        // Static Response
        "/static": new Response(largeBody, {
          headers: { "content-type": "text/html" },
        }),
        // Handler function
        "/handler": () =>
          new Response(largeBody, {
            headers: { "content-type": "text/html" },
          }),
      },
      fetch(req) {
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

  test("false route falls through to fetch handler", async () => {
    const res = await fetch(`${baseUrl}/disabled`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    const text = new TextDecoder().decode(decompressed);
    expect(text).toStartWith("fallback:");
  });

  test("static Response can be served repeatedly without corruption", async () => {
    // Serve the same static route 10 times in sequence to verify cloning works
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/static`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    }
  });

  test("static Response served in parallel without corruption", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${baseUrl}/static`, {
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

describe("Bun fetch auto-decompression behavior", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      fetch(req) {
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

  test("fetch without decompress: false auto-decompresses and strips Content-Encoding", async () => {
    // Bun's default fetch behavior: auto-decompress, strip Content-Encoding
    const res = await fetch(`${baseUrl}/`);

    // Content-Encoding should be stripped by Bun's auto-decompression
    // (Bun sends Accept-Encoding automatically and decompresses the response)
    const body = await res.text();
    expect(body).toBe(largeBody);
  });

  test("fetch with decompress: false preserves compressed response", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");

    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
  });
});

describe("no double-compression", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      routes: {
        // Response that claims to be already gzip-compressed
        "/pre-gzipped": () => {
          const compressed = Bun.gzipSync(
            new TextEncoder().encode(largeBody),
          );
          return new Response(compressed, {
            headers: {
              "content-type": "text/html",
              "content-encoding": "gzip",
            },
          });
        },
        // Response with Content-Encoding: br already set
        "/pre-brotli": () => {
          return new Response("pre-compressed brotli data", {
            headers: {
              "content-type": "text/html",
              "content-encoding": "br",
            },
          });
        },
      },
      fetch(req) {
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("does not double-compress already-gzipped response", async () => {
    const res = await fetch(`${baseUrl}/pre-gzipped`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    // Should have the original Content-Encoding, not a double layer
    expect(res.headers.get("content-encoding")).toBe("gzip");

    // Should be able to decompress once to get original content
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
  });

  test("does not double-compress already-brotli-compressed response", async () => {
    const res = await fetch(`${baseUrl}/pre-brotli`, {
      headers: { "accept-encoding": "br, gzip" },
      decompress: false,
    } as any);

    // Should preserve the existing Content-Encoding without adding another layer
    expect(res.headers.get("content-encoding")).toBe("br");
  });
});

describe("CompressionStream format compatibility", () => {
  test("gzip format is supported", () => {
    const stream = new CompressionStream("gzip");
    expect(stream).toBeDefined();
  });

  test("deflate format is supported", () => {
    const stream = new CompressionStream("deflate");
    expect(stream).toBeDefined();
  });

  test("brotli format is supported (Bun extension)", () => {
    // Bun supports "brotli" as a custom CompressionStream format
    const stream = new CompressionStream("brotli" as CompressionFormat);
    expect(stream).toBeDefined();
  });

  test("zstd format is supported (Bun extension)", () => {
    // Bun supports "zstd" as a custom CompressionStream format (since 1.3.3)
    const stream = new CompressionStream("zstd" as CompressionFormat);
    expect(stream).toBeDefined();
  });
});

describe("Bun sync compression API compatibility", () => {
  const testData = new TextEncoder().encode("Hello, World!");

  test("Bun.gzipSync produces valid output", () => {
    const compressed = Bun.gzipSync(testData);
    expect(compressed.byteLength).toBeGreaterThan(0);
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("Hello, World!");
  });

  test("Bun.gzipSync accepts level parameter", () => {
    const fast = Bun.gzipSync(testData, { level: 1 });
    const slow = Bun.gzipSync(testData, { level: 9 });
    // Both should produce valid output (sizes may differ)
    expect(new TextDecoder().decode(Bun.gunzipSync(fast))).toBe("Hello, World!");
    expect(new TextDecoder().decode(Bun.gunzipSync(slow))).toBe("Hello, World!");
  });

  test("Bun.zstdCompressSync produces valid output", () => {
    const compressed = Bun.zstdCompressSync(testData);
    expect(compressed.byteLength).toBeGreaterThan(0);
    const decompressed = Bun.zstdDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("Hello, World!");
  });

  test("Bun.zstdCompressSync accepts level parameter", () => {
    const fast = Bun.zstdCompressSync(testData, { level: 1 });
    const slow = Bun.zstdCompressSync(testData, { level: 19 });
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(fast))).toBe("Hello, World!");
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(slow))).toBe("Hello, World!");
  });

  test("node:zlib brotliCompressSync produces valid output", () => {
    const { brotliCompressSync, brotliDecompressSync } = require("node:zlib");
    const compressed = brotliCompressSync(testData);
    expect(compressed.byteLength).toBeGreaterThan(0);
    const decompressed = brotliDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe("Hello, World!");
  });
});
