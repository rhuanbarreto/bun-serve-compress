/**
 * Supported compression algorithms.
 * Names match the Accept-Encoding header values.
 */
export type CompressionAlgorithm = "zstd" | "br" | "gzip";

/**
 * Per-algorithm quality/level settings.
 */
export interface AlgorithmOptions {
  /**
   * Compression level.
   * - gzip: 1-9 (default 6)
   * - brotli: 0-11 (default 5, NOT 11 which is too slow for real-time)
   * - zstd: 1-22 (default 3)
   */
  level?: number;
}

/**
 * Compression configuration options.
 */
export interface CompressionOptions {
  /** Disable compression entirely. Default: false */
  disable?: boolean;

  /** Algorithm preference order. Default: ['zstd', 'br', 'gzip'] */
  algorithms?: CompressionAlgorithm[];

  /** Per-algorithm settings */
  gzip?: AlgorithmOptions;
  brotli?: AlgorithmOptions;
  zstd?: AlgorithmOptions;

  /** Minimum response body size in bytes to compress. Default: 1024 */
  minSize?: number;

  /** Additional MIME types to skip (merged with built-in skip list) */
  skipMimeTypes?: string[];

  /** Override the entire skip list instead of merging with built-in list */
  overrideSkipMimeTypes?: string[];

  /**
   * Custom function to decide whether to compress a response.
   * Return true to compress, false to skip.
   * Called after all other skip checks pass.
   */
  shouldCompress?: (req: Request, res: Response) => boolean;
}

/**
 * Resolved compression config with all defaults applied.
 * All fields are guaranteed to be present.
 */
export interface ResolvedCompressionOptions {
  disable: boolean;
  algorithms: CompressionAlgorithm[];
  gzip: Required<AlgorithmOptions>;
  brotli: Required<AlgorithmOptions>;
  zstd: Required<AlgorithmOptions>;
  minSize: number;
  skipMimeTypes: Set<string>;
  skipMimePrefixes: string[];
  shouldCompress?: (req: Request, res: Response) => boolean;
}

/**
 * Options for the `serve()` function.
 *
 * Extends Bun's native `Serve.Options` with an optional `compression` field.
 * All Bun.serve() type inference (route params, WebSocket data, etc.) is preserved.
 */
export type ServeCompressOptions<
  WebSocketData = undefined,
  R extends string = string,
> = Bun.Serve.Options<WebSocketData, R> & {
  /** Compression configuration. Omit or pass `false` to disable. */
  compression?: CompressionOptions | false;
};
