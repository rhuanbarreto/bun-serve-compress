---
id: GEN-003
title: Dependency Policy
domain: general
rules: true
---

## Context

Dependency management for a library is fundamentally different from dependency management for an application. A library's dependencies become transitive dependencies of every consumer — each runtime dependency added to `package.json` increases install size, widens the supply chain attack surface, and risks version conflicts in consumer projects. For a compression middleware library that sits in the critical HTTP request path, the dependency footprint must be as small as possible.

Without a standardized dependency policy, several problems arise:

1. **Dependency creep**: Contributors add "just one small utility" to `dependencies`, and over time the library accumulates a transitive dependency tree that dwarfs its own source code
2. **Package manager fragmentation**: Multiple lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`) in the same repository create confusion and CI inconsistencies
3. **Incorrect dependency categorization**: Framework integrations placed in `dependencies` instead of `peerDependencies` force consumers to install frameworks they do not use
4. **Non-reproducible installs**: Without lockfile enforcement in CI, builds may use different dependency versions than development, introducing subtle bugs

The JavaScript ecosystem provides several package managers:

1. **npm**: The default Node.js package manager. Mature and universally available, but significantly slower than alternatives for both installation and resolution. Its lockfile format (`package-lock.json`) is Node.js-centric and does not optimize for Bun's module resolution.

2. **Yarn (Classic/Berry)**: Offers workspaces and Plug'n'Play resolution. However, Yarn Berry's PnP mode is incompatible with Bun's module loader, and maintaining a separate `yarn.lock` alongside Bun's native lockfile creates redundancy.

3. **pnpm**: Uses a content-addressable store for disk efficiency. While fast and space-efficient, pnpm's symlink-based `node_modules` structure can cause issues with Bun's native module resolution, and adds another lockfile format.

4. **Bun**: Bun's built-in package manager. Fastest installation speed (up to 25x faster than npm), native binary lockfile (`bun.lock`), full `node_modules` compatibility, and tight integration with the Bun runtime. No additional tooling required.

For bun-serve-compress, Bun is the exclusive runtime per [GEN-001](./GEN-001-tech-stack-and-runtime.md), making Bun's package manager the natural and only sensible choice. The project currently ships with **zero runtime dependencies** — all functionality is implemented using Bun-native APIs. Framework adapters for Elysia and Hono are exposed as optional peer dependencies, ensuring consumers only install frameworks they actually use. This zero-dependency design is a core differentiator that MUST be preserved.

## Decision

This project MUST use **Bun** as the exclusive package manager, maintain **zero runtime dependencies**, and categorize all external framework integrations as **optional peer dependencies**.

### Scope

This ADR covers package manager selection, dependency categorization (`dependencies`, `devDependencies`, `peerDependencies`), lockfile management, and CI installation practices. It does not cover which specific dev tools to install — those decisions are covered in [GEN-001](./GEN-001-tech-stack-and-runtime.md) (TypeScript, bun-types) and future ADRs (linting, formatting).

### Package Manager: Bun

- All dependency operations MUST use `bun install`, `bun add`, and `bun remove`
- The project lockfile is `bun.lock` — this is the only lockfile that MUST be committed to version control
- CI pipelines MUST use `bun install --frozen-lockfile` to ensure reproducible builds
- Integration with [GEN-001](./GEN-001-tech-stack-and-runtime.md): Bun runtime mandates Bun package manager for consistent tooling

### Dependency Categorization

The project uses three dependency categories with strict placement rules:

- **`dependencies`**: MUST remain empty. This library ships zero runtime dependencies. All functionality is implemented with Bun-native APIs and standard Web APIs
- **`devDependencies`**: All development tooling (linters, formatters, type checkers, commit tools, release automation) and framework packages needed for testing
- **`peerDependencies`**: Optional framework integrations that consumers bring themselves. Each peer dependency MUST have a corresponding entry in `peerDependenciesMeta` with `"optional": true`

### Current Dependency Layout

| Category           | Packages                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `dependencies`     | (none — intentionally empty)                                                                        |
| `devDependencies`  | bun-types, typescript, oxlint, oxfmt, elysia, hono, commitizen, @commitlint/\*, @simple-release/npm |
| `peerDependencies` | elysia (>=1.0.0, optional), hono (>=4.0.0, optional)                                                |

## Do's and Don'ts

### Do

- **DO** use `bun install` for all dependency installation — never invoke another package manager
- **DO** use `bun install --frozen-lockfile` in all CI pipelines and automated environments
- **DO** commit `bun.lock` to version control and keep it up to date with every dependency change
- **DO** place all development tooling (linters, formatters, type checkers, test utilities) in `devDependencies`
- **DO** place framework integrations (Elysia, Hono, and any future adapters) in both `peerDependencies` and `devDependencies` — peer for consumers, dev for local development and testing
- **DO** mark every entry in `peerDependencies` as `"optional": true` in `peerDependenciesMeta`
- **DO** use wide semver ranges for peer dependencies (e.g., `>=1.0.0`) to maximize consumer compatibility
- **DO** use caret ranges (`^`) for dev dependencies to receive patch and minor updates

### Don't

- **DON'T** add any packages to the `dependencies` field — the library MUST ship with zero runtime dependencies
- **DON'T** use `npm install`, `npm add`, `yarn add`, `yarn install`, `pnpm add`, or `pnpm install`
- **DON'T** commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` to version control
- **DON'T** make peer dependencies required — every entry in `peerDependencies` MUST have `"optional": true` in `peerDependenciesMeta`
- **DON'T** use `bun install` without `--frozen-lockfile` in CI — mutable installs in automated environments risk non-reproducible builds
- **DON'T** pin exact versions for peer dependencies (e.g., `"elysia": "1.4.28"`) — use minimum version ranges to avoid forcing consumers into specific versions

## Consequences

### Positive

- **Zero Consumer Overhead:** No transitive dependencies means consumers add only the library's source code to their project — no hidden dependency tree, no version conflicts, no supply chain risk from third-party packages
- **Fast Installation:** Bun's package manager installs dependencies up to 25x faster than npm, reducing CI pipeline time and local development setup
- **Reproducible Builds:** `bun install --frozen-lockfile` guarantees identical dependency trees across all environments — development, CI, and production
- **Framework Flexibility:** Optional peer dependencies allow consumers to use bun-serve-compress with Elysia, Hono, both, or neither, without installing unused frameworks
- **Minimal Attack Surface:** Zero runtime dependencies means zero third-party code runs in production, eliminating the most common vector for supply chain attacks in npm packages
- **Single Toolchain:** Using Bun for both runtime and package management eliminates the cognitive overhead of maintaining separate tools and their configurations

### Negative

- **Contributor Friction:** Contributors accustomed to npm or Yarn must install Bun before contributing, which adds an onboarding step
- **No Runtime Dependency Escape Hatch:** The zero-dependency policy means any functionality that could be delegated to a well-tested library (e.g., MIME type detection, header parsing) must be implemented and maintained in-house
- **Peer Dependency Confusion:** Some consumers may not understand that optional peer dependencies require manual installation — they may encounter runtime errors when using `bun-serve-compress/hono` without having `hono` installed

### Risks

- **Bun Lockfile Format Changes:** Bun's lockfile format (`bun.lock`) may change between major versions, potentially breaking CI pipelines. **Mitigation:** The CI workflow pins Bun versions via `oven-sh/setup-bun@v2` and tests against both the minimum supported version (1.3.3) and `latest`, catching lockfile incompatibilities before they reach production.
- **Peer Dependency Version Conflicts:** Wide peer dependency ranges (e.g., `>=1.0.0`) may allow consumers to use framework versions with breaking API changes. **Mitigation:** Dev dependencies pin specific framework versions for testing, and the CI test matrix validates against these pinned versions. If a framework releases a breaking change, the peer range can be tightened in a patch release.
- **Accidental Runtime Dependency Addition:** A contributor may add a package to `dependencies` without realizing the zero-dependency policy. **Mitigation:** The Archgate rule `zero-runtime-deps` automatically flags any `dependencies` field in `package.json` as a violation.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule `zero-runtime-deps`**: Verifies that `package.json` has no `dependencies` field, or that the field is empty
- **Archgate rule `peer-deps-optional`**: Verifies that every entry in `peerDependencies` has a corresponding `"optional": true` entry in `peerDependenciesMeta`
- **Archgate rule `no-foreign-lockfiles`**: Warns if `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` exist in the project root
- **CI pipeline**: `bun install --frozen-lockfile` fails the build if the lockfile is out of date or missing

### Manual Enforcement

- Code reviewers MUST reject PRs that add packages to the `dependencies` field without explicit project maintainer approval
- Code reviewers MUST verify that new peer dependencies have corresponding `peerDependenciesMeta` entries with `"optional": true`
- Code reviewers MUST verify that `bun.lock` changes are intentional and correspond to `package.json` changes in the same PR

### Exceptions

Adding a runtime dependency is an extraordinary decision that MUST be approved by the project maintainer, documented as a code comment in `package.json` explaining the justification, and accompanied by a size impact analysis (before/after `bun install` size). The zero-dependency policy is a core project value — exceptions are expected to be extremely rare.

## References

- [GEN-001: Tech Stack and Runtime](./GEN-001-tech-stack-and-runtime.md) — establishes Bun as the exclusive runtime, mandating Bun as the package manager
- [GEN-002: Testing Standards](./GEN-002-testing-standards.md) — framework adapters in devDependencies are used for testing
- [Bun Package Manager Documentation](https://bun.sh/docs/cli/install)
- [Bun Lockfile Format](https://bun.sh/docs/install/lockfile)
- [npm Peer Dependencies Documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#peerdependencies)
