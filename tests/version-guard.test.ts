/**
 * Bun version guard tests.
 *
 * Verifies that the library loads successfully on the current Bun version.
 * The guard in serve.ts runs on module import and requires Bun >= 1.3.3.
 */
import { describe, expect, test } from "bun:test";

describe("version guard", () => {
  test("library loads without error on current Bun version", async () => {
    const mod = await import("../src/serve");
    expect(mod.serve).toBeFunction();
  });
});
