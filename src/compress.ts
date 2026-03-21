import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import type { CompressionAlgorithm, ResolvedCompressionOptions } from "./types";

/**
 * Compress data synchronously using the specified algorithm.
 *
 * Uses Bun's native sync compression functions for gzip and zstd,
 * and node:zlib's brotliCompressSync for brotli (Bun has no native
 * Bun.brotliCompressSync yet).
 */
function compressSync(
  data: Uint8Array<ArrayBuffer>,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): Uint8Array<ArrayBuffer> {
  switch (algorithm) {
    case "gzip":
      return Bun.gzipSync(data, { level: config.gzip.level as any }) as Uint8Array<ArrayBuffer>;

    case "br": {
      const compressed = brotliCompressSync(data, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: config.brotli.level,
        },
      });
      return new Uint8Array(
        compressed.buffer,
        compressed.byteOffset,
        compressed.byteLength,
      ) as Uint8Array<ArrayBuffer>;
    }

    case "zstd":
      return Bun.zstdCompressSync(data, { level: config.zstd.level }) as Uint8Array<ArrayBuffer>;
  }
}

/**
 * Create a compressed ReadableStream using CompressionStream API.
 */
function compressStream(body: ReadableStream, algorithm: CompressionAlgorithm): ReadableStream {
  // Map algorithm names to CompressionStream format
  let format: string;
  switch (algorithm) {
    case "gzip":
      format = "gzip";
      break;
    case "br":
      // Bun supports "brotli" as a custom format name in CompressionStream
      format = "brotli";
      break;
    case "zstd":
      format = "zstd";
      break;
  }

  const stream = new CompressionStream(format as CompressionFormat);
  return body.pipeThrough(stream as any);
}

/**
 * Append a value to the Vary header, preserving existing values.
 */
function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary");
  if (existing) {
    // Don't add if already present or if Vary is *
    if (existing === "*") return;
    const values = existing.split(",").map((v) => v.trim().toLowerCase());
    if (values.includes(value.toLowerCase())) return;
    headers.set("vary", `${existing}, ${value}`);
  } else {
    headers.set("vary", value);
  }
}

/**
 * Build response headers for a compressed response.
 */
function buildHeaders(
  original: Headers,
  algorithm: CompressionAlgorithm,
  compressedSize: number | null,
): Headers {
  const headers = new Headers(original);

  // Set Content-Encoding
  headers.set("content-encoding", algorithm);

  // Update or remove Content-Length
  if (compressedSize !== null) {
    headers.set("content-length", compressedSize.toString());
  } else {
    headers.delete("content-length");
  }

  // Append Vary: Accept-Encoding
  appendVary(headers, "Accept-Encoding");

  // Handle ETag — if present and strong, make it weak since body changed
  const etag = headers.get("etag");
  if (etag && !etag.startsWith("W/")) {
    headers.set("etag", `W/${etag}`);
  }

  return headers;
}

/**
 * Compress an HTTP Response.
 *
 * Chooses between sync (buffered) and streaming compression based on the response body type:
 * - If the body can be read as an ArrayBuffer (non-streaming), use sync compression
 * - If the body is a ReadableStream, use CompressionStream
 *
 * Also performs a final minSize check after buffering — this catches cases where
 * Content-Length was not set on the original response (e.g., static Route responses).
 *
 * Returns a new Response with compressed body and updated headers.
 */
export async function compress(
  res: Response,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): Promise<Response> {
  // Check if we should use streaming or buffered compression
  // If bodyUsed is true, we can't read it — shouldn't happen but guard against it
  if (res.bodyUsed) return res;

  const body = res.body;
  if (!body) return res;

  // Try buffered (sync) compression first — faster for small/medium responses
  // We check if we can read the full body. If Content-Length is known and reasonable
  // (< 10MB), use sync. Otherwise use streaming.
  const contentLength = res.headers.get("content-length");
  const knownSize = contentLength ? parseInt(contentLength, 10) : null;
  const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

  if (knownSize !== null && knownSize <= MAX_BUFFER_SIZE) {
    // Known size, fits in memory — sync path
    const buffer = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    const compressed = compressSync(buffer, algorithm, config);

    return new Response(compressed as BodyInit, {
      status: res.status,
      statusText: res.statusText,
      headers: buildHeaders(res.headers, algorithm, compressed.byteLength),
    });
  }

  if (knownSize !== null) {
    // Known size but too large — streaming path
    const compressedStream = compressStream(body, algorithm);

    return new Response(compressedStream, {
      status: res.status,
      statusText: res.statusText,
      headers: buildHeaders(res.headers, algorithm, null),
    });
  }

  // Unknown size (no Content-Length) — buffer to check minSize, then compress
  // This handles static Response objects that don't set Content-Length
  const buffer = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;

  if (buffer.byteLength < config.minSize) {
    // Below threshold — return uncompressed with original body
    return new Response(buffer as BodyInit, {
      status: res.status,
      statusText: res.statusText,
      headers: new Headers(res.headers),
    });
  }

  const compressed = compressSync(buffer, algorithm, config);

  return new Response(compressed as BodyInit, {
    status: res.status,
    statusText: res.statusText,
    headers: buildHeaders(res.headers, algorithm, compressed.byteLength),
  });
}

/**
 * Add Vary: Accept-Encoding header to a response without compressing it.
 * Used when we skip compression but still need correct caching behavior.
 */
export function addVaryHeader(res: Response): Response {
  // If the response already has the correct Vary header, return as-is
  const vary = res.headers.get("vary");
  if (vary) {
    if (vary === "*") return res;
    const values = vary.split(",").map((v) => v.trim().toLowerCase());
    if (values.includes("accept-encoding")) return res;
  }

  // Clone headers and add Vary
  const headers = new Headers(res.headers);
  appendVary(headers, "Accept-Encoding");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
