---
id: ARCH-001
title: Code Organization
domain: architecture
rules: true
files:
  - "src/**"
---

## Context

A library's source organization directly impacts maintainability, discoverability, and the cognitive load required to contribute. When a project ships raw TypeScript source files (per [GEN-001](./GEN-001-tech-stack-and-runtime.md)), the internal module structure is visible to consumers — disorganized code becomes a public liability.

Without a standardized code organization strategy, several problems emerge:

1. **Circular dependencies**: When modules import from barrel files (`index.ts`) internally, circular import chains form silently — especially in TypeScript where type-only imports can mask runtime circularity until a consumer encounters it
2. **Responsibility diffusion**: Without single-responsibility boundaries, compression logic, configuration parsing, and HTTP header manipulation accumulate in a single "god module," making it difficult to test, review, or modify any one concern in isolation
3. **Import path chaos**: Mixing path aliases (`@/compress`), absolute imports (`src/compress`), and relative imports (`./compress`) creates an inconsistent codebase that confuses contributors and breaks when module resolution settings change
4. **Subpath export leakage**: Framework adapters re-exported from the main barrel force consumers who only use `Bun.serve()` to resolve Elysia and Hono types, even when those frameworks are not installed

The TypeScript/JavaScript ecosystem uses several common organizational patterns:

1. **Feature-based directories** (`src/compression/`, `src/negotiation/`, `src/adapters/`): Groups related files into subdirectories, each with its own barrel file. Works well for large applications with 50+ modules, but adds unnecessary indirection for small libraries — a `src/compression/index.ts` that re-exports from `src/compression/engine.ts` is pure ceremony when the library has only 10 files.

2. **Layered architecture** (`src/core/`, `src/middleware/`, `src/plugins/`): Separates code by architectural layer. Appropriate for frameworks or applications with clear tier boundaries, but over-structures a focused library where the "core" is 5 files and "plugins" is 2 files.

3. **Monorepo packages** (`packages/core/`, `packages/hono/`, `packages/elysia/`): Splits the library into separate npm packages. Provides strong isolation but introduces package management overhead (workspaces, version synchronization, publish coordination) that is disproportionate for a library with 10 source files.

4. **Flat single-responsibility modules**: All source files live in a single `src/` directory, each with a clear, non-overlapping responsibility. A single barrel file (`index.ts`) exposes the public API. Framework adapters are published as subpath exports, not separate packages. This pattern works best for focused libraries with fewer than 20 modules.

For bun-serve-compress, the flat single-responsibility pattern is the established and correct choice. The library has exactly 10 source files, each with a clear responsibility: `compress.ts` handles compression, `negotiate.ts` handles algorithm selection, `skip.ts` handles skip logic, `config.ts` resolves configuration, `constants.ts` holds defaults, `types.ts` centralizes type definitions, `serve.ts` wraps `Bun.serve()`, and `hono.ts`/`elysia.ts` are thin framework adapters. This structure aligns with the zero-dependency philosophy in [GEN-003](./GEN-003-dependency-policy.md) — no build step, no complex module resolution, just direct file-to-file imports.

## Decision

All source code MUST be organized as **flat single-responsibility modules** in the `src/` directory. Framework adapters MUST be exposed as **subpath exports**, not re-exported from the main barrel. All internal imports MUST use **relative paths** with no barrel imports between modules.

### Scope

This ADR covers source directory structure, module boundaries, import/export patterns, and the package.json exports map. It does not cover test file organization (covered in [GEN-002](./GEN-002-testing-standards.md)), naming conventions (covered in [GEN-004](./GEN-004-code-style-and-formatting.md)), or CI pipeline structure.

### Module Architecture

The source tree is organized into four architectural layers, all within a flat `src/` directory:

| Layer              | Files                                    | Responsibility                                            |
| ------------------ | ---------------------------------------- | --------------------------------------------------------- |
| Core engine        | `compress.ts`, `negotiate.ts`, `skip.ts` | Low-level compression, algorithm selection, skip criteria |
| Configuration      | `config.ts`, `constants.ts`, `types.ts`  | Options resolution, defaults, shared type definitions     |
| Server wrapper     | `serve.ts`                               | Wraps `Bun.serve()` with compression middleware           |
| Framework adapters | `hono.ts`, `elysia.ts`                   | Thin wrappers calling core functions for each framework   |
| Public API surface | `index.ts`                               | Barrel re-exports for external consumers only             |

### Import Rules

- All internal imports MUST use relative paths: `import { compress } from "./compress"`
- Type-only imports MUST use explicit syntax: `import type { ... } from "./types"` (per [GEN-004](./GEN-004-code-style-and-formatting.md))
- No source file may import from `./index` — the barrel file is exclusively for external consumers
- No path aliases (`@/`, `~/`, `#/`) are permitted

### Export Rules

- `index.ts` is the ONLY barrel file — it re-exports functions and types for the main `"."` entry point
- All exports MUST be named exports — no `export default` (enforced by oxlint per [GEN-004](./GEN-004-code-style-and-formatting.md))
- Framework adapters (`hono.ts`, `elysia.ts`) MUST NOT be re-exported from `index.ts` — they are accessed via subpath exports (`bun-serve-compress/hono`, `bun-serve-compress/elysia`)

### Package Exports Map

The `package.json` `"exports"` field MUST define:

```json
{
  ".": { "bun": "./src/index.ts", "import": "./src/index.ts", "types": "./src/index.ts" },
  "./elysia": { "bun": "./src/elysia.ts", "import": "./src/elysia.ts", "types": "./src/elysia.ts" },
  "./hono": { "bun": "./src/hono.ts", "import": "./src/hono.ts", "types": "./src/hono.ts" }
}
```

Each subpath entry MUST include `"bun"`, `"import"`, and `"types"` conditions pointing to the raw TypeScript source file (per [GEN-001](./GEN-001-tech-stack-and-runtime.md)).

## Implementation Pattern

### Good Example: Internal Module Importing

```typescript
// src/serve.ts — imports directly from specific modules
import { compress, addVaryHeader } from "./compress";
import { resolveConfig } from "./config";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type { ResolvedCompressionOptions, ServeCompressOptions } from "./types";
```

### Bad Example: Barrel Import Anti-Pattern

```typescript
// BAD: src/serve.ts importing from the barrel file
import { compress, resolveConfig, negotiate, shouldSkip } from "./index";
// This creates a circular dependency: index.ts re-exports from serve.ts,
// and serve.ts imports from index.ts
```

### Good Example: Framework Adapter Structure

```typescript
// src/hono.ts — thin wrapper calling core functions
import { createMiddleware } from "hono/factory";
import { compress as compressResponse, addVaryHeader } from "./compress";
import { resolveConfig } from "./config";
import { negotiate } from "./negotiate";
import { shouldSkip } from "./skip";
import type { CompressionOptions } from "./types";

export function compress(options?: CompressionOptions) {
  const config = resolveConfig(options);
  return createMiddleware(async (c, next) => {
    await next();
    // ...compression logic using core functions
  });
}
```

### Bad Example: Framework Adapter in Main Barrel

```typescript
// BAD: src/index.ts re-exporting framework adapters
export { compress as honoCompress } from "./hono"; // Forces hono resolution for all consumers
export { compress as elysiaCompress } from "./elysia"; // Forces elysia resolution for all consumers
```

## Do's and Don'ts

### Do

- **DO** keep `src/` flat — each file has exactly one responsibility, no nested subdirectories
- **DO** use `index.ts` as the sole barrel file, exclusively for external consumer re-exports
- **DO** import from specific modules using relative paths: `import { compress } from "./compress"`
- **DO** use explicit `import type { ... }` for imports that are only used as types
- **DO** centralize all type definitions in `src/types.ts` — types are shared across modules, not co-located
- **DO** centralize all constants and defaults in `src/constants.ts`
- **DO** expose framework adapters as subpath exports in `package.json` (`"./hono"`, `"./elysia"`)
- **DO** include `"bun"`, `"import"`, and `"types"` conditions for every entry in the exports map
- **DO** keep framework adapters thin — they MUST delegate to core functions (`compress`, `negotiate`, `shouldSkip`, `resolveConfig`) rather than reimplementing logic

### Don't

- **DON'T** create nested directories inside `src/` — no `src/utils/`, `src/lib/`, `src/core/`, `src/adapters/`
- **DON'T** import from `./index` within any `src/` file — this creates circular dependencies
- **DON'T** use path aliases (`@/`, `~/src/`, `#/`) — relative paths only
- **DON'T** use `export default` — all exports MUST be named (enforced by oxlint)
- **DON'T** re-export framework adapters from `index.ts` — they are accessed via subpath exports only
- **DON'T** duplicate core logic in framework adapters — adapters MUST call core functions, not copy their implementations
- **DON'T** scatter type definitions across implementation files — keep shared types in `types.ts`

## Consequences

### Positive

- **Zero Import Indirection:** Direct file-to-file imports mean no barrel file resolution chains, no re-export layers, and no hidden circular dependencies
- **Single-Responsibility Clarity:** Each file's purpose is immediately obvious from its name — `negotiate.ts` handles negotiation, `skip.ts` handles skip logic, `compress.ts` handles compression
- **Consumer Isolation:** Subpath exports ensure that consumers using only `Bun.serve()` never trigger resolution of Hono or Elysia types, avoiding "module not found" errors when those optional peer dependencies are not installed
- **Grep-Friendly:** A flat directory with 10 files is trivially searchable — `grep -r "shouldSkip" src/` returns results from exactly the files that matter
- **Minimal Cognitive Load:** New contributors can understand the entire module graph by reading 10 filenames — no directory hierarchy to navigate, no barrel file chains to trace
- **Framework Adapter Independence:** Adding a new framework adapter (e.g., `express.ts`) requires only creating one file and adding one subpath export — no changes to `index.ts` or the core modules

### Negative

- **Flat Directory Scaling Limit:** If the library grows beyond ~20 source files, the flat structure becomes harder to navigate. At that point, a feature-based directory structure would be more appropriate
- **Types Centralization Trade-off:** Keeping all types in `types.ts` means that file grows proportionally with the API surface. For this library (5 types, 81 lines), this is fine; for a larger API, co-located types would be more maintainable
- **Adapter Duplication:** Each framework adapter imports and calls the same 4-5 core functions, creating a mild structural duplication. This is intentional — the alternative (a shared adapter base) would add an abstraction layer that does not reduce complexity

### Risks

- **Circular Dependency Introduction:** A contributor may accidentally import from `./index` within a source file, creating a subtle circular dependency that manifests only at runtime. **Mitigation:** The Archgate rule `no-barrel-self-import` automatically detects `./index` imports in `src/` files. Code reviewers MUST also check import paths during review.
- **Subpath Export Misconfiguration:** A missing or incorrect condition in the `package.json` exports map can cause "module not found" errors for consumers. **Mitigation:** Each subpath entry MUST include all three conditions (`bun`, `import`, `types`), and the CI test suite validates that framework adapter imports resolve correctly in integration tests.
- **Module Count Growth:** As new features are added, the temptation to add "just one more file" to `src/` may push the flat structure past its practical limit. **Mitigation:** If the file count exceeds 20, this ADR MUST be revisited and updated to define a directory structure. Until then, the flat approach remains optimal for the current 10-file library.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `no-barrel-self-import`**: Verifies that no `src/` file imports from `./index` — barrel imports are reserved for external consumers
- **Archgate rule `no-path-aliases`**: Verifies that no `src/` file uses path alias imports (`@/`, `~/`, `#/`)
- **oxlint `import/prefer-default-export: off`** and **`import/no-named-export: off`**: Ensures named exports are the standard (default exports produce lint warnings via other oxlint rules)
- **TypeScript compiler (`tsc --noEmit`)**: Catches unresolvable imports at compile time

### Manual Enforcement

- Code reviewers MUST verify that new source files are placed directly in `src/` — no nested directories
- Code reviewers MUST verify that new framework adapters delegate to core functions rather than reimplementing logic
- Code reviewers MUST verify that `index.ts` changes are limited to re-exports — no logic, no side effects
- Code reviewers MUST verify that new subpath exports include all three conditions (`bun`, `import`, `types`)

### Exceptions

Creating a subdirectory within `src/` requires explicit project maintainer approval and an update to this ADR documenting the new directory's purpose and boundaries. Subdirectories are expected only if the library grows beyond 20 source files.

## References

- [GEN-001: Tech Stack and Runtime](./GEN-001-tech-stack-and-runtime.md) — ESM module system, `"bundler"` module resolution, raw TypeScript shipping
- [GEN-003: Dependency Policy](./GEN-003-dependency-policy.md) — package.json exports structure, zero runtime dependencies
- [GEN-004: Code Style and Formatting](./GEN-004-code-style-and-formatting.md) — file naming (kebab-case), named exports, `import type` syntax
- [Node.js Subpath Exports Documentation](https://nodejs.org/api/packages.html#subpath-exports)
- [Bun Module Resolution](https://bun.sh/docs/runtime/modules)
- [TypeScript Module Resolution — Bundler Mode](https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler)
