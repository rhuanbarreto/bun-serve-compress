import { COMPRESSIBLE_EXCEPTIONS, NO_BODY_STATUSES } from "./constants";
import type { ResolvedCompressionOptions } from "./types";

/**
 * Extract the MIME type from a Content-Type header value.
 * Strips parameters like charset, boundary, etc.
 *
 * "text/html; charset=utf-8" → "text/html"
 */
function extractMimeType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Check if a MIME type matches the skip list.
 */
function mimeMatchesSkipList(
  mime: string,
  skipTypes: Set<string>,
  skipPrefixes: string[],
): boolean {
  // Exact match
  if (skipTypes.has(mime)) return true;

  // Check if it's an exception (e.g., image/svg+xml is compressible)
  if (COMPRESSIBLE_EXCEPTIONS.has(mime)) return false;

  // Prefix match (e.g., "image/", "audio/")
  for (const prefix of skipPrefixes) {
    if (mime.startsWith(prefix)) return true;
  }

  return false;
}

/**
 * Check if Cache-Control header contains the no-transform directive.
 * Per RFC 7234 Section 5.2.2.4, intermediaries MUST NOT alter the
 * representation when no-transform is present.
 */
function hasNoTransform(res: Response): boolean {
  const cacheControl = res.headers.get("cache-control");
  if (!cacheControl) return false;
  return cacheControl
    .split(",")
    .some((directive) => directive.trim().toLowerCase() === "no-transform");
}

/**
 * Determine whether compression should be skipped for this request/response pair.
 *
 * Returns true if compression should be SKIPPED (response passed through as-is).
 */
export function shouldSkip(
  req: Request,
  res: Response,
  config: ResolvedCompressionOptions,
): boolean {
  // 1. Compression disabled globally
  if (config.disable) return true;

  // 2. HEAD requests have no body to compress
  if (req.method === "HEAD") return true;

  // 3. Status codes that indicate no body
  if (NO_BODY_STATUSES.has(res.status)) return true;

  // 4. Response already has Content-Encoding (already compressed)
  if (res.headers.has("content-encoding")) return true;

  // 5. Response already has Transfer-Encoding set (already encoded)
  const transferEncoding = res.headers.get("transfer-encoding");
  if (transferEncoding) {
    const encodings = transferEncoding.toLowerCase();
    // Skip if there's a content encoding like deflate or gzip in Transfer-Encoding
    // (chunked alone is fine — it's just framing)
    if (
      encodings.includes("gzip") ||
      encodings.includes("deflate") ||
      encodings.includes("compress") ||
      encodings.includes("br") ||
      encodings.includes("zstd")
    ) {
      return true;
    }
  }

  // 6. Cache-Control: no-transform — MUST NOT alter representation (RFC 7234)
  if (hasNoTransform(res)) return true;

  // 7. No body
  if (res.body === null) return true;

  // 8. Check Content-Type against skip list
  const contentType = res.headers.get("content-type");
  if (contentType) {
    const mime = extractMimeType(contentType);
    if (mimeMatchesSkipList(mime, config.skipMimeTypes, config.skipMimePrefixes)) {
      return true;
    }
  }

  // 9. Body size below minimum threshold (only if Content-Length is known)
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size < config.minSize) return true;
  }

  // 10. User's custom shouldCompress function
  if (config.shouldCompress && !config.shouldCompress(req, res)) {
    return true;
  }

  return false;
}
