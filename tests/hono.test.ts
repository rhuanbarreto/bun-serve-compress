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

describe("Hono middleware", () => {
  let baseUrl: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = new Hono();
    app.use(compress());
    app.get("/text", (c) => c.html(largeBody));
    app.get("/json", (c) => c.json({ data: largeBody }));
    app.get("/small", (c) => c.html("tiny"));
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
