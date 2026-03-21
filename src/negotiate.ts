import type { CompressionAlgorithm } from "./types";

interface EncodingEntry {
  algorithm: string;
  quality: number;
}

/**
 * Parse an Accept-Encoding header into entries with quality values.
 *
 * Examples:
 *   "gzip, br;q=0.8, zstd;q=1.0" → [{algorithm:"gzip",quality:1}, {algorithm:"br",quality:0.8}, {algorithm:"zstd",quality:1}]
 *   "*;q=0.5" → [{algorithm:"*",quality:0.5}]
 */
function parseAcceptEncoding(header: string): EncodingEntry[] {
  const entries: EncodingEntry[] = [];

  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [algorithm, ...params] = trimmed.split(";").map((s) => s.trim());
    let quality = 1.0;

    for (const param of params) {
      const match = param.match(/^q\s*=\s*([0-9.]+)$/i);
      if (match) {
        quality = parseFloat(match[1]);
        if (isNaN(quality)) quality = 1.0;
        quality = Math.max(0, Math.min(1, quality));
      }
    }

    entries.push({ algorithm: algorithm.toLowerCase(), quality });
  }

  return entries;
}

/**
 * Negotiate the best compression algorithm based on the Accept-Encoding header
 * and the server's preferred algorithm order.
 *
 * Returns the chosen algorithm, or null if no acceptable algorithm is found.
 *
 * Selection logic:
 * 1. Parse client's Accept-Encoding into {algorithm, quality} pairs
 * 2. Filter to only algorithms we support and the client accepts (q > 0)
 * 3. Handle wildcard (*) — gives unlisted supported algorithms the wildcard quality
 * 4. Sort by client quality descending, then by server preference order
 * 5. Return the top result
 */
export function negotiate(
  acceptEncoding: string,
  preferredOrder: CompressionAlgorithm[],
): CompressionAlgorithm | null {
  if (!acceptEncoding) return null;

  const entries = parseAcceptEncoding(acceptEncoding);
  if (entries.length === 0) return null;

  // Build a map of algorithm → quality from client preferences
  const clientPrefs = new Map<string, number>();
  let wildcardQuality: number | null = null;

  for (const entry of entries) {
    if (entry.algorithm === "*") {
      wildcardQuality = entry.quality;
    } else {
      clientPrefs.set(entry.algorithm, entry.quality);
    }
  }

  // Build candidates: supported algorithms that the client accepts
  const candidates: { algorithm: CompressionAlgorithm; quality: number; serverRank: number }[] = [];

  for (let i = 0; i < preferredOrder.length; i++) {
    const algo = preferredOrder[i];

    let quality: number | null = null;
    if (clientPrefs.has(algo)) {
      quality = clientPrefs.get(algo)!;
    } else if (wildcardQuality !== null) {
      quality = wildcardQuality;
    }

    // Skip if client doesn't accept this algorithm or explicitly rejects it (q=0)
    if (quality === null || quality === 0) continue;

    candidates.push({
      algorithm: algo,
      quality,
      serverRank: i,
    });
  }

  if (candidates.length === 0) return null;

  // Sort: highest quality first, then by server preference order (lower rank = more preferred)
  candidates.sort((a, b) => {
    if (a.quality !== b.quality) return b.quality - a.quality;
    return a.serverRank - b.serverRank;
  });

  return candidates[0].algorithm;
}
