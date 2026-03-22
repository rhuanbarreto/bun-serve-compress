---
id: GEN-004
title: Code Style and Formatting
domain: general
rules: true
files:
  - "src/**"
  - "tests/**"
---

## Context

Code style consistency is a force multiplier for small projects with external contributors. When every file follows the same naming conventions, formatting rules, and documentation patterns, code reviews focus on logic and design rather than style debates. For a library like bun-serve-compress that ships raw TypeScript source (per [GEN-001](./GEN-001-tech-stack-and-runtime.md)), style consistency is especially visible — consumers read the source directly, and inconsistencies erode trust.

Without standardized style tooling, several problems emerge:

1. **Style debates in reviews**: Contributors argue over semicolons, quote style, and indentation instead of reviewing logic
2. **Inconsistent naming**: Files named `compressResponse.ts` alongside `skip.ts`, or types mixing `ICompression` with `CompressionAlgorithm`, create confusion about project conventions
3. **Missing documentation**: Public API functions without JSDoc force consumers to read implementation details to understand usage
4. **Tool fragmentation**: Multiple linters or formatters (ESLint + Prettier, Biome, dprint) create overlapping or conflicting rules and slower CI pipelines
5. **Undocumented constants**: Magic numbers and unlabeled constants scattered through source files make the code harder to audit and maintain

The JavaScript/TypeScript ecosystem offers several linting and formatting tool combinations:

1. **ESLint + Prettier**: The most established combination. ESLint handles code quality rules while Prettier handles formatting. However, ESLint is slow on large codebases (JavaScript-based), requires extensive plugin configuration for TypeScript, and the ESLint-Prettier integration adds complexity with `eslint-config-prettier` and `eslint-plugin-prettier`.

2. **Biome**: A unified linter and formatter written in Rust. Fast and ergonomic, but newer with fewer rules than ESLint and a smaller plugin ecosystem. Does not yet support all the TypeScript-specific, unicorn, jsdoc, and promise rules that oxlint provides.

3. **dprint**: A pluggable Rust-based formatter. Fast and configurable, but purely a formatter — requires a separate linter. Its TypeScript plugin is less mature than oxfmt's integration with the OXC parser.

4. **oxlint + oxfmt**: The Oxidation Compiler toolchain. Both tools are written in Rust, share the same parser (OXC), and are purpose-built for TypeScript. oxlint supports 304+ rules across correctness, suspicious, perf, pedantic, and style categories with plugins for TypeScript, unicorn, import, jsdoc, and promise. oxfmt provides deterministic formatting with zero configuration ambiguity. Both tools execute in milliseconds.

For bun-serve-compress, the Oxidation Compiler toolchain (oxlint + oxfmt) is the established choice. The project already has `.oxlintrc.json` with 304 active rules and `.oxfmtrc.json` with explicit formatting settings. Both tools run in CI on every PR (`bun run lint`, `bun run fmt:check`), and the combined `bun run check` script validates lint + format + typecheck in a single command. This ADR codifies these existing patterns as enforceable standards, aligned with the Bun-native toolchain philosophy established in [GEN-001](./GEN-001-tech-stack-and-runtime.md) and the dependency policy in [GEN-003](./GEN-003-dependency-policy.md).

## Decision

All source and test files MUST be linted with **oxlint** and formatted with **oxfmt**. All code MUST follow the project's established **naming conventions** and **documentation standards**.

### Scope

This ADR covers linting tool selection, formatting tool selection, naming conventions, and documentation standards. It does not cover TypeScript compiler configuration (covered in [GEN-001](./GEN-001-tech-stack-and-runtime.md)), test file organization (covered in [GEN-002](./GEN-002-testing-standards.md)), or CI pipeline structure (covered in a dedicated ADR).

### Linter: oxlint

- Configuration lives in `.oxlintrc.json` at the project root
- Plugins enabled: `typescript`, `unicorn`, `import`, `jsdoc`, `promise`
- Category severity levels: `correctness: error`, `suspicious: error`, `perf: error`, `pedantic: warn`, `style: warn`, `nursery: off`, `restriction: off`
- Test file overrides relax rules that are inappropriate for test code (e.g., `no-console: off`, `no-await-in-loop: off`)
- Commands: `bun run lint` (check), `bun run lint:fix` (auto-fix)

### Formatter: oxfmt

- Configuration lives in `.oxfmtrc.json` at the project root
- Settings: print width 100, tab width 2, spaces (no tabs), semicolons always, double quotes, trailing commas everywhere, final newline
- Commands: `bun run fmt` (format), `bun run fmt:check` (verify)

### Naming Conventions

| Element              | Convention             | Examples                                                                     |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Files                | lowercase kebab-case   | `compress.ts`, `negotiate.ts`, `serve.ts`                                    |
| Functions            | camelCase              | `shouldSkip`, `addVaryHeader`, `resolveConfig`                               |
| Types and Interfaces | PascalCase             | `CompressionAlgorithm`, `ServeCompressOptions`, `ResolvedCompressionOptions` |
| Exported constants   | SCREAMING_SNAKE_CASE   | `DEFAULT_ALGORITHMS`, `SKIP_MIME_TYPES`, `NO_BODY_STATUSES`                  |
| Local variables      | camelCase              | `acceptEncoding`, `compressedData`, `algorithm`                              |
| Type imports         | Explicit `import type` | `import type { CompressionOptions } from "./types"`                          |

### Documentation Standards

All public API functions (exported from `src/index.ts` or subpath exports) MUST have JSDoc comments containing:

- A 1-2 sentence summary of the function's purpose
- `@param` descriptions for non-obvious parameters
- `@example` blocks for framework adapter entry points (`compress()` in `hono.ts` and `elysia.ts`)
- References to relevant RFCs or specifications when implementing standards-based behavior (e.g., RFC 7234 Section 5.2.2.4 for Cache-Control no-transform)

Internal (non-exported) functions MUST have at minimum a one-line JSDoc summary.

## Implementation Pattern

### Good Example: Properly Documented and Named Module

```typescript
import type { CompressionAlgorithm, ResolvedCompressionOptions } from "./types";

/** Default algorithm preference order: zstd > brotli > gzip. */
export const DEFAULT_ALGORITHMS: CompressionAlgorithm[] = ["zstd", "br", "gzip"];

/** Default gzip compression level (1-9). */
export const DEFAULT_GZIP_LEVEL = 6;

/** Default brotli quality level. NOT 11 — max quality is ~30x slower. */
export const DEFAULT_BROTLI_LEVEL = 5;

/**
 * Resolve user-provided compression options into a complete configuration.
 *
 * Merges partial user options with defaults, ensuring all fields are present.
 */
export function resolveConfig(options?: CompressionOptions): ResolvedCompressionOptions {
  // ...implementation
}
```

### Bad Example: Inconsistent Style

```typescript
// BAD: Mixed naming conventions, missing JSDoc, default export
import { CompressionAlgorithm } from "./types"; // BAD: missing "import type"

export const defaultAlgorithms = ["zstd", "br", "gzip"]; // BAD: should be SCREAMING_SNAKE_CASE
export const DEFAULT_gzip_LEVEL = 6; // BAD: inconsistent casing

// BAD: no JSDoc comment on public function
export default function ResolveConfig(options?: any) {
  // BAD: default export, PascalCase function
  // ...
}
```

## Do's and Don'ts

### Do

- **DO** use `bun run lint` (oxlint) for linting and `bun run fmt` (oxfmt) for formatting
- **DO** run `bun run check` (lint + format check + typecheck) before committing — this is the single validation command
- **DO** name files in lowercase kebab-case: `compress.ts`, `negotiate.ts`, not `Compress.ts` or `compressResponse.ts`
- **DO** name functions and local variables in camelCase: `shouldSkip`, `resolveConfig`, `acceptEncoding`
- **DO** name types, interfaces, and classes in PascalCase: `CompressionAlgorithm`, `ServeCompressOptions`
- **DO** name exported constants in SCREAMING_SNAKE_CASE: `DEFAULT_ALGORITHMS`, `SKIP_MIME_TYPES`, `NO_BODY_STATUSES`
- **DO** use explicit `import type { ... }` syntax for imports that are only used as types
- **DO** write JSDoc comments on every exported function with at minimum a one-line summary
- **DO** include `@example` blocks in JSDoc for public API entry points (framework adapter `compress()` functions, the main `serve()` function)
- **DO** reference RFC numbers and section identifiers in comments when implementing standards-based behavior

### Don't

- **DON'T** use ESLint, Prettier, Biome, dprint, or any linter/formatter other than oxlint and oxfmt
- **DON'T** commit `.eslintrc*`, `.prettierrc*`, `biome.json`, or `dprint.json` configuration files
- **DON'T** disable oxlint rules in `.oxlintrc.json` without a comment explaining the justification — rule overrides MUST be intentional
- **DON'T** use `export default` — all exports MUST be named exports (enforced by oxlint import plugin)
- **DON'T** use `console.log` in source files — `no-console` is set to `warn` in oxlint; use it only in test files where the override permits it
- **DON'T** mix naming conventions within a category — if a file has `DEFAULT_ALGORITHMS` as SCREAMING_SNAKE_CASE, do not add `defaultMinSize` in the same file
- **DON'T** leave exported functions without JSDoc comments — undocumented public API is a review blocker

## Consequences

### Positive

- **Speed:** oxlint and oxfmt are Rust-based and execute in milliseconds — the full lint + format check runs in under 2 seconds, enabling pre-commit validation without developer friction
- **Zero Configuration Ambiguity:** `.oxlintrc.json` and `.oxfmtrc.json` are explicit, version-controlled configurations with no hidden defaults or cascading config files
- **Comprehensive Coverage:** 304 active oxlint rules across 5 plugins (typescript, unicorn, import, jsdoc, promise) catch a wide range of correctness, performance, and style issues
- **Consistent Consumer Experience:** Since the library ships raw TypeScript, consumers read source files directly — consistent style and documentation make the codebase approachable
- **Shared Parser:** oxlint and oxfmt share the OXC parser, eliminating the AST compatibility issues that plague ESLint + Prettier configurations
- **Self-Documenting Code:** Mandatory JSDoc with `@example` blocks means the source code serves as its own API reference, reducing reliance on external documentation

### Negative

- **Contributor Learning Curve:** Contributors familiar with ESLint and Prettier must learn oxlint/oxfmt conventions and configuration patterns, which have less community documentation
- **Fewer Third-Party Plugins:** oxlint's plugin ecosystem is smaller than ESLint's — specialized rules (e.g., accessibility, React-specific) are unavailable, though irrelevant for this backend library
- **Opinionated Formatting:** oxfmt's formatting decisions (double quotes, trailing commas everywhere, 100-char width) may conflict with contributors' personal preferences — these are non-negotiable project standards

### Risks

- **oxlint/oxfmt Breaking Changes:** The Oxidation Compiler toolchain is actively developed and may introduce breaking changes in rule behavior or configuration format. **Mitigation:** Pin versions in `devDependencies` (oxlint `^1.56.0`, oxfmt `^0.41.0`) and validate upgrades in CI before merging. The caret range allows patch updates while preventing unexpected major version jumps.
- **Rule Drift:** Disabling rules without documentation creates a "swiss cheese" configuration where important checks are silently missing. **Mitigation:** The `.oxlintrc.json` already documents overrides, and code reviews MUST verify that any new rule disablement has a clear justification.
- **JSDoc Maintenance Burden:** Requiring JSDoc on all exported functions adds writing overhead and risks stale documentation when function behavior changes. **Mitigation:** JSDoc comments are reviewed alongside code changes in PRs. The `jsdoc` oxlint plugin warns about malformed or incomplete JSDoc, catching obvious staleness.

## Compliance and Enforcement

### Automated Enforcement

- **oxlint**: Runs via `bun run lint` on every PR in CI — lint violations fail the build
- **oxfmt**: Runs via `bun run fmt:check` on every PR in CI — formatting deviations fail the build
- **TypeScript compiler**: Runs via `bun run typecheck` — type errors fail the build
- **Combined check**: `bun run check` runs all three in sequence
- **Archgate rule `no-foreign-style-tools`**: Verifies that no ESLint, Prettier, Biome, or dprint configuration files exist in the project
- **Archgate rule `constants-naming`**: Verifies that exported `const` declarations in `src/constants.ts` use SCREAMING_SNAKE_CASE
- **Archgate rule `public-api-jsdoc`**: Informational check that exported functions in `src/` files have JSDoc comments

### Manual Enforcement

- Code reviewers MUST verify that new files follow the kebab-case naming convention
- Code reviewers MUST verify that new exported functions have JSDoc comments with at minimum a one-line summary
- Code reviewers MUST verify that any new oxlint rule disablement in `.oxlintrc.json` has a documented justification
- Code reviewers MUST reject PRs that introduce formatting inconsistencies (tabs vs spaces, mixed quote styles)

### Exceptions

Disabling an oxlint rule for a specific file or line MUST use an inline `// oxlint-disable-next-line <rule-name>` comment with a brief justification. Global rule disablement in `.oxlintrc.json` MUST be approved by the project maintainer.

## References

- [GEN-001: Tech Stack and Runtime](./GEN-001-tech-stack-and-runtime.md) — TypeScript strict mode complements linting
- [GEN-002: Testing Standards](./GEN-002-testing-standards.md) — test files follow the same style conventions with relaxed overrides
- [GEN-003: Dependency Policy](./GEN-003-dependency-policy.md) — oxlint and oxfmt are devDependencies
- [oxlint Documentation](https://oxc.rs/docs/guide/usage/linter)
- [oxfmt Documentation](https://oxc.rs/docs/guide/usage/formatter)
- [OXC Project — Oxidation Compiler](https://oxc.rs/)
- [JSDoc Reference](https://jsdoc.app/)
