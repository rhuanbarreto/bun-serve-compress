/**
 * Check If-Modified-Since against the file's modification time
 * (RFC 9110 Section 13.1.3). HTTP dates have one-second precision.
 */
function isNotModified(req: Request, lastModified: number): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  // If-None-Match takes precedence over If-Modified-Since (RFC 9110 Section 13.2.2)
  if (req.headers.has("if-none-match")) return false;

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (!ifModifiedSince) return false;

  const since = Date.parse(ifModifiedSince);
  if (Number.isNaN(since)) return false;

  return Math.floor(lastModified / 1000) <= Math.floor(since / 1000);
}

/**
 * Detect a path-backed `Bun.file()` value used as a route.
 *
 * In Bun every Blob carries the BunFile methods (`exists()`, `stat()`, …); only a
 * file opened by path has a string `name`.
 */
export function isBunFile(value: unknown): value is Bun.BunFile {
  return value instanceof Blob && typeof (value as Bun.BunFile).name === "string";
}

/**
 * Build the response for a `Bun.file()` route, matching Bun's native file routes:
 * 404 for a missing file, Content-Type, Content-Length and Last-Modified headers,
 * and 304 for a satisfied If-Modified-Since.
 *
 * A request with a Range header gets a plain file-backed Response, which Bun
 * answers with 206 Partial Content (Bun >= 1.4). The caller must not compress it,
 * because the range applies to the unencoded bytes.
 *
 * @example
 * ```ts
 * const res = await fileResponse(req, Bun.file("./public/app.js"));
 * ```
 */
export async function fileResponse(req: Request, file: Bun.BunFile): Promise<Response> {
  if (!(await file.exists())) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers({
    "content-type": file.type,
    "last-modified": new Date(file.lastModified).toUTCString(),
  });

  if (isNotModified(req, file.lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  if (req.headers.has("range")) {
    return new Response(file, { headers });
  }

  headers.set("content-length", file.size.toString());
  return new Response(file, { headers });
}
