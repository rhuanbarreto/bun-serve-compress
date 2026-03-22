---
id: GEN-001
title: Tech Stack and Runtime
domain: general
rules: true
---

## Context

HTTP response compression is a performance-critical operation that benefits directly from tight integration with the server runtime. A compression middleware library must choose a runtime and language that provides native, high-performance compression primitives — delegating to external C bindings or WASM modules introduces unnecessary overhead and complexity.

The JavaScript/TypeScript server ecosystem offers several runtime options:

1. **Node.js**: The established runtime with mature `zlib` bindings. However, Node.js lacks a built-in HTTP server that matches Bun.serve()'s architecture, and its compression APIs require manual buffer management. Node.js does not natively support zstd compression, requiring third-party native modules.

2. **Deno**: Offers TypeScript-first development and Web API alignment. However, Deno's server API (`Deno.serve`) differs from Bun's, and Deno lacks built-in synchronous compression primitives like `Bun.gzipSync()` and `Bun.zstdCompressSync()`.

3. **Bun**: Provides native synchronous compression APIs (`Bun.gzipSync`, `Bun.deflateSync`, `Bun.zstdCompressSync`), a high-performance `Bun.serve()` HTTP server, `CompressionStream` with zstd support (from v1.3.3), and built-in semver utilities. Bun's APIs are purpose-built for the exact operations this library performs.

For bun-serve-compress, the runtime choice is not a preference but a hard constraint. The library wraps `Bun.serve()` directly, uses Bun-specific synchronous compression APIs for bodies under 10 MB, and relies on `CompressionStream` with zstd support for streaming larger bodies. These APIs have no equivalent in Node.js or Deno. The library cannot function outside the Bun runtime.

Similarly, TypeScript with strict mode is essential for a library that exposes complex generic types (`ServeCompressOptions<R, WS>`, `FetchHandler<WS>`, `WrapTarget<WS>`) to consumers. Strict mode catches type errors at compile time that would otherwise surface as runtime bugs in consumer applications.

## Decision

All source code in this project MUST target the **Bun runtime** (version >= 1.3.3) and be written in **TypeScript** with strict mode enabled.

### Scope

This ADR covers runtime selection, TypeScript configuration, and module system settings. It does not cover linting, formatting, testing, or dependency management — those are addressed in dedicated ADRs.

### Runtime: Bun >= 1.3.3

- The minimum Bun version is **1.3.3**, required for `CompressionStream` with zstd algorithm support
- The version constraint MUST be enforced both at build time (`engines.bun` in `package.json`) and at runtime (version guard in `src/serve.ts`)
- The canonical minimum version MUST be defined in `src/constants.ts` as `MIN_BUN_VERSION_RANGE` and kept in sync with `package.json`
- Bun-native APIs MUST be used for all compression operations: `Bun.gzipSync()`, `Bun.deflateSync()`, `Bun.zstdCompressSync()`, and `CompressionStream`
- `Bun.semver.satisfies()` MUST be used for version checking

### Language: TypeScript (Strict)

- `tsconfig.json` MUST set `"strict": true`
- Target MUST be `"ESNext"` — no downlevel compilation
- Module system MUST be `"ESNext"` with `"moduleResolution": "bundler"`
- Type definitions MUST use `"bun-types"` exclusively
- `"noEmit": true` — the library ships raw `.ts` files consumed directly by Bun

### Module System

- `package.json` MUST set `"type": "module"`
- Exports MUST use the `"bun"` condition field alongside `"import"` and `"types"`
- Source files are shipped directly (no build step) — the `"files"` array includes `"src"`

## Do's and Don'ts

### Do

- **DO** use Bun-native compression APIs (`Bun.gzipSync`, `Bun.deflateSync`, `Bun.zstdCompressSync`) for synchronous compression of bodies <= 10 MB
- **DO** use `CompressionStream` for streaming compression of bodies > 10 MB
- **DO** keep `MIN_BUN_VERSION_RANGE` in `src/constants.ts` synchronized with `engines.bun` in `package.json`
- **DO** run the runtime version check (`checkBunVersion()`) on module load in `src/serve.ts`
- **DO** use `Bun.semver.satisfies()` for all version comparisons — never parse version strings manually
- **DO** maintain `"strict": true` in `tsconfig.json` for all source code
- **DO** use explicit `import type { ... }` syntax for type-only imports
- **DO** target `"ESNext"` — leverage the latest ECMAScript features natively supported by Bun
- **DO** ship raw TypeScript source files — Bun consumes `.ts` directly without a build step

### Don't

- **DON'T** use Node.js-specific APIs (`node:fs`, `node:path`, `node:zlib`, `node:crypto`, `node:stream`, etc.) in `src/` files when Bun equivalents exist
- **DON'T** add Node.js polyfills, compatibility shims, or cross-runtime abstraction layers
- **DON'T** lower the TypeScript `strict` setting or disable individual strict checks (`noImplicitAny`, `strictNullChecks`, etc.)
- **DON'T** change `moduleResolution` from `"bundler"` or `module` from `"ESNext"`
- **DON'T** add a build/transpilation step — the library MUST ship raw `.ts` files
- **DON'T** use `require()` or CommonJS patterns — all imports MUST use ESM `import` syntax
- **DON'T** add `@types/node` to dependencies — use `bun-types` exclusively for type definitions

## Consequences

### Positive

- **Native Performance:** Bun's synchronous compression APIs (`gzipSync`, `zstdCompressSync`) avoid async overhead for small-to-medium payloads, enabling single-digit microsecond compression for typical HTTP responses
- **Zero Build Step:** Shipping raw TypeScript eliminates build tooling complexity, reduces CI time, and ensures consumers always debug against actual source code
- **Type Safety:** TypeScript strict mode catches null reference errors, implicit `any` usage, and incorrect generic instantiations at compile time rather than at runtime
- **Modern APIs:** Targeting ESNext means no polyfills, no downlevel transforms, and full access to modern JavaScript features (using, decorators, etc.) as Bun supports them
- **Consistent Versioning:** Dual enforcement of the Bun version constraint (build-time via `engines` and runtime via `checkBunVersion()`) prevents silent failures when consumers run unsupported Bun versions
- **Simplified Exports:** The `"bun"` condition in package.json exports ensures Bun resolves to TypeScript source directly, with no `.js`/`.d.ts` indirection

### Negative

- **Bun Lock-In:** The library cannot run on Node.js, Deno, or any other JavaScript runtime. Users who migrate away from Bun must find an alternative compression library
- **Limited Audience:** Bun's market share is smaller than Node.js, which limits the library's potential user base
- **No Pre-Built Distribution:** Shipping raw `.ts` files means non-Bun tooling (bundlers, editors, type checkers) may need additional configuration to resolve the package correctly

### Risks

- **Bun API Instability:** Bun is pre-1.0 in some API areas and may change or deprecate APIs like `Bun.gzipSync()` or `Bun.semver`. **Mitigation:** The runtime version guard in `src/serve.ts` will catch incompatible Bun versions immediately on module load. Pin the minimum version to a known-good release and test against the `latest` Bun version in CI (already configured in the test matrix).
- **Native Compression in Bun:** Bun issue #2726 tracks potential built-in response compression in `Bun.serve()`. If implemented, this library could cause double-compression. **Mitigation:** Monitor the issue. When Bun ships native compression, add detection logic to disable the library's compression when native compression is active, or document the migration path.
- **TypeScript Version Drift:** Strict mode behavior evolves across TypeScript versions, potentially introducing new errors on upgrade. **Mitigation:** Pin TypeScript to `^5.7` in devDependencies and validate upgrades in CI before merging.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `tsconfig-strict`**: Verifies `tsconfig.json` has `"strict": true`, target `"ESNext"`, and module resolution `"bundler"`
- **Archgate rule `bun-version-sync`**: Verifies `engines.bun` in `package.json` matches the version range used in source code
- **Archgate rule `no-node-imports`**: Warns when `node:*` protocol imports appear in `src/` files
- **CI pipeline**: `tsc --noEmit` runs on every PR to enforce TypeScript strict compliance

### Manual Enforcement

- Code reviewers MUST verify that new Bun API usage is available in the minimum supported Bun version (>= 1.3.3)
- Code reviewers MUST reject PRs that introduce Node.js-specific imports in `src/` without a documented exception
- Code reviewers MUST verify that any change to `MIN_BUN_VERSION_RANGE` is accompanied by a corresponding update to `engines.bun`

### Exceptions

Any exception to this ADR (e.g., temporarily using a Node.js API for a feature Bun does not yet support) MUST be approved by the project maintainer and documented as a code comment referencing the Bun issue tracking the missing API.

## References

- [Bun Runtime Documentation](https://bun.sh/docs)
- [Bun.serve() API](https://bun.sh/docs/api/http)
- [Bun Compression APIs](https://bun.sh/docs/api/utils#bun-gzipsync)
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict)
- [Bun Issue #2726 — Native Response Compression](https://github.com/oven-sh/bun/issues/2726)
- [CompressionStream Web API](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream)
