import { describe, expect, test } from "bun:test";
import { shouldSkip } from "../src/skip";
import { getDefaultResolvedConfig } from "../src/constants";

function makeRequest(options?: { method?: string; headers?: Record<string, string> }): Request {
  return new Request("http://localhost/test", {
    method: options?.method ?? "GET",
    headers: options?.headers,
  });
}

function makeResponse(
  body: string | null,
  options?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(body, {
    status: options?.status ?? 200,
    headers: options?.headers,
  });
}

const config = getDefaultResolvedConfig();

describe("shouldSkip", () => {
  describe("basic compressible responses", () => {
    test("does not skip normal text/html response", () => {
      const req = makeRequest();
      const res = makeResponse("Hello World! ".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "1300" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip application/json", () => {
      const req = makeRequest();
      const res = makeResponse('{"key":"value"}'.repeat(100), {
        headers: { "content-type": "application/json", "content-length": "1500" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip text/css", () => {
      const req = makeRequest();
      const res = makeResponse("body { color: red; }".repeat(100), {
        headers: { "content-type": "text/css", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip application/javascript", () => {
      const req = makeRequest();
      const res = makeResponse("console.log('hello')".repeat(100), {
        headers: { "content-type": "application/javascript", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip application/xml", () => {
      const req = makeRequest();
      const res = makeResponse("<root><item>data</item></root>".repeat(50), {
        headers: { "content-type": "application/xml", "content-length": "1500" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip text/plain", () => {
      const req = makeRequest();
      const res = makeResponse("plain text ".repeat(200), {
        headers: { "content-type": "text/plain", "content-length": "2200" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("HTTP methods", () => {
    test("skips HEAD requests", () => {
      const req = makeRequest({ method: "HEAD" });
      const res = makeResponse("body", {
        headers: { "content-type": "text/html", "content-length": "4" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip POST requests", () => {
      const req = makeRequest({ method: "POST" });
      const res = makeResponse("response body ".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "1400" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip PUT requests", () => {
      const req = makeRequest({ method: "PUT" });
      const res = makeResponse("response body ".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "1400" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip DELETE requests", () => {
      const req = makeRequest({ method: "DELETE" });
      const res = makeResponse("response body ".repeat(100), {
        headers: { "content-type": "application/json", "content-length": "1400" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("status codes", () => {
    test("skips 204 No Content", () => {
      const req = makeRequest();
      const res = makeResponse(null, { status: 204 });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips 304 Not Modified", () => {
      const req = makeRequest();
      const res = makeResponse(null, { status: 304 });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips 101 Switching Protocols", () => {
      const req = makeRequest();
      const res = makeResponse(null, { status: 101 });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip 200 OK", () => {
      const req = makeRequest();
      const res = makeResponse("ok ".repeat(500), {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "1500" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip 404 Not Found (error responses should compress)", () => {
      const req = makeRequest();
      const res = makeResponse("Not Found page content ".repeat(100), {
        status: 404,
        headers: { "content-type": "text/html", "content-length": "2200" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip 500 Internal Server Error (error responses should compress)", () => {
      const req = makeRequest();
      const res = makeResponse("Error page ".repeat(200), {
        status: 500,
        headers: { "content-type": "text/html", "content-length": "2200" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip 301 Redirect with body", () => {
      const req = makeRequest();
      const res = makeResponse("Redirecting... ".repeat(100), {
        status: 301,
        headers: { "content-type": "text/html", "content-length": "1500" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("Content-Encoding already set", () => {
    test("skips when Content-Encoding is gzip", () => {
      const req = makeRequest();
      const res = makeResponse("compressed data", {
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
          "content-length": "2000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips when Content-Encoding is br", () => {
      const req = makeRequest();
      const res = makeResponse("compressed data", {
        headers: {
          "content-type": "text/html",
          "content-encoding": "br",
          "content-length": "2000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips when Content-Encoding is zstd", () => {
      const req = makeRequest();
      const res = makeResponse("compressed data", {
        headers: {
          "content-type": "text/html",
          "content-encoding": "zstd",
          "content-length": "2000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });
  });

  describe("Transfer-Encoding already set", () => {
    test("skips when Transfer-Encoding includes gzip", () => {
      const req = makeRequest();
      const res = makeResponse("data", {
        headers: {
          "content-type": "text/html",
          "transfer-encoding": "gzip",
          "content-length": "2000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips when Transfer-Encoding includes deflate", () => {
      const req = makeRequest();
      const res = makeResponse("data", {
        headers: {
          "content-type": "text/html",
          "transfer-encoding": "deflate",
          "content-length": "2000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip when Transfer-Encoding is only chunked", () => {
      const req = makeRequest();
      const res = makeResponse("chunked data ".repeat(100), {
        headers: {
          "content-type": "text/html",
          "transfer-encoding": "chunked",
          "content-length": "1300",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("Cache-Control: no-transform", () => {
    test("skips when Cache-Control is no-transform", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: {
          "content-type": "text/html",
          "cache-control": "no-transform",
          "content-length": "1500",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips when no-transform is among other directives", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: {
          "content-type": "text/html",
          "cache-control": "public, no-transform, max-age=300",
          "content-length": "1500",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip when Cache-Control has no no-transform", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: {
          "content-type": "text/html",
          "cache-control": "public, max-age=300",
          "content-length": "1500",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("handles no-transform with extra whitespace", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: {
          "content-type": "text/html",
          "cache-control": "public ,  no-transform  , max-age=300",
          "content-length": "1500",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("is case-insensitive for no-transform", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: {
          "content-type": "text/html",
          "cache-control": "No-Transform",
          "content-length": "1500",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });
  });

  describe("null/empty body", () => {
    test("skips null body", () => {
      const req = makeRequest();
      const res = makeResponse(null);
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip empty string body (let minSize handle it)", () => {
      const req = makeRequest();
      const res = makeResponse("", {
        headers: { "content-type": "text/html" },
      });
      // Empty string creates a Response with body !== null but Content-Length = 0
      // This will be caught by the minSize check in compress.ts
      // shouldSkip should not skip here because the body is technically present
      // but the compress function will catch it
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("MIME type skip list", () => {
    test("skips image/png", () => {
      const req = makeRequest();
      const res = makeResponse("png data", {
        headers: { "content-type": "image/png", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips image/jpeg", () => {
      const req = makeRequest();
      const res = makeResponse("jpeg data", {
        headers: { "content-type": "image/jpeg", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips image/webp", () => {
      const req = makeRequest();
      const res = makeResponse("webp data", {
        headers: { "content-type": "image/webp", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips image/avif", () => {
      const req = makeRequest();
      const res = makeResponse("avif data", {
        headers: { "content-type": "image/avif", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does NOT skip image/svg+xml (compressible)", () => {
      const req = makeRequest();
      const res = makeResponse("<svg>...</svg>".repeat(100), {
        headers: { "content-type": "image/svg+xml", "content-length": "1400" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("skips audio/mpeg", () => {
      const req = makeRequest();
      const res = makeResponse("audio data", {
        headers: { "content-type": "audio/mpeg", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips audio/ogg", () => {
      const req = makeRequest();
      const res = makeResponse("audio data", {
        headers: { "content-type": "audio/ogg", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips video/mp4", () => {
      const req = makeRequest();
      const res = makeResponse("video data", {
        headers: { "content-type": "video/mp4", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips font/woff2", () => {
      const req = makeRequest();
      const res = makeResponse("font data", {
        headers: { "content-type": "font/woff2", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips font/woff", () => {
      const req = makeRequest();
      const res = makeResponse("font data", {
        headers: { "content-type": "font/woff", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips application/zip", () => {
      const req = makeRequest();
      const res = makeResponse("zip data", {
        headers: { "content-type": "application/zip", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips application/gzip", () => {
      const req = makeRequest();
      const res = makeResponse("gz data", {
        headers: { "content-type": "application/gzip", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips application/wasm", () => {
      const req = makeRequest();
      const res = makeResponse("wasm data", {
        headers: { "content-type": "application/wasm", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips application/pdf", () => {
      const req = makeRequest();
      const res = makeResponse("pdf data", {
        headers: { "content-type": "application/pdf", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips application/octet-stream", () => {
      const req = makeRequest();
      const res = makeResponse("binary data", {
        headers: { "content-type": "application/octet-stream", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("skips text/event-stream (SSE)", () => {
      const req = makeRequest();
      const res = makeResponse("data: hello\n\n", {
        headers: { "content-type": "text/event-stream", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });
  });

  describe("Content-Type edge cases", () => {
    test("handles Content-Type with charset parameter", () => {
      const req = makeRequest();
      const res = makeResponse("Hello ".repeat(200), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": "1200",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("handles Content-Type with charset and whitespace", () => {
      const req = makeRequest();
      const res = makeResponse("Hello ".repeat(200), {
        headers: {
          "content-type": "text/html ; charset=utf-8",
          "content-length": "1200",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("does not skip when Content-Type is missing (no MIME to check)", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: { "content-length": "1500" },
      });
      // No Content-Type means we can't match the skip list, so don't skip
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("handles Content-Type with boundary parameter", () => {
      const req = makeRequest();
      const res = makeResponse("multipart data ".repeat(200), {
        headers: {
          "content-type": "multipart/form-data; boundary=----WebKitFormBoundary",
          "content-length": "3000",
        },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("minSize threshold", () => {
    test("skips body below minSize threshold", () => {
      const req = makeRequest();
      const res = makeResponse("small", {
        headers: { "content-type": "text/html", "content-length": "5" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip body at exactly minSize", () => {
      const req = makeRequest();
      const body = "x".repeat(1024);
      const res = makeResponse(body, {
        headers: { "content-type": "text/html", "content-length": "1024" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("skips body one byte below minSize", () => {
      const req = makeRequest();
      const body = "x".repeat(1023);
      const res = makeResponse(body, {
        headers: { "content-type": "text/html", "content-length": "1023" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("does not skip when Content-Length is unknown (streaming)", () => {
      const req = makeRequest();
      const res = makeResponse("streaming data ".repeat(100), {
        headers: { "content-type": "text/html" },
      });
      expect(shouldSkip(req, res, config)).toBe(false);
    });

    test("respects custom minSize", () => {
      const customConfig = { ...config, minSize: 10 };
      const req = makeRequest();
      const res = makeResponse("medium body!!", {
        headers: { "content-type": "text/html", "content-length": "13" },
      });
      expect(shouldSkip(req, res, customConfig)).toBe(false);
    });

    test("handles Content-Length of 0", () => {
      const req = makeRequest();
      const res = makeResponse("", {
        headers: { "content-type": "text/html", "content-length": "0" },
      });
      expect(shouldSkip(req, res, config)).toBe(true);
    });

    test("handles invalid Content-Length gracefully", () => {
      const req = makeRequest();
      const res = makeResponse("data ".repeat(300), {
        headers: { "content-type": "text/html", "content-length": "not-a-number" },
      });
      // NaN check: parseInt("not-a-number") is NaN, so we don't skip
      expect(shouldSkip(req, res, config)).toBe(false);
    });
  });

  describe("custom shouldCompress", () => {
    test("respects custom shouldCompress returning false", () => {
      const customConfig = {
        ...config,
        shouldCompress: () => false,
      };
      const req = makeRequest();
      const res = makeResponse("compressible content".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, customConfig)).toBe(true);
    });

    test("respects custom shouldCompress returning true", () => {
      const customConfig = {
        ...config,
        shouldCompress: () => true,
      };
      const req = makeRequest();
      const res = makeResponse("compressible content".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "2000" },
      });
      expect(shouldSkip(req, res, customConfig)).toBe(false);
    });

    test("shouldCompress receives req and res", () => {
      let receivedReq: Request | null = null;
      let receivedRes: Response | null = null;
      const customConfig = {
        ...config,
        shouldCompress: (req: Request, res: Response) => {
          receivedReq = req;
          receivedRes = res;
          return true;
        },
      };
      const req = makeRequest();
      const res = makeResponse("compressible content".repeat(100), {
        headers: { "content-type": "text/html", "content-length": "2000" },
      });
      shouldSkip(req, res, customConfig);
      expect(receivedReq).toBe(req);
      expect(receivedRes).toBe(res);
    });

    test("shouldCompress can check request URL", () => {
      const customConfig = {
        ...config,
        shouldCompress: (req: Request) => !req.url.includes("/raw/"),
      };
      const rawReq = new Request("http://localhost/raw/data");
      const res = makeResponse("data ".repeat(300), {
        headers: { "content-type": "text/html", "content-length": "1500" },
      });
      expect(shouldSkip(rawReq, res, customConfig)).toBe(true);

      const normalReq = new Request("http://localhost/api/data");
      const res2 = makeResponse("data ".repeat(300), {
        headers: { "content-type": "text/html", "content-length": "1500" },
      });
      expect(shouldSkip(normalReq, res2, customConfig)).toBe(false);
    });
  });

  describe("compression disabled", () => {
    test("skips when compression is disabled", () => {
      const disabledConfig = { ...config, disable: true };
      const req = makeRequest();
      const res = makeResponse("content".repeat(200), {
        headers: { "content-type": "text/html", "content-length": "1400" },
      });
      expect(shouldSkip(req, res, disabledConfig)).toBe(true);
    });
  });
});
