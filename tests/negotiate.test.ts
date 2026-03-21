import { describe, expect, test } from "bun:test";
import { negotiate } from "../src/negotiate";

const DEFAULT_ORDER = ["zstd", "br", "gzip"] as const;

describe("negotiate", () => {
  describe("basic selection", () => {
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
      expect(negotiate("gzip, br, zstd", [...DEFAULT_ORDER])).toBe("zstd");
    });
  });

  describe("quality weights", () => {
    test("respects client quality weights over server preference", () => {
      expect(negotiate("zstd;q=0.5, br;q=1.0, gzip;q=0.1", [...DEFAULT_ORDER])).toBe("br");
    });

    test("handles q=0 rejection", () => {
      expect(negotiate("br;q=0, zstd;q=0, gzip", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("returns null when all algorithms are rejected", () => {
      expect(negotiate("br;q=0, zstd;q=0, gzip;q=0", [...DEFAULT_ORDER])).toBeNull();
    });

    test("handles malformed quality values gracefully", () => {
      expect(negotiate("gzip;q=abc", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("clamps quality to 0-1 range", () => {
      expect(negotiate("gzip;q=2.0, br;q=0.5", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("handles quality value of 0.0", () => {
      expect(negotiate("gzip;q=0.0", [...DEFAULT_ORDER])).toBeNull();
    });

    test("handles quality value of 1.0", () => {
      expect(negotiate("gzip;q=1.0", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("handles quality with no decimal", () => {
      expect(negotiate("gzip;q=1", [...DEFAULT_ORDER])).toBe("gzip");
    });
  });

  describe("wildcard", () => {
    test("wildcard (*) matches server's top preference", () => {
      expect(negotiate("*", [...DEFAULT_ORDER])).toBe("zstd");
    });

    test("wildcard with lower quality than specific", () => {
      expect(negotiate("gzip, *;q=0.1", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("wildcard q=0 rejects all unlisted", () => {
      expect(negotiate("gzip, *;q=0", [...DEFAULT_ORDER])).toBe("gzip");
    });
  });

  describe("identity handling", () => {
    test("identity alone returns null (no compression)", () => {
      expect(negotiate("identity", [...DEFAULT_ORDER])).toBeNull();
    });

    test("identity with gzip picks gzip", () => {
      expect(negotiate("identity, gzip", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("identity;q=0 with gzip picks gzip", () => {
      expect(negotiate("identity;q=0, gzip", [...DEFAULT_ORDER])).toBe("gzip");
    });
  });

  describe("case insensitivity", () => {
    test("handles uppercase GZIP", () => {
      expect(negotiate("GZIP", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("handles mixed case GZip", () => {
      expect(negotiate("GZip", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("handles uppercase BR", () => {
      expect(negotiate("BR", [...DEFAULT_ORDER])).toBe("br");
    });

    test("handles uppercase ZSTD", () => {
      expect(negotiate("ZSTD", [...DEFAULT_ORDER])).toBe("zstd");
    });
  });

  describe("whitespace handling", () => {
    test("handles extra whitespace between entries", () => {
      expect(negotiate("  gzip  ,  br ; q=0.8  ", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("handles whitespace around quality value", () => {
      expect(negotiate("gzip ; q = 0.5, br;q=1.0", [...DEFAULT_ORDER])).toBe("br");
    });

    test("handles no spaces", () => {
      expect(negotiate("gzip,br,zstd", [...DEFAULT_ORDER])).toBe("zstd");
    });

    test("handles trailing comma", () => {
      expect(negotiate("gzip,", [...DEFAULT_ORDER])).toBe("gzip");
    });
  });

  describe("unsupported algorithms", () => {
    test("ignores unsupported algorithms", () => {
      expect(negotiate("deflate, identity", [...DEFAULT_ORDER])).toBeNull();
    });

    test("handles mixed supported and unsupported", () => {
      expect(negotiate("deflate, gzip, identity", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("ignores sdch", () => {
      expect(negotiate("sdch, gzip", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("ignores x-gzip (not mapped)", () => {
      expect(negotiate("x-gzip", [...DEFAULT_ORDER])).toBeNull();
    });
  });

  describe("server preference order", () => {
    test("respects custom server preference order", () => {
      expect(negotiate("gzip, br, zstd", ["gzip", "br", "zstd"])).toBe("gzip");
    });

    test("single algorithm preference", () => {
      expect(negotiate("gzip, br, zstd", ["br"])).toBe("br");
    });

    test("server only supports gzip, client wants br", () => {
      expect(negotiate("br", ["gzip"])).toBeNull();
    });
  });

  describe("real-world browser headers", () => {
    test("Chrome/Firefox: gzip, deflate, br, zstd", () => {
      expect(negotiate("gzip, deflate, br, zstd", [...DEFAULT_ORDER])).toBe("zstd");
    });

    test("Safari: gzip, deflate, br", () => {
      expect(negotiate("gzip, deflate, br", [...DEFAULT_ORDER])).toBe("br");
    });

    test("older browser: gzip, deflate", () => {
      expect(negotiate("gzip, deflate", [...DEFAULT_ORDER])).toBe("gzip");
    });

    test("curl default (no encoding)", () => {
      expect(negotiate("", [...DEFAULT_ORDER])).toBeNull();
    });

    test("curl --compressed: deflate, gzip, br, zstd", () => {
      expect(negotiate("deflate, gzip, br, zstd", [...DEFAULT_ORDER])).toBe("zstd");
    });
  });
});
