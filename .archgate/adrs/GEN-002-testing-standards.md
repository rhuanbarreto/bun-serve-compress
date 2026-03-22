---
id: GEN-002
title: Testing Standards
domain: general
rules: true
files:
  - "tests/**"
---

## Context

A compression middleware library operates at the HTTP transport layer, where subtle bugs — incorrect headers, corrupted payloads, broken streaming, algorithm negotiation failures — are invisible to type checkers and linters. Only a comprehensive test suite that exercises real compression against real HTTP servers can provide confidence that the library behaves correctly across the full matrix of algorithms, content types, status codes, and client negotiation patterns.

Without standardized testing practices, several problems emerge:

1. **Inconsistent test tooling**: Developers may introduce Jest, Vitest, or Mocha alongside `bun:test`, creating configuration conflicts and split test runner behavior
2. **Mock-driven false confidence**: Mocking Bun's compression APIs (e.g., stubbing `Bun.gzipSync`) verifies the test author's assumptions, not actual compression behavior — roundtrip integrity bugs slip through
3. **Test file sprawl**: Tests placed in arbitrary locations (`src/__tests__/`, `test/`, `spec/`) or using inconsistent naming (`*.spec.ts`, `*.test.tsx`) make discovery unreliable and CI configuration fragile
4. **Missing verification layers**: Tests that check only the compressed output without verifying decompression roundtrip, or that verify headers without verifying the body, leave critical gaps
5. **Undocumented test provenance**: Without reference comments, reviewers cannot trace test cases back to the real-world scenarios (Express, Fastify, Koa, Nginx) they were designed to validate

The JavaScript testing ecosystem offers several options:

1. **Jest**: The most popular test runner, but requires transpilation for TypeScript, adds significant `node_modules` weight, and does not integrate with Bun's native APIs. Its module mocking system encourages the mock-heavy patterns this project explicitly avoids.

2. **Vitest**: A modern Vite-based runner with good TypeScript support and Jest-compatible API. However, it introduces a Vite dependency, runs on Node.js by default, and does not have access to Bun-specific globals (`Bun.serve`, `Bun.gzipSync`) without additional configuration.

3. **Mocha + Chai**: A flexible, mature combination. However, it requires separate assertion libraries, TypeScript transpilation plugins, and manual lifecycle management. Its flexibility encourages inconsistent test structures across contributors.

4. **bun:test**: Bun's built-in test runner. Zero-dependency, native TypeScript execution, full access to all Bun APIs, built-in `expect` assertions, and `describe`/`test` blocks. Runs tests in the same runtime as production code, eliminating environment discrepancies.

For bun-serve-compress, the test runner must have direct access to `Bun.serve()`, `Bun.gzipSync()`, `Bun.zstdCompressSync()`, and `CompressionStream`. Only `bun:test` provides this without additional configuration. The library's 234+ tests exercise real HTTP servers, real compression, and real decompression — mocking would defeat the purpose. This decision is a direct consequence of the Bun-only runtime choice established in [GEN-001](./GEN-001-tech-stack-and-runtime.md).

## Decision

All tests in this project MUST use **`bun:test`** as the exclusive test runner, follow the **file-per-module** naming convention, and exercise **real implementations** — no mocking of Bun-native APIs or HTTP server behavior.

### Scope

This ADR covers the test runner, test file organization, test naming conventions, and test patterns. It does not cover code coverage thresholds, performance benchmarks, or CI pipeline configuration — those are addressed in dedicated ADRs.

### Test Runner: bun:test

- All test files MUST import from `"bun:test"` exclusively
- The `bun test` command (defined in `package.json` scripts as `"test": "bun test"`) is the sole test execution method
- Tests run natively in Bun — no transpilation, no bundling, no separate test environment
- Integration with [GEN-001](./GEN-001-tech-stack-and-runtime.md): tests leverage the same Bun runtime and APIs as production code

### File Organization

- Test files MUST reside in the `tests/` directory at the project root
- Each source module in `src/` MUST have a corresponding test file: `tests/<module>.test.ts`
- Test files MUST use the `.test.ts` extension — not `.spec.ts`, `.test.tsx`, or other variations
- Helper functions (e.g., `makeRequest()`, `makeResponse()`) are defined within the test file that uses them

### Test Patterns

Tests in this project follow these mandatory patterns:

- **Integration tests**: Exercise real HTTP servers created with `Bun.serve()` or framework adapters, using `beforeAll`/`afterAll` for server lifecycle
- **Roundtrip verification**: Compress with the library's APIs, then decompress with Bun/Node native decompressors (`Bun.gunzipSync`, `brotliDecompressSync`) to verify payload integrity
- **Header mutation verification**: Assert `Content-Encoding`, `Content-Length`, `Vary`, and `ETag` headers after compression
- **Reference documentation**: Test file headers MUST include JSDoc comments citing the source implementations (Express, Fastify, Koa, Nginx, Go gziphandler) that inspired the test cases, with GitHub links

## Implementation Pattern

### Good Example: Integration Test with Real HTTP Server

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";

const largeBody = "Test content for compression. ".repeat(100);

describe("serve() integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0, // Random port to avoid conflicts
      compression: { algorithms: ["zstd", "br", "gzip"] },
      routes: {
        "/text": new Response(largeBody, {
          headers: { "content-type": "text/html" },
        }),
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server.stop(true));

  test("compresses with gzip and roundtrips correctly", async () => {
    const res = await fetch(`${baseUrl}/text`, {
      headers: { "accept-encoding": "gzip" },
      decompress: false, // Bun auto-decompresses; disable for verification
    });

    expect(res.headers.get("content-encoding")).toBe("gzip");
    const compressed = new Uint8Array(await res.arrayBuffer());
    const decompressed = Bun.gunzipSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(largeBody);
  });
});
```

### Bad Example: Mocked Compression Test

```typescript
// BAD: Mocking Bun.gzipSync defeats the purpose of testing real compression
import { describe, test, expect, mock } from "bun:test";

const mockGzip = mock(() => new Uint8Array([1, 2, 3]));
// This test verifies mock behavior, NOT compression correctness
test("compresses response", async () => {
  const result = mockGzip(new Uint8Array([4, 5, 6]));
  expect(result).toEqual(new Uint8Array([1, 2, 3])); // Always passes, proves nothing
});
```

### Good Example: Test File Header with Reference Documentation

```typescript
/**
 * Skip logic tests — determines when compression should be bypassed.
 *
 * Test cases inspired by:
 *
 * - Express/compression: Cache-Control no-transform (RFC 7234 S5.2.2.4)
 *   https://github.com/expressjs/compression/blob/master/test/compression.js
 *
 * - Go net/http gziphandler: threshold boundary conditions
 *   https://github.com/nytimes/gziphandler/blob/master/gzip_test.go
 */
import { describe, expect, test } from "bun:test";
```

## Do's and Don'ts

### Do

- **DO** import test utilities exclusively from `"bun:test"`: `describe`, `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock`
- **DO** place all test files in the `tests/` directory with the naming pattern `tests/<module>.test.ts`
- **DO** use `Bun.serve({ port: 0 })` for integration tests — port 0 assigns a random available port, avoiding conflicts in parallel test runs
- **DO** call `server.stop(true)` in `afterAll` to ensure the HTTP server is fully shut down after each test suite
- **DO** verify compression roundtrips by decompressing with native APIs (`Bun.gunzipSync`, `brotliDecompressSync` from `node:zlib`) and comparing against the original payload
- **DO** verify HTTP header mutations after compression: `Content-Encoding`, `Content-Length`, `Vary`, and `ETag` weak conversion
- **DO** include JSDoc reference comments at the top of each test file citing the source implementations that inspired the test cases
- **DO** use `fetch(url, { decompress: false })` when testing compressed responses — Bun's `fetch` auto-decompresses by default
- **DO** define test helper functions (`makeRequest()`, `makeResponse()`) within the test file that uses them, not in shared utility modules

### Don't

- **DON'T** use Jest (`@jest/globals`), Vitest (`vitest`), Mocha (`mocha`), or any test runner other than `bun:test`
- **DON'T** mock Bun-native APIs (`Bun.gzipSync`, `Bun.zstdCompressSync`, `Bun.serve`, `CompressionStream`) — always test against real implementations
- **DON'T** place test files inside `src/` — source and test directories MUST remain separate
- **DON'T** use `.spec.ts`, `.test.tsx`, or any extension other than `.test.ts` for test files
- **DON'T** hardcode server ports in tests — always use `port: 0` and read the assigned port from the server instance
- **DON'T** create shared test utility modules in `tests/utils/` or `tests/helpers/` — keep helpers co-located in the test file that uses them
- **DON'T** skip decompression verification — testing that a response has `Content-Encoding: gzip` without verifying the body decompresses correctly is an incomplete test

## Consequences

### Positive

- **Runtime Parity:** Tests run in the exact same Bun runtime as production code, eliminating environment discrepancies that plague Node.js-based test runners testing Bun libraries
- **Zero Configuration:** `bun:test` requires no `jest.config.ts`, no `vitest.config.ts`, no transpilation plugins — the test command is simply `bun test`
- **Real Compression Verification:** Roundtrip testing catches actual compression bugs (truncated streams, incorrect headers, algorithm mismatches) that mocked tests would miss
- **Discoverable Structure:** The file-per-module convention (`tests/<module>.test.ts`) makes it trivial to find tests for any source module and verify test coverage visually
- **Traceable Test Cases:** Reference comments linking to Express, Fastify, Koa, Nginx, and Go implementations provide reviewers with context for why each test exists and what real-world scenario it validates
- **Fast Execution:** `bun:test` runs significantly faster than Jest or Vitest — the full 234+ test suite completes in seconds, enabling rapid iteration
- **Native TypeScript:** No transpilation step means test files execute directly, stack traces point to actual source lines, and debugging is straightforward

### Negative

- **Bun-Only Tests:** The test suite cannot run on Node.js or in any CI environment without Bun installed. Contributors without Bun must install it before running tests
- **No Mocking Ecosystem:** By prohibiting mocks of Bun APIs, certain edge cases (e.g., simulating compression failures, out-of-memory scenarios) are harder to test in isolation
- **Co-located Helpers:** Requiring helper functions within each test file may lead to minor duplication across test files (e.g., `makeRequest()` in `skip.test.ts` and similar patterns elsewhere)

### Risks

- **bun:test API Changes:** Bun's test runner API is still evolving and may introduce breaking changes. **Mitigation:** The project pins a minimum Bun version (>= 1.3.3) per [GEN-001](./GEN-001-tech-stack-and-runtime.md), and the CI test matrix includes both the minimum version and `latest` to catch regressions early.
- **Port Exhaustion in CI:** Integration tests that spin up real HTTP servers could exhaust available ports if many test suites run in parallel. **Mitigation:** All tests use `port: 0` (OS-assigned) and call `server.stop(true)` in `afterAll`, ensuring ports are released immediately after each suite.
- **Test Suite Brittleness:** Real HTTP tests are inherently more brittle than unit tests with mocks — network timing, OS scheduling, and resource contention can cause flaky failures. **Mitigation:** Tests use `localhost` only (no network I/O), keep server lifecycles short via `beforeAll`/`afterAll`, and avoid timing-dependent assertions.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `test-runner-bun-only`**: Verifies that test files import from `"bun:test"` and do not import from `jest`, `vitest`, `mocha`, or other test runners
- **Archgate rule `test-file-location`**: Verifies that `.test.ts` files exist only in the `tests/` directory and that no test files exist in `src/`
- **CI pipeline**: `bun test` runs on every PR in a Bun version matrix (1.3.3 and latest) per the CI workflow

### Manual Enforcement

- Code reviewers MUST verify that new test files follow the `tests/<module>.test.ts` naming convention
- Code reviewers MUST verify that integration tests use `port: 0` and `server.stop(true)` lifecycle management
- Code reviewers MUST verify that compression tests include roundtrip decompression verification, not just header checks
- Code reviewers MUST verify that new test files include JSDoc reference comments when test cases are inspired by external implementations

### Exceptions

Any exception to this ADR (e.g., using a Node.js-specific testing utility for a specific edge case) MUST be approved by the project maintainer and documented as a code comment explaining why the exception is necessary.

## References

- [GEN-001: Tech Stack and Runtime](./GEN-001-tech-stack-and-runtime.md) — establishes Bun as the exclusive runtime, which directly mandates `bun:test`
- [bun:test Documentation](https://bun.sh/docs/cli/test)
- [Bun Test Runner API](https://bun.sh/docs/test/writing)
- [Express/compression Test Suite](https://github.com/expressjs/compression/blob/master/test/compression.js) — reference implementation for test case design
- [Fastify/fastify-compress Tests](https://github.com/fastify/fastify-compress/blob/master/test/global-compress.test.js) — reference for algorithm restriction and method-specific testing
- [Go gziphandler Tests](https://github.com/nytimes/gziphandler/blob/master/gzip_test.go) — reference for roundtrip verification and boundary condition testing
