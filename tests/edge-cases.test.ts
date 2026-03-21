import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";

const largeBody = "Test content for edge cases. ".repeat(100);

describe("edge cases", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      routes: {
        "/empty": () => new Response("", { headers: { "content-type": "text/html" } }),
        "/null-body": () => new Response(null, { status: 200 }),
        "/stream": () => {
          const stream = new ReadableStream({
            start(controller) {
              for (let i = 0; i < 100; i++) {
                controller.enqueue(new TextEncoder().encode(`chunk ${i} of streaming data. `));
              }
              controller.close();
            },
          });
          return new Response(stream, {
            headers: { "content-type": "text/html" },
          });
        },
        "/large-stream": () => {
          const stream = new ReadableStream({
            start(controller) {
              // ~100KB of data
              for (let i = 0; i < 1000; i++) {
                controller.enqueue(
                  new TextEncoder().encode(`line ${i}: ${"x".repeat(100)}\n`),
                );
              }
              controller.close();
            },
          });
          return new Response(stream, {
            headers: { "content-type": "text/plain" },
          });
        },
        "/vary-origin": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              vary: "Origin",
            },
          }),
        "/vary-star": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              vary: "*",
            },
          }),
        "/vary-accept-encoding": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              vary: "Accept-Encoding",
            },
          }),
        "/weak-etag": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              etag: 'W/"weak123"',
            },
          }),
        "/strong-etag": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              etag: '"strong456"',
            },
          }),
        "/binary": () =>
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            headers: { "content-type": "application/octet-stream" },
          }),
        "/wasm": () =>
          new Response(new Uint8Array(2000), {
            headers: { "content-type": "application/wasm" },
          }),
        "/css": () =>
          new Response("body { margin: 0; padding: 0; } ".repeat(100), {
            headers: { "content-type": "text/css; charset=utf-8" },
          }),
        "/no-transform": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              "cache-control": "no-transform",
            },
          }),
        "/no-transform-combined": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              "cache-control": "public, no-transform, max-age=3600",
            },
          }),
        "/transfer-gzip": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              "transfer-encoding": "gzip",
            },
          }),
        "/transfer-chunked": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              "transfer-encoding": "chunked",
            },
          }),
        "/201": () =>
          new Response(largeBody, {
            status: 201,
            headers: { "content-type": "text/html" },
          }),
        "/custom-headers": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              "x-request-id": "abc-123",
              "x-powered-by": "bun",
            },
          }),
        "/xml": () =>
          new Response('<?xml version="1.0"?><root>'.repeat(100), {
            headers: { "content-type": "application/xml" },
          }),
        "/javascript": () =>
          new Response('console.log("hello");'.repeat(100), {
            headers: { "content-type": "application/javascript" },
          }),
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

  describe("empty / null body", () => {
    test("handles empty body gracefully", async () => {
      const res = await fetch(`${baseUrl}/empty`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(200);
    });

    test("handles null body", async () => {
      const res = await fetch(`${baseUrl}/null-body`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("streaming responses", () => {
    test("compresses streaming responses", async () => {
      const res = await fetch(`${baseUrl}/stream`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      const text = new TextDecoder().decode(decompressed);

      expect(text).toContain("chunk 0 of streaming data.");
      expect(text).toContain("chunk 99 of streaming data.");
    });

    test("compresses large streaming response with integrity", async () => {
      const res = await fetch(`${baseUrl}/large-stream`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");

      const compressed = new Uint8Array(await res.arrayBuffer());
      const decompressed = Bun.gunzipSync(compressed);
      const text = new TextDecoder().decode(decompressed);

      expect(text).toContain("line 0:");
      expect(text).toContain("line 999:");

      // Verify all 1000 lines are present
      const lines = text.split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(1000);
    });
  });

  describe("Vary header", () => {
    test("appends to existing Vary: Origin header", async () => {
      const res = await fetch(`${baseUrl}/vary-origin`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("vary")).toBe("Origin, Accept-Encoding");
    });

    test("preserves Vary: * without modification", async () => {
      const res = await fetch(`${baseUrl}/vary-star`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("vary")).toBe("*");
    });

    test("does not duplicate Vary: Accept-Encoding", async () => {
      const res = await fetch(`${baseUrl}/vary-accept-encoding`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      // Should NOT be "Accept-Encoding, Accept-Encoding"
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
    });
  });

  describe("ETag handling", () => {
    test("preserves weak ETag without double-weakening", async () => {
      const res = await fetch(`${baseUrl}/weak-etag`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("etag")).toBe('W/"weak123"');
    });

    test("converts strong ETag to weak when compressing", async () => {
      const res = await fetch(`${baseUrl}/strong-etag`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("etag")).toBe('W/"strong456"');
    });
  });

  describe("Cache-Control: no-transform", () => {
    test("does not compress with no-transform", async () => {
      const res = await fetch(`${baseUrl}/no-transform`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("does not compress with no-transform among other directives", async () => {
      const res = await fetch(`${baseUrl}/no-transform-combined`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toInclude("no-transform");
    });
  });

  describe("Transfer-Encoding", () => {
    test("skips when Transfer-Encoding is gzip", async () => {
      const res = await fetch(`${baseUrl}/transfer-gzip`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      // Should not add another compression layer
      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("skip binary/compressed formats", () => {
    test("skips application/octet-stream", async () => {
      const res = await fetch(`${baseUrl}/binary`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("skips application/wasm", async () => {
      const res = await fetch(`${baseUrl}/wasm`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("Content-Type edge cases", () => {
    test("compresses CSS with charset parameter in Content-Type", async () => {
      const res = await fetch(`${baseUrl}/css`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("compresses application/xml", async () => {
      const res = await fetch(`${baseUrl}/xml`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    test("compresses application/javascript", async () => {
      const res = await fetch(`${baseUrl}/javascript`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  });

  describe("status code preservation", () => {
    test("preserves 201 status code", async () => {
      const res = await fetch(`${baseUrl}/201`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.status).toBe(201);
      expect(res.headers.get("content-encoding")).toBe("gzip");
    });
  });

  describe("custom header preservation", () => {
    test("preserves custom headers through compression", async () => {
      const res = await fetch(`${baseUrl}/custom-headers`, {
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(res.headers.get("x-request-id")).toBe("abc-123");
      expect(res.headers.get("x-powered-by")).toBe("bun");
    });
  });

  describe("HEAD requests", () => {
    test("HEAD request is not compressed", async () => {
      const res = await fetch(`${baseUrl}/css`, {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("Accept-Encoding edge cases", () => {
    test("handles unsupported Accept-Encoding gracefully", async () => {
      const res = await fetch(`${baseUrl}/css`, {
        headers: { "accept-encoding": "deflate" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toInclude("Accept-Encoding");
    });

    test("handles identity Accept-Encoding (no compression)", async () => {
      const res = await fetch(`${baseUrl}/css`, {
        headers: { "accept-encoding": "identity" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });

    test("handles multiple unsupported encodings", async () => {
      const res = await fetch(`${baseUrl}/css`, {
        headers: { "accept-encoding": "deflate, sdch, identity" },
        decompress: false,
      } as any);

      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });
});
