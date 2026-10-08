import {
  brotliCompressSync,
  constants as zlibConstants,
  createBrotliCompress,
  createGzip,
  createZstdCompress,
} from "node:zlib";
import { MAX_BUFFER_SIZE } from "./constants";
import type { CompressionAlgorithm, ResolvedCompressionOptions } from "./types";

/**
 * Compress data synchronously using the specified algorithm.
 *
 * Uses Bun's native sync compression functions for gzip and zstd,
 * and node:zlib's brotliCompressSync for brotli (Bun has no native
 * Bun.brotliCompressSync).
 */
function compressSync(
  data: Uint8Array<ArrayBuffer>,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): Uint8Array<ArrayBuffer> {
  switch (algorithm) {
    case "gzip":
      return Bun.gzipSync(data, {
        level: config.gzip.level as Bun.ZlibCompressionOptions["level"],
      });

    case "br": {
      const compressed = brotliCompressSync(data, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: config.brotli.level,
        },
      });
      return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    }

    case "zstd": {
      const compressed = Bun.zstdCompressSync(data, { level: config.zstd.level });
      // Bun allocates a fresh (never shared) ArrayBuffer for the output
      return new Uint8Array(
        compressed.buffer as ArrayBuffer,
        compressed.byteOffset,
        compressed.byteLength,
      );
    }
  }
}

/**
 * Create a compressed ReadableStream using the CompressionStream API.
 * Used for large bodies of known size, where per-chunk latency does not matter.
 */
function compressStream(body: ReadableStream, algorithm: CompressionAlgorithm): ReadableStream {
  // Bun names brotli "brotli" in CompressionStream; the HTTP token is "br"
  const format: Bun.CompressionFormat = algorithm === "br" ? "brotli" : algorithm;
  // The DOM lib types CompressionStream with the standard formats only
  return body.pipeThrough(new CompressionStream(format as CompressionFormat));
}

/**
 * Create a node:zlib streaming encoder for the algorithm.
 *
 * CompressionStream exposes no flush operation, so it holds data back until its
 * internal buffer fills or the input ends. These encoders support flush(), which
 * emits everything written so far as a decodable block.
 */
function createFlushableEncoder(
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
) {
  switch (algorithm) {
    case "gzip":
      return createGzip({ level: config.gzip.level });
    case "br":
      return createBrotliCompress({
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: config.brotli.level },
      });
    case "zstd":
      return createZstdCompress({
        params: { [zlibConstants.ZSTD_c_compressionLevel]: config.zstd.level },
      });
  }
}

const textEncoder = new TextEncoder();

/**
 * Normalize a chunk read from a response body stream to bytes.
 * Handler-provided streams may enqueue strings or any ArrayBuffer view.
 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return textEncoder.encode(value);
  throw new TypeError("Response body stream produced a chunk that is not bytes or a string");
}

/** Join chunks into one contiguous buffer. */
function concatChunks(chunks: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type BodyReader = ReadableStreamDefaultReader<unknown>;
type BodyReadResult = Awaited<ReturnType<BodyReader["read"]>>;

const PENDING = Symbol("pending");

/** Resolve with PENDING after the current macrotask, once all ready microtasks have run. */
function afterMicrotasks(): Promise<typeof PENDING> {
  const { promise, resolve } = Promise.withResolvers<typeof PENDING>();
  setImmediate(() => resolve(PENDING));
  return promise;
}

interface AvailableBody {
  chunks: Uint8Array[];
  size: number;
  /** The stream ended: `chunks` hold the entire body. */
  done: boolean;
  /** A read that had not resolved when draining stopped; its result belongs after `chunks`. */
  pending: Promise<BodyReadResult> | null;
}

/**
 * Read every chunk the body can deliver without waiting on I/O.
 *
 * Buffered bodies (strings, typed arrays, synchronously-filled streams) resolve each
 * read within the same macrotask, so they are read to the end. A stream still being
 * produced by the handler stops at the first read that has to wait, so nothing it
 * has not sent yet is waited on. Draining also stops once MAX_BUFFER_SIZE is passed.
 */
async function readAvailable(
  reader: BodyReader,
  chunks: Uint8Array[] = [],
  size = 0,
): Promise<AvailableBody> {
  if (size > MAX_BUFFER_SIZE) return { chunks, size, done: false, pending: null };

  const read = reader.read();
  const result = await Promise.race([read, afterMicrotasks()]);

  if (result === PENDING) return { chunks, size, done: false, pending: read };
  if (result.done) return { chunks, size, done: true, pending: null };

  const bytes = toBytes(result.value);
  chunks.push(bytes);
  return readAvailable(reader, chunks, size + bytes.byteLength);
}

/**
 * Compress a body that is still being produced, flushing the encoder after every
 * source chunk so each chunk reaches the client as soon as the handler emits it.
 *
 * `available` holds the chunks already read from `reader` (and possibly one
 * in-flight read); they are compressed first, in order.
 */
function compressLiveStream(
  reader: BodyReader,
  available: AvailableBody,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): ReadableStream<Uint8Array> {
  const encoder = createFlushableEncoder(algorithm, config);
  const output: Uint8Array[] = [];
  let pending = available.pending;

  encoder.on("data", (chunk: Buffer) => {
    output.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });

  const flush = (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    encoder.flush(() => resolve());
    return promise;
  };

  const finish = (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    encoder.once("end", () => resolve());
    encoder.end();
    return promise;
  };

  /** Move encoder output into the stream. Returns whether anything was enqueued. */
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>): boolean => {
    if (output.length === 0) return false;
    for (const chunk of output) controller.enqueue(chunk);
    output.length = 0;
    return true;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      encoder.on("error", (error) => controller.error(error));
      if (available.chunks.length === 0) return;
      for (const chunk of available.chunks) encoder.write(chunk);
      await flush();
      emit(controller);
    },

    async pull(controller) {
      // Reads until a chunk produces output: a pull that enqueues nothing is not
      // re-invoked by the stream machinery.
      const step = async (): Promise<void> => {
        const result = await (pending ?? reader.read());
        pending = null;

        if (result.done) {
          await finish();
          emit(controller);
          controller.close();
          return;
        }

        encoder.write(toBytes(result.value));
        await flush();
        if (!emit(controller)) await step();
      };

      try {
        await step();
      } catch (error) {
        encoder.destroy();
        throw error;
      }
    },

    async cancel(reason) {
      encoder.destroy();
      await reader.cancel(reason);
    },
  });
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
  if (compressedSize === null) {
    headers.delete("content-length");
  } else {
    headers.set("content-length", compressedSize.toString());
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

/** Build a compressed response from a fully buffered body. */
function compressBuffered(
  res: Response,
  buffer: Uint8Array<ArrayBuffer>,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): Response {
  const compressed = compressSync(buffer, algorithm, config);
  return new Response(compressed, {
    status: res.status,
    statusText: res.statusText,
    headers: buildHeaders(res.headers, algorithm, compressed.byteLength),
  });
}

/**
 * Compress an HTTP Response.
 *
 * Picks a strategy from what is known about the body:
 * - Content-Length <= 10 MB: buffered, synchronous compression
 * - Content-Length > 10 MB: streaming compression via CompressionStream
 * - No Content-Length: reads whatever the body delivers without waiting on I/O.
 *   If that is the whole body, the minSize check applies and it is compressed
 *   synchronously. Otherwise the body is still being produced, and it is
 *   compressed as a live stream that flushes after every chunk, so streamed
 *   responses (SSR, NDJSON, progress output) are not held back.
 *
 * Returns a new Response with compressed body and updated headers.
 */
export async function compress(
  res: Response,
  algorithm: CompressionAlgorithm,
  config: ResolvedCompressionOptions,
): Promise<Response> {
  // A consumed body cannot be read again — shouldn't happen but guard against it
  if (res.bodyUsed) return res;

  const body = res.body;
  if (!body) return res;

  const contentLength = res.headers.get("content-length");
  const knownSize = contentLength ? parseInt(contentLength, 10) : null;

  if (knownSize !== null && knownSize <= MAX_BUFFER_SIZE) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    return compressBuffered(res, buffer, algorithm, config);
  }

  if (knownSize !== null) {
    return new Response(compressStream(body, algorithm), {
      status: res.status,
      statusText: res.statusText,
      headers: buildHeaders(res.headers, algorithm, null),
    });
  }

  const reader: BodyReader = body.getReader();
  const available = await readAvailable(reader);

  if (available.done) {
    const buffer = concatChunks(available.chunks, available.size);

    if (buffer.byteLength < config.minSize) {
      // Below threshold — return uncompressed with original body
      return new Response(buffer, {
        status: res.status,
        statusText: res.statusText,
        headers: new Headers(res.headers),
      });
    }

    return compressBuffered(res, buffer, algorithm, config);
  }

  return new Response(compressLiveStream(reader, available, algorithm, config), {
    status: res.status,
    statusText: res.statusText,
    headers: buildHeaders(res.headers, algorithm, null),
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
