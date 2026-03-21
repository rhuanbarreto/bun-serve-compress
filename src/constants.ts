import type { CompressionAlgorithm, ResolvedCompressionOptions } from "./types";

/**
 * Default algorithm preference order.
 * zstd is fastest with best ratio, brotli has great ratio, gzip is universal fallback.
 */
export const DEFAULT_ALGORITHMS: CompressionAlgorithm[] = ["zstd", "br", "gzip"];

/** Default compression levels per algorithm */
export const DEFAULT_GZIP_LEVEL = 6;
export const DEFAULT_BROTLI_LEVEL = 5; // NOT 11 — max quality is ~30x slower
export const DEFAULT_ZSTD_LEVEL = 3;

/** Minimum response size in bytes to trigger compression */
export const DEFAULT_MIN_SIZE = 1024;

/**
 * MIME types that should NOT be compressed (exact matches).
 * These are already compressed or binary formats where compression adds overhead.
 */
export const SKIP_MIME_TYPES: Set<string> = new Set([
  // Archives (already compressed)
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/x-tar",

  // Binary formats
  "application/wasm",
  "application/octet-stream",
  "application/pdf",

  // SSE — compression breaks chunked event delivery
  "text/event-stream",
]);

/**
 * MIME type prefixes that should NOT be compressed.
 * Entire categories of binary/compressed content.
 */
export const SKIP_MIME_PREFIXES: string[] = [
  "image/",   // except image/svg+xml — handled specially
  "audio/",
  "video/",
  "font/",
];

/**
 * MIME types that are exceptions to the prefix skip rules.
 * These are text-based formats within otherwise-binary categories.
 */
export const COMPRESSIBLE_EXCEPTIONS: Set<string> = new Set([
  "image/svg+xml",
]);

/**
 * HTTP status codes that indicate no body — skip compression.
 */
export const NO_BODY_STATUSES: Set<number> = new Set([
  101, // Switching Protocols (WebSocket)
  204, // No Content
  304, // Not Modified
]);

/**
 * Build the default resolved config.
 */
export function getDefaultResolvedConfig(): ResolvedCompressionOptions {
  return {
    disable: false,
    algorithms: [...DEFAULT_ALGORITHMS],
    gzip: { level: DEFAULT_GZIP_LEVEL },
    brotli: { level: DEFAULT_BROTLI_LEVEL },
    zstd: { level: DEFAULT_ZSTD_LEVEL },
    minSize: DEFAULT_MIN_SIZE,
    skipMimeTypes: new Set(SKIP_MIME_TYPES),
    skipMimePrefixes: [...SKIP_MIME_PREFIXES],
  };
}
