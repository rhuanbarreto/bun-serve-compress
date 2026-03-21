import { getDefaultResolvedConfig, SKIP_MIME_TYPES } from "./constants";
import type { CompressionOptions, ResolvedCompressionOptions } from "./types";

/**
 * Resolve user-provided compression options into a fully-populated config
 * with all defaults applied.
 */
export function resolveConfig(options?: CompressionOptions | false): ResolvedCompressionOptions {
  const defaults = getDefaultResolvedConfig();

  if (options === false || options?.disable) {
    return { ...defaults, disable: true };
  }

  if (!options) return defaults;

  const config: ResolvedCompressionOptions = {
    disable: false,
    algorithms: options.algorithms ?? defaults.algorithms,
    gzip: { level: options.gzip?.level ?? defaults.gzip.level },
    brotli: { level: options.brotli?.level ?? defaults.brotli.level },
    zstd: { level: options.zstd?.level ?? defaults.zstd.level },
    minSize: options.minSize ?? defaults.minSize,
    skipMimeTypes: defaults.skipMimeTypes,
    skipMimePrefixes: defaults.skipMimePrefixes,
    shouldCompress: options.shouldCompress,
  };

  // Handle custom skip MIME types
  if (options.overrideSkipMimeTypes) {
    config.skipMimeTypes = new Set(options.overrideSkipMimeTypes);
    config.skipMimePrefixes = []; // user took full control
  } else if (options.skipMimeTypes) {
    // Merge with defaults
    config.skipMimeTypes = new Set([...SKIP_MIME_TYPES, ...options.skipMimeTypes]);
  }

  return config;
}
