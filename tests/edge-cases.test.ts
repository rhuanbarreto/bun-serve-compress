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
        "/weak-etag": () =>
          new Response(largeBody, {
            headers: {
              "content-type": "text/html",
              etag: 'W/"weak123"',
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

  test("handles empty body gracefully", async () => {
    const res = await fetch(`${baseUrl}/empty`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    // Empty body with content-length 0 is below minSize, should skip
    // The response should still work without errors
    expect(res.status).toBe(200);
  });

  test("compresses streaming responses", async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");

    // Verify data integrity
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    const text = new TextDecoder().decode(decompressed);

    // Should contain all chunks
    expect(text).toContain("chunk 0 of streaming data.");
    expect(text).toContain("chunk 99 of streaming data.");
  });

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

  test("preserves weak ETag without double-weakening", async () => {
    const res = await fetch(`${baseUrl}/weak-etag`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("etag")).toBe('W/"weak123"');
  });

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

  test("compresses CSS with charset parameter in Content-Type", async () => {
    const res = await fetch(`${baseUrl}/css`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("HEAD request is not compressed", async () => {
    const res = await fetch(`${baseUrl}/css`, {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("handles unsupported Accept-Encoding gracefully", async () => {
    const res = await fetch(`${baseUrl}/css`, {
      headers: { "accept-encoding": "deflate" },
      decompress: false,
    } as any);

    // Should serve uncompressed with Vary header
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("vary")).toInclude("Accept-Encoding");
  });
});
