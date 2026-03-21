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

describe("shouldSkip", () => {
  const config = getDefaultResolvedConfig();

  test("does not skip normal text/html response", () => {
    const req = makeRequest();
    const res = makeResponse("Hello World! ".repeat(100), {
      headers: { "content-type": "text/html", "content-length": "1300" },
    });
    expect(shouldSkip(req, res, config)).toBe(false);
  });

  test("skips HEAD requests", () => {
    const req = makeRequest({ method: "HEAD" });
    const res = makeResponse("body", {
      headers: { "content-type": "text/html", "content-length": "4" },
    });
    expect(shouldSkip(req, res, config)).toBe(true);
  });

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

  test("skips when Content-Encoding is already set", () => {
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

  test("skips null body", () => {
    const req = makeRequest();
    const res = makeResponse(null);
    expect(shouldSkip(req, res, config)).toBe(true);
  });

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

  test("does NOT skip image/svg+xml (compressible)", () => {
    const req = makeRequest();
    const res = makeResponse("<svg>...</svg>".repeat(100), {
      headers: { "content-type": "image/svg+xml", "content-length": "1400" },
    });
    expect(shouldSkip(req, res, config)).toBe(false);
  });

  test("skips audio/*", () => {
    const req = makeRequest();
    const res = makeResponse("audio data", {
      headers: { "content-type": "audio/mpeg", "content-length": "2000" },
    });
    expect(shouldSkip(req, res, config)).toBe(true);
  });

  test("skips video/*", () => {
    const req = makeRequest();
    const res = makeResponse("video data", {
      headers: { "content-type": "video/mp4", "content-length": "2000" },
    });
    expect(shouldSkip(req, res, config)).toBe(true);
  });

  test("skips font/*", () => {
    const req = makeRequest();
    const res = makeResponse("font data", {
      headers: { "content-type": "font/woff2", "content-length": "2000" },
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

  test("skips text/event-stream (SSE)", () => {
    const req = makeRequest();
    const res = makeResponse("data: hello\n\n", {
      headers: { "content-type": "text/event-stream", "content-length": "2000" },
    });
    expect(shouldSkip(req, res, config)).toBe(true);
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

  test("skips body below minSize threshold", () => {
    const req = makeRequest();
    const res = makeResponse("small", {
      headers: { "content-type": "text/html", "content-length": "5" },
    });
    expect(shouldSkip(req, res, config)).toBe(true);
  });

  test("does not skip when Content-Length is unknown (streaming)", () => {
    const req = makeRequest();
    // No content-length header — streaming response
    const res = makeResponse("streaming data ".repeat(100), {
      headers: { "content-type": "text/html" },
    });
    expect(shouldSkip(req, res, config)).toBe(false);
  });

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

  test("skips when compression is disabled", () => {
    const disabledConfig = { ...config, disable: true };
    const req = makeRequest();
    const res = makeResponse("content".repeat(200), {
      headers: { "content-type": "text/html", "content-length": "1400" },
    });
    expect(shouldSkip(req, res, disabledConfig)).toBe(true);
  });

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
});
