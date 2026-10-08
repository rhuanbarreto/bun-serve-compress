/**
 * Bun.file() route tests — native-equivalent file serving plus compression.
 *
 * Test cases inspired by:
 *
 * - Bun static routes: BunFile route values, 404 for missing files, Last-Modified,
 *   If-Modified-Since → 304, Range → 206 Partial Content
 *   https://github.com/oven-sh/bun/blob/main/test/js/bun/http/bun-serve-static.test.ts
 *
 * - pillarjs/send (Express static): conditional GET precedence (If-None-Match over
 *   If-Modified-Since), invalid dates ignored, Range responses left unencoded
 *   https://github.com/pillarjs/send/blob/master/test/send.js
 *
 * - RFC 9110 Sections 13.1.3, 13.2.2 and 14: If-Modified-Since, precondition order,
 *   Range requests
 *   https://www.rfc-editor.org/rfc/rfc9110
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { fileResponse, isBunFile } from "../src/file";
import { serve } from "../src/serve";

const textContent = "File route content that compresses well. ".repeat(150);
const jsonContent = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ i })) });
const pngContent = new Uint8Array(4096).fill(7);

let dir: string;
let textPath: string;

function makeRequest(headers?: Record<string, string>, method = "GET"): Request {
  return new Request("http://localhost/file", { method, headers });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bun-serve-compress-"));
  textPath = join(dir, "page.txt");
  await Bun.write(textPath, textContent);
  await Bun.write(join(dir, "data.json"), jsonContent);
  await Bun.write(join(dir, "small.txt"), "small file");
  await Bun.write(join(dir, "image.png"), pngContent);
  await Bun.write(join(dir, "mutable.txt"), "version one. ".repeat(200));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isBunFile", () => {
  test("detects Bun.file() values", () => {
    expect(isBunFile(Bun.file(textPath))).toBe(true);
  });

  test("rejects other values", () => {
    expect(isBunFile(new Blob(["x"]))).toBe(false);
    expect(isBunFile(new Response("x"))).toBe(false);
    expect(isBunFile({ exists: () => true })).toBe(false);
    expect(isBunFile("page.txt")).toBe(false);
    expect(isBunFile(null)).toBe(false);
  });
});

describe("fileResponse", () => {
  test("serves the file with Content-Type, Content-Length and Last-Modified", async () => {
    const file = Bun.file(textPath);
    const res = await fileResponse(makeRequest(), file);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    expect(res.headers.get("content-length")).toBe(String(file.size));
    expect(res.headers.get("last-modified")).toBe(new Date(file.lastModified).toUTCString());
    expect(await res.text()).toBe(textContent);
  });

  test("returns 404 for a missing file", async () => {
    const res = await fileResponse(makeRequest(), Bun.file(join(dir, "missing.txt")));

    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
  });

  test("returns 304 when If-Modified-Since is at or after the modification time", async () => {
    const file = Bun.file(textPath);
    const lastModified = new Date(file.lastModified).toUTCString();
    const res = await fileResponse(makeRequest({ "if-modified-since": lastModified }), file);

    expect(res.status).toBe(304);
    expect(res.headers.get("last-modified")).toBe(lastModified);
    expect(res.body).toBeNull();
  });

  test("returns 200 when the file changed after If-Modified-Since", async () => {
    const res = await fileResponse(
      makeRequest({ "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT" }),
      Bun.file(textPath),
    );
    expect(res.status).toBe(200);
  });

  test("ignores an invalid If-Modified-Since date", async () => {
    const res = await fileResponse(
      makeRequest({ "if-modified-since": "not a date" }),
      Bun.file(textPath),
    );
    expect(res.status).toBe(200);
  });

  test("If-None-Match takes precedence over If-Modified-Since", async () => {
    const res = await fileResponse(
      makeRequest({
        "if-none-match": '"abc"',
        "if-modified-since": "Fri, 01 Jan 2100 00:00:00 GMT",
      }),
      Bun.file(textPath),
    );
    expect(res.status).toBe(200);
  });

  test("only GET and HEAD are conditional", async () => {
    const res = await fileResponse(
      makeRequest({ "if-modified-since": "Fri, 01 Jan 2100 00:00:00 GMT" }, "POST"),
      Bun.file(textPath),
    );
    expect(res.status).toBe(200);
  });

  test("leaves Content-Length to Bun for Range requests", async () => {
    const res = await fileResponse(makeRequest({ range: "bytes=0-9" }), Bun.file(textPath));

    expect(res.headers.has("content-length")).toBe(false);
    expect(res.headers.get("content-type")).toStartWith("text/plain");
  });
});

describe("serve() Bun.file routes", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {},
      routes: {
        "/page": Bun.file(textPath),
        "/data": Bun.file(join(dir, "data.json")),
        "/small": Bun.file(join(dir, "small.txt")),
        "/image": Bun.file(join(dir, "image.png")),
        "/missing": Bun.file(join(dir, "missing.txt")),
        "/mutable": Bun.file(join(dir, "mutable.txt")),
      },
      fetch: () => new Response("not found", { status: 404 }),
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  const get = (path: string, headers?: Record<string, string>, method = "GET") =>
    fetch(`${baseUrl}${path}`, { method, headers, decompress: false } as RequestInit);

  test("compresses a text file with gzip", async () => {
    const res = await get("/page", { "accept-encoding": "gzip" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    expect(res.headers.get("last-modified")).toBe(
      new Date(Bun.file(textPath).lastModified).toUTCString(),
    );

    const data = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("content-length")).toBe(String(data.byteLength));
    expect(data.byteLength).toBeLessThan(textContent.length);
    expect(new TextDecoder().decode(Bun.gunzipSync(data))).toBe(textContent);
  });

  test("compresses a file with brotli", async () => {
    const res = await get("/data", { "accept-encoding": "br" });

    expect(res.headers.get("content-encoding")).toBe("br");
    const data = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(brotliDecompressSync(data))).toBe(jsonContent);
  });

  test("compresses a file with zstd", async () => {
    const res = await get("/page", { "accept-encoding": "zstd" });

    expect(res.headers.get("content-encoding")).toBe("zstd");
    const data = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(Bun.zstdDecompressSync(data))).toBe(textContent);
  });

  test("serves the file uncompressed with Vary when no encoding is acceptable", async () => {
    const res = await get("/page", { "accept-encoding": "identity" });

    expect(res.headers.has("content-encoding")).toBe(false);
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(await res.text()).toBe(textContent);
  });

  test("does not compress a file below minSize", async () => {
    const res = await get("/small", { "accept-encoding": "gzip" });

    expect(res.headers.has("content-encoding")).toBe(false);
    expect(await res.text()).toBe("small file");
  });

  test("keeps the native route for types that are never compressed", async () => {
    const res = await get("/image", { "accept-encoding": "gzip, br, zstd" });

    expect(res.status).toBe(200);
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pngContent);
  });

  test("returns 404 for a missing file", async () => {
    const res = await get("/missing", { "accept-encoding": "gzip" });

    expect(res.status).toBe(404);
    expect(res.headers.has("content-encoding")).toBe(false);
  });

  test("returns 304 for a satisfied If-Modified-Since", async () => {
    const lastModified = new Date(Bun.file(textPath).lastModified).toUTCString();
    const res = await get("/page", {
      "accept-encoding": "gzip",
      "if-modified-since": lastModified,
    });

    expect(res.status).toBe(304);
    expect(res.headers.has("content-encoding")).toBe(false);
  });

  test("serves Range requests uncompressed", async () => {
    const res = await get("/page", { "accept-encoding": "gzip", range: "bytes=0-9" });
    const body = await res.text();

    expect(res.headers.has("content-encoding")).toBe(false);
    if (Bun.semver.satisfies(Bun.version, ">=1.4.0")) {
      // Bun answers file-backed Range requests with 206 from 1.4
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes 0-9/${textContent.length}`);
      expect(body).toBe(textContent.slice(0, 10));
    } else {
      expect(res.status).toBe(200);
      expect(body).toBe(textContent);
    }
  });

  test("HEAD requests are not compressed", async () => {
    const res = await get("/page", { "accept-encoding": "gzip" }, "HEAD");

    expect(res.status).toBe(200);
    expect(res.headers.has("content-encoding")).toBe(false);
  });

  test("reads the file on every request, so changes on disk are served", async () => {
    const path = join(dir, "mutable.txt");
    const first = await get("/mutable", { "accept-encoding": "gzip" });
    expect(
      new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await first.arrayBuffer()))),
    ).toBe("version one. ".repeat(200));

    await Bun.write(path, "version two. ".repeat(200));

    const second = await get("/mutable", { "accept-encoding": "gzip" });
    expect(
      new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await second.arrayBuffer()))),
    ).toBe("version two. ".repeat(200));
  });
});
