/**
 * Hono middleware integration tests.
 *
 * Verifies the bun-serve-compress/hono adapter works correctly with
 * Hono's middleware system and c.res reassignment pattern.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { compress } from "../src/hono";

const largeBody = "Hono compression test content. ".repeat(200);
/** Response whose first chunk is ready at once and later chunks arrive 300 ms apart. */
function liveResponse(): Response {
  const parts = ["live part one. ".repeat(100), "live part two. ".repeat(100), "done"];
  let index = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(parts[index++]));
    },
    async pull(controller) {
      await Bun.sleep(300);
      if (index >= parts.length) controller.close();
      else controller.enqueue(new TextEncoder().encode(parts[index++]));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain" } });
}

const liveBody = "live part one. ".repeat(100) + "live part two. ".repeat(100) + "done";

describe("Hono middleware", () => {
  let baseUrl: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = new Hono();
    app.use(compress());
    app.get("/text", (c) => c.html(largeBody));
    app.get("/json", (c) => c.json({ data: largeBody }));
    app.get("/small", (c) => c.html("tiny"));
    app.get("/stream", () => liveResponse());
    app.get("/image", (_c) => {
      return new Response("fake", { headers: { "content-type": "image/png" } });
    });
    app.get("/no-transform", (_c) => {
      return new Response(largeBody, {
        headers: { "content-type": "text/html", "cache-control": "no-transform" },
      });
    });

    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server.stop(true));

  test("compresses with gzip", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toInclude(largeBody);
  });

  test("compresses with brotli", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "br" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("br");
  });

  test("compresses with zstd", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "zstd" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("zstd");
  });

  test("prefers zstd when client accepts all", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "gzip, br, zstd" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("zstd");
  });

  test("does not compress small responses", async () => {
    const res = await fetch(`${baseUrl}/small`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("does not compress images", async () => {
    const res = await fetch(`${baseUrl}/image`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("does not compress when Cache-Control: no-transform", async () => {
    const res = await fetch(`${baseUrl}/no-transform`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("compresses JSON responses", async () => {
    const res = await fetch(`${baseUrl}/json`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("serves uncompressed when no Accept-Encoding", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("handles concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${baseUrl}/text`, {
          headers: { "accept-encoding": "gzip" },
          decompress: false,
        } as any).then(async (res) => {
          expect(res.headers.get("content-encoding")).toBe("gzip");
          const compressed = new Uint8Array(await res.arrayBuffer());
          const decompressed = Bun.gunzipSync(compressed);
          return new TextDecoder().decode(decompressed);
        }),
      ),
    );

    for (const body of results) {
      expect(body).toInclude(largeBody);
    }
  });

  test("streams a live response without waiting for it to finish", async () => {
    const started = performance.now();
    const res = await fetch(`${baseUrl}/stream`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as RequestInit);
    const reader = res.body!.getReader();
    const first = await reader.read();
    const firstChunkMs = performance.now() - started;

    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.has("content-length")).toBe(false);
    // The handler needs ~900 ms to finish; the first chunk must not wait for that
    expect(firstChunkMs).toBeLessThan(300);

    const chunks: Uint8Array[] = [first.value!];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const data = new Uint8Array(await new Blob(chunks).arrayBuffer());
    expect(new TextDecoder().decode(Bun.gunzipSync(data))).toBe(liveBody);
  });
});

describe("Hono middleware with custom config", () => {
  let baseUrl: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = new Hono();
    app.use(compress({ algorithms: ["gzip"], minSize: 10 }));
    app.get("/text", (c) => c.html(largeBody));

    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server.stop(true));

  test("only uses configured algorithm", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "br, zstd, gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("rejects unconfigured algorithms", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "br" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });
});

describe("Hono route-specific middleware", () => {
  let baseUrl: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = new Hono();
    // Only compress /api/* routes
    app.use("/api/*", compress());
    app.get("/api/data", (c) => c.json({ data: largeBody }));
    app.get("/no-compress", (c) => c.html(largeBody));

    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server.stop(true));

  test("compresses matched routes", async () => {
    const res = await fetch(`${baseUrl}/api/data`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("does not compress unmatched routes", async () => {
    const res = await fetch(`${baseUrl}/no-compress`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBeNull();
  });
});
