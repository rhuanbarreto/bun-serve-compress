import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";
import { brotliDecompressSync } from "node:zlib";

const largeBody = "Hello, World! This is test content for compression. ".repeat(100);

describe("serve() integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0, // Random available port
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
        "/methods": {
          GET: () =>
            new Response(largeBody, {
              headers: { "content-type": "text/html" },
            }),
          POST: () =>
            new Response(JSON.stringify({ ok: true }), {
              headers: { "content-type": "application/json" },
            }),
        },
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

  test("serves uncompressed when no Accept-Encoding", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
    const body = await res.text();
    expect(body).toBe(largeBody);
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

  test("compresses SVG (text-based image)", async () => {
    const res = await fetch(`${baseUrl}/svg`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
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

    // Should still be the original content-encoding, not double-compressed
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

  test("handles method-specific routes", async () => {
    const getRes = await fetch(`${baseUrl}/methods`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(getRes.headers.get("content-encoding")).toBe("gzip");
    const compressed = new Uint8Array(await getRes.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
  });

  test("converts strong ETag to weak when compressing", async () => {
    const res = await fetch(`${baseUrl}/with-etag`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("etag")).toBe('W/"abc123"');
  });
});

describe("serve() with compression disabled", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: false,
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
        algorithms: ["gzip"], // Only gzip
        minSize: 10, // Very low threshold
        shouldCompress: (req) => {
          // Skip compression for requests with X-No-Compress header
          return !req.headers.has("x-no-compress");
        },
      },
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

  test("only uses gzip when configured", async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "accept-encoding": "br, zstd, gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
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
});
