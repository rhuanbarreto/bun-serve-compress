/**
 * Elysia plugin integration tests.
 *
 * Verifies the bun-serve-compress/elysia adapter works correctly with
 * Elysia's mapResponse lifecycle hook.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { compress } from "../src/elysia";

const largeBody = "Elysia compression test content. ".repeat(200);

describe("Elysia plugin", () => {
  let baseUrl: string;
  let stop: () => void;

  beforeAll(() => {
    const app = new Elysia()
      .use(compress())
      .get("/text", () => new Response(largeBody, { headers: { "content-type": "text/html" } }))
      .get("/json", () => Response.json({ data: largeBody }))
      .get("/small", () => new Response("tiny", { headers: { "content-type": "text/html" } }))
      .get("/image", () => new Response("fake", { headers: { "content-type": "image/png" } }))
      .get(
        "/no-transform",
        () =>
          new Response(largeBody, {
            headers: { "content-type": "text/html", "cache-control": "no-transform" },
          }),
      )
      .listen(0);

    baseUrl = `http://localhost:${app.server!.port}`;
    stop = () => app.stop();
  });

  afterAll(() => stop());

  test("compresses with gzip", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false,
    } as any);

    expect(res.headers.get("content-encoding")).toBe("gzip");
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
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
          return new TextDecoder().decode(Bun.gunzipSync(compressed));
        }),
      ),
    );

    for (const body of results) {
      expect(body).toBe(largeBody);
    }
  });
});

describe("Elysia plugin with custom config", () => {
  let baseUrl: string;
  let stop: () => void;

  beforeAll(() => {
    const app = new Elysia()
      .use(compress({ algorithms: ["gzip"], minSize: 10 }))
      .get("/text", () => new Response(largeBody, { headers: { "content-type": "text/html" } }))
      .listen(0);

    baseUrl = `http://localhost:${app.server!.port}`;
    stop = () => app.stop();
  });

  afterAll(() => stop());

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
