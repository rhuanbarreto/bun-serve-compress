/**
 * Compression engine tests — roundtrip integrity and HTTP header management.
 *
 * Test cases inspired by:
 *
 * - Express/compression: Content-Length update/removal after compression,
 *   Vary header append logic (don't duplicate, preserve *), strong-to-weak ETag
 *   conversion, custom Brotli quality parameters
 *   https://github.com/expressjs/compression/blob/master/test/compression.js
 *
 * - Go net/http gziphandler: roundtrip compression/decompression integrity verification,
 *   Content-Length removal for streaming, status code preservation through compression
 *   https://github.com/nytimes/gziphandler/blob/master/gzip_test.go
 *
 * - Fastify/fastify-compress: streaming vs buffered compression paths, large body
 *   handling, custom header preservation through compression pipeline
 *   https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js
 *
 * - Express/compression: streamed writes reach the client after flush, not at end
 *   of response; stream errors and client aborts propagate
 *   https://github.com/expressjs/compression/blob/master/test/compression.js
 *
 * - Bun ReadableStream tests: string and typed-array chunks, cancellation reaching
 *   the underlying source
 *   https://github.com/oven-sh/bun/blob/main/test/js/web/streams/streams.test.js
 */
import { describe, expect, test } from "bun:test";
import { compress, addVaryHeader } from "../src/compress";
import { getDefaultResolvedConfig } from "../src/constants";
import { brotliDecompressSync, constants as zlibConstants, gunzipSync } from "node:zlib";
import type { CompressionAlgorithm } from "../src/types";

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
    test("compresses a buffered response without Content-Length synchronously", async () => {
      // String body without Content-Length — read to the end at once and sync-compressed
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

const encoder = new TextEncoder();

/** Stream that yields each part after a delay, like a handler producing output over time. */
function delayedStream(
  parts: (string | Uint8Array)[],
  options?: { delayMs?: number; firstImmediately?: boolean },
): ReadableStream {
  const delayMs = options?.delayMs ?? 10;
  let index = 0;
  return new ReadableStream({
    start(controller) {
      if (options?.firstImmediately && parts.length > 0) controller.enqueue(parts[index++]);
    },
    async pull(controller) {
      await Bun.sleep(delayMs);
      if (index >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[index++]);
    },
  });
}

function decompressAs(algorithm: CompressionAlgorithm, data: Uint8Array): string {
  switch (algorithm) {
    case "gzip":
      return new TextDecoder().decode(Bun.gunzipSync(data));
    case "br":
      return new TextDecoder().decode(brotliDecompressSync(data));
    case "zstd":
      return new TextDecoder().decode(Bun.zstdDecompressSync(data));
  }
}

/** Decode a truncated gzip/brotli stream up to its last flush point. */
function decodeFlushed(algorithm: "gzip" | "br", data: Uint8Array): string {
  const decoded =
    algorithm === "gzip"
      ? gunzipSync(data, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
      : brotliDecompressSync(data, { finishFlush: zlibConstants.BROTLI_OPERATION_FLUSH });
  return new TextDecoder().decode(decoded);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("compress live streams (no Content-Length)", () => {
  const parts = ["part one. ".repeat(80), "part two. ".repeat(80), "part three."];
  const joined = parts.join("");

  for (const algorithm of ["gzip", "br", "zstd"] as const) {
    test(`compresses a delayed stream with ${algorithm} and round-trips`, async () => {
      const res = new Response(delayedStream(parts), {
        headers: { "content-type": "text/plain", etag: '"v1"' },
      });

      const compressed = await compress(res, algorithm, config);

      expect(compressed.headers.get("content-encoding")).toBe(algorithm);
      expect(compressed.headers.has("content-length")).toBe(false);
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
      expect(compressed.headers.get("etag")).toBe('W/"v1"');
      expect(compressed.headers.get("content-type")).toBe("text/plain");

      const data = new Uint8Array(await compressed.arrayBuffer());
      expect(decompressAs(algorithm, data)).toBe(joined);
    });
  }

  for (const algorithm of ["gzip", "br"] as const) {
    test(`delivers each ${algorithm} chunk before the source stream ends`, async () => {
      const first = "first chunk of a live response. ".repeat(20);
      const { promise: secondReady, resolve: releaseSecond } = Promise.withResolvers<void>();
      let step = 0;

      const source = new ReadableStream({
        async pull(controller) {
          if (step === 0) {
            step++;
            await Bun.sleep(5);
            controller.enqueue(encoder.encode(first));
          } else if (step === 1) {
            step++;
            await secondReady;
            controller.enqueue(encoder.encode("second"));
          } else {
            controller.close();
          }
        },
      });

      const compressed = await compress(new Response(source), algorithm, config);
      const reader = compressed.body!.getReader();
      const received: Uint8Array[] = [];

      // The source is blocked on `secondReady`, so the first chunk can only be
      // decoded here if the encoder flushed it.
      const deadline = Bun.sleep(2000).then(() => "timeout" as const);
      while (!decodeFlushed(algorithm, concatBytes(received)).includes(first)) {
        const result = await Promise.race([reader.read(), deadline]);
        if (result === "timeout") throw new Error("first chunk was not flushed");
        if (result.done) throw new Error("stream ended early");
        received.push(result.value);
      }
      expect(decodeFlushed(algorithm, concatBytes(received))).toBe(first);

      releaseSecond();
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        received.push(result.value);
      }
      expect(decompressAs(algorithm, concatBytes(received))).toBe(first + "second");
    });
  }

  test("delivers zstd output before the source stream ends", async () => {
    const { promise: secondReady, resolve: releaseSecond } = Promise.withResolvers<void>();
    let step = 0;
    const source = new ReadableStream({
      async pull(controller) {
        if (step === 0) {
          step++;
          await Bun.sleep(5);
          controller.enqueue(encoder.encode("zstd live chunk ".repeat(50)));
        } else if (step === 1) {
          step++;
          await secondReady;
          controller.enqueue(encoder.encode("end"));
        } else {
          controller.close();
        }
      },
    });

    const compressed = await compress(new Response(source), "zstd", config);
    const reader = compressed.body!.getReader();
    const first = await Promise.race([reader.read(), Bun.sleep(2000).then(() => null)]);
    expect(first).not.toBeNull();
    expect(first!.done).toBe(false);

    const received = [first!.value!];
    releaseSecond();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      received.push(result.value);
    }
    expect(decompressAs("zstd", concatBytes(received))).toBe("zstd live chunk ".repeat(50) + "end");
  });

  test("compresses chunks read before the stream paused first, in order", async () => {
    const res = new Response(delayedStream(parts, { firstImmediately: true }));
    const compressed = await compress(res, "gzip", config);

    expect(compressed.headers.has("content-length")).toBe(false);
    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(decompressAs("gzip", data)).toBe(joined);
  });

  test("buffers a stream whose chunks are all available immediately", async () => {
    const source = new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });

    const compressed = await compress(new Response(source), "gzip", config);

    // Whole body was available, so the buffered path sets Content-Length
    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(compressed.headers.get("content-length")).toBe(String(data.byteLength));
    expect(decompressAs("gzip", data)).toBe(joined);
  });

  test("leaves a fully available body below minSize uncompressed", async () => {
    const res = new Response("tiny", { headers: { "content-type": "text/plain", "x-id": "1" } });
    const result = await compress(res, "gzip", config);

    expect(result.headers.has("content-encoding")).toBe(false);
    expect(result.headers.get("x-id")).toBe("1");
    expect(await result.text()).toBe("tiny");
  });

  test("accepts string chunks from handler streams", async () => {
    const res = new Response(delayedStream(parts));
    const compressed = await compress(res, "br", config);

    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(decompressAs("br", data)).toBe(joined);
  });

  test("accepts typed-array chunks that are not Uint8Array", async () => {
    const words = new Uint16Array(1500).fill(0x41_41); // "AA" per element
    const source = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(5);
        controller.enqueue(words);
        controller.close();
      },
    });

    const compressed = await compress(new Response(source), "gzip", config);
    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(decompressAs("gzip", data)).toBe("A".repeat(3000));
  });

  test("keeps reading past chunks that produce no output", async () => {
    const res = new Response(
      delayedStream(["a".repeat(2000), new Uint8Array(0), "b".repeat(2000)]),
    );
    const compressed = await compress(res, "gzip", config);

    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(decompressAs("gzip", data)).toBe("a".repeat(2000) + "b".repeat(2000));
  });

  test("streams a body over MAX_BUFFER_SIZE even when it is available immediately", async () => {
    const megabyte = "y".repeat(1024 * 1024);
    const source = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 11; i++) controller.enqueue(encoder.encode(megabyte));
        controller.close();
      },
    });

    const compressed = await compress(new Response(source), "gzip", config);

    expect(compressed.headers.has("content-length")).toBe(false);
    const data = new Uint8Array(await compressed.arrayBuffer());
    expect(decompressAs("gzip", data)).toBe(megabyte.repeat(11));
  });

  test("propagates an error from the source stream", async () => {
    let calls = 0;
    const source = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(5);
        if (calls++ === 0) controller.enqueue(new Uint8Array(2000));
        else controller.error(new Error("source failed"));
      },
    });

    const compressed = await compress(new Response(source), "gzip", config);
    await expect(compressed.arrayBuffer()).rejects.toThrow("source failed");
  });

  test("cancelling the compressed stream cancels the source", async () => {
    let cancelReason: unknown;
    const source = new ReadableStream({
      async pull(controller) {
        await Bun.sleep(5);
        controller.enqueue(new Uint8Array(2000));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });

    const compressed = await compress(new Response(source), "gzip", config);
    const reader = compressed.body!.getReader();
    await reader.read();
    await reader.cancel("client went away");

    expect(cancelReason).toBe("client went away");
  });

  test("rejects a chunk that is neither bytes nor a string", async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(42);
        controller.close();
      },
    });

    await expect(compress(new Response(source), "gzip", config)).rejects.toThrow(TypeError);
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
