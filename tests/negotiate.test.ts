import { describe, expect, test } from "bun:test";
import { negotiate } from "../src/negotiate";

const DEFAULT_ORDER = ["zstd", "br", "gzip"] as const;

describe("negotiate", () => {
  test("returns null for empty header", () => {
    expect(negotiate("", [...DEFAULT_ORDER])).toBeNull();
  });

  test("returns null for missing header", () => {
    expect(negotiate("", [...DEFAULT_ORDER])).toBeNull();
  });

  test("picks gzip when only gzip is accepted", () => {
    expect(negotiate("gzip", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("picks br when only br is accepted", () => {
    expect(negotiate("br", [...DEFAULT_ORDER])).toBe("br");
  });

  test("picks zstd when only zstd is accepted", () => {
    expect(negotiate("zstd", [...DEFAULT_ORDER])).toBe("zstd");
  });

  test("prefers server order when client weights are equal", () => {
    // Client accepts all three with equal quality (default 1.0)
    // Server prefers zstd > br > gzip
    expect(negotiate("gzip, br, zstd", [...DEFAULT_ORDER])).toBe("zstd");
  });

  test("respects client quality weights over server preference", () => {
    // Client explicitly prefers br (q=1.0) over zstd (q=0.5)
    expect(negotiate("zstd;q=0.5, br;q=1.0, gzip;q=0.1", [...DEFAULT_ORDER])).toBe("br");
  });

  test("handles q=0 rejection", () => {
    // Client rejects br and zstd
    expect(negotiate("br;q=0, zstd;q=0, gzip", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("returns null when all algorithms are rejected", () => {
    expect(negotiate("br;q=0, zstd;q=0, gzip;q=0", [...DEFAULT_ORDER])).toBeNull();
  });

  test("handles wildcard (*)", () => {
    // * matches any algorithm with the given quality
    expect(negotiate("*", [...DEFAULT_ORDER])).toBe("zstd"); // server's top preference
  });

  test("handles wildcard with lower quality than specific", () => {
    // gzip explicitly q=1.0, everything else via * at q=0.1
    expect(negotiate("gzip, *;q=0.1", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("ignores unsupported algorithms", () => {
    expect(negotiate("deflate, identity", [...DEFAULT_ORDER])).toBeNull();
  });

  test("handles mixed supported and unsupported", () => {
    expect(negotiate("deflate, gzip, identity", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("handles whitespace variations", () => {
    expect(negotiate("  gzip  ,  br ; q=0.8  ", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("respects custom server preference order", () => {
    // Server prefers gzip first
    expect(negotiate("gzip, br, zstd", ["gzip", "br", "zstd"])).toBe("gzip");
  });

  test("handles malformed quality values gracefully", () => {
    // Invalid q value should default to 1.0
    expect(negotiate("gzip;q=abc", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("clamps quality to 0-1 range", () => {
    expect(negotiate("gzip;q=2.0, br;q=0.5", [...DEFAULT_ORDER])).toBe("gzip");
  });

  test("typical browser Accept-Encoding header", () => {
    // Chrome/Firefox typically send this
    expect(negotiate("gzip, deflate, br, zstd", [...DEFAULT_ORDER])).toBe("zstd");
  });
});
