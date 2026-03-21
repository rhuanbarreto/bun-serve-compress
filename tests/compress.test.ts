import { describe, expect, test } from "bun:test";
import { compress, addVaryHeader } from "../src/compress";
import { getDefaultResolvedConfig } from "../src/constants";
import { brotliDecompressSync } from "node:zlib";

const config = getDefaultResolvedConfig();
const testBody = "Hello, World! This is a test body for compression. ".repeat(50);

describe("compress", () => {
  describe("gzip", () => {
    test("compresses and can be decompressed", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "gzip", config);
      const compressedData = new Uint8Array(await compressed.arrayBuffer());

      // Decompress and verify
      const decompressed = Bun.gunzipSync(compressedData);
      expect(new TextDecoder().decode(decompressed)).toBe(testBody);
    });

    test("sets Content-Encoding: gzip header", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("content-encoding")).toBe("gzip");
    });

    test("updates Content-Length for sync compression", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "gzip", config);
      const newLength = parseInt(compressed.headers.get("content-length")!, 10);
      expect(newLength).toBeLessThan(testBody.length);
      expect(newLength).toBeGreaterThan(0);
    });
  });

  describe("brotli", () => {
    test("compresses and can be decompressed", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "br", config);
      const compressedData = new Uint8Array(await compressed.arrayBuffer());

      // Decompress with node:zlib
      const decompressed = brotliDecompressSync(compressedData);
      expect(new TextDecoder().decode(decompressed)).toBe(testBody);
    });

    test("sets Content-Encoding: br header", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "br", config);
      expect(compressed.headers.get("content-encoding")).toBe("br");
    });
  });

  describe("zstd", () => {
    test("compresses and can be decompressed", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "zstd", config);
      const compressedData = new Uint8Array(await compressed.arrayBuffer());

      // Decompress with Bun
      const decompressed = Bun.zstdDecompressSync(compressedData);
      expect(new TextDecoder().decode(decompressed)).toBe(testBody);
    });

    test("sets Content-Encoding: zstd header", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "zstd", config);
      expect(compressed.headers.get("content-encoding")).toBe("zstd");
    });
  });

  describe("headers", () => {
    test("adds Vary: Accept-Encoding header", async () => {
      const res = new Response(testBody, {
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    });

    test("appends to existing Vary header", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          vary: "Origin",
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("vary")).toBe("Origin, Accept-Encoding");
    });

    test("does not duplicate Vary: Accept-Encoding", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          vary: "Accept-Encoding",
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    });

    test("preserves Vary: * as-is", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          vary: "*",
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("vary")).toBe("*");
    });

    test("converts strong ETag to weak ETag", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          etag: '"abc123"',
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("etag")).toBe('W/"abc123"');
    });

    test("preserves already-weak ETag", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          etag: 'W/"abc123"',
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("etag")).toBe('W/"abc123"');
    });

    test("preserves status code", async () => {
      const res = new Response(testBody, {
        status: 201,
        headers: { "content-type": "text/html", "content-length": String(testBody.length) },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.status).toBe(201);
    });

    test("preserves custom headers", async () => {
      const res = new Response(testBody, {
        headers: {
          "content-type": "text/html",
          "content-length": String(testBody.length),
          "x-custom": "value",
        },
      });

      const compressed = await compress(res, "gzip", config);
      expect(compressed.headers.get("x-custom")).toBe("value");
    });
  });

  describe("streaming", () => {
    test("compresses response without Content-Length by buffering", async () => {
      // Response without Content-Length — gets buffered and sync-compressed
      const res = new Response(testBody, {
        headers: { "content-type": "text/html" },
      });

      const compressed = await compress(res, "gzip", config);

      // Buffered path sets Content-Length after compression
      expect(compressed.headers.get("content-encoding")).toBe("gzip");
      expect(compressed.headers.has("content-length")).toBe(true);

      // Verify the compressed data can be decompressed
      const compressedData = new Uint8Array(await compressed.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressedData);
      expect(new TextDecoder().decode(decompressed)).toBe(testBody);
    });

    test("uses streaming compression for large known-size bodies", async () => {
      const largeBody = "x".repeat(11 * 1024 * 1024); // 11MB — exceeds MAX_BUFFER_SIZE
      const res = new Response(largeBody, {
        headers: {
          "content-type": "text/plain",
          "content-length": String(largeBody.length),
        },
      });

      const compressed = await compress(res, "gzip", config);

      // Streaming path removes Content-Length
      expect(compressed.headers.has("content-length")).toBe(false);
      expect(compressed.headers.get("content-encoding")).toBe("gzip");

      // Verify data integrity
      const compressedData = new Uint8Array(await compressed.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressedData);
      expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
    });
  });
});

describe("addVaryHeader", () => {
  test("adds Vary header to response without one", () => {
    const res = new Response("body");
    const result = addVaryHeader(res);
    expect(result.headers.get("vary")).toBe("Accept-Encoding");
  });

  test("appends to existing Vary header", () => {
    const res = new Response("body", { headers: { vary: "Origin" } });
    const result = addVaryHeader(res);
    expect(result.headers.get("vary")).toBe("Origin, Accept-Encoding");
  });

  test("does not modify Vary: *", () => {
    const res = new Response("body", { headers: { vary: "*" } });
    const result = addVaryHeader(res);
    expect(result.headers.get("vary")).toBe("*");
  });

  test("does not duplicate Accept-Encoding", () => {
    const res = new Response("body", { headers: { vary: "Accept-Encoding" } });
    const result = addVaryHeader(res);
    expect(result.headers.get("vary")).toBe("Accept-Encoding");
  });
});
