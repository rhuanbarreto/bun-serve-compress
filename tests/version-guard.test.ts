/**
 * Bun version guard tests.
 *
 * Verifies that the library correctly checks the Bun runtime version
 * using Bun.semver.satisfies() and refuses to load on unsupported versions.
 * The guard runs on module load and requires Bun >= 1.3.3
 * (CompressionStream + zstd support).
 */
import { describe, expect, test } from "bun:test";

describe("version guard", () => {
  test("current Bun version satisfies >= 1.3.3", () => {
    expect(Bun.semver.satisfies(Bun.version, ">=1.3.3")).toBe(true);
  });

  test("library loads without error on current Bun version", async () => {
    // The import itself is the test — if the version guard throws,
    // this file would fail to load entirely.
    const mod = await import("../src/serve");
    expect(mod.serve).toBeFunction();
  });

  test("Bun.version is a valid semver string", () => {
    expect(Bun.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("Bun.semver.satisfies boundary checks", () => {
  // Verify the semver range we use in the guard correctly
  // accepts/rejects the expected versions.

  const range = ">=1.3.3";

  test("rejects versions below 1.3.3", () => {
    expect(Bun.semver.satisfies("1.3.2", range)).toBe(false);
    expect(Bun.semver.satisfies("1.2.0", range)).toBe(false);
    expect(Bun.semver.satisfies("1.3.0", range)).toBe(false);
    expect(Bun.semver.satisfies("0.9.0", range)).toBe(false);
    expect(Bun.semver.satisfies("1.0.0", range)).toBe(false);
  });

  test("accepts version 1.3.3 exactly", () => {
    expect(Bun.semver.satisfies("1.3.3", range)).toBe(true);
  });

  test("accepts versions above 1.3.3", () => {
    expect(Bun.semver.satisfies("1.3.4", range)).toBe(true);
    expect(Bun.semver.satisfies("1.3.9", range)).toBe(true);
    expect(Bun.semver.satisfies("1.3.11", range)).toBe(true);
    expect(Bun.semver.satisfies("1.4.0", range)).toBe(true);
    expect(Bun.semver.satisfies("2.0.0", range)).toBe(true);
  });
});
