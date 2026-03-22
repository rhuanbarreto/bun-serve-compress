---
id: ARCH-002
title: CI/CD Pipeline Standards
domain: architecture
rules: false
files:
  - ".github/workflows/**"
---

## Context

A library published to npm requires a robust CI/CD pipeline that catches regressions before merge, validates compatibility across supported runtime versions, enforces commit message conventions for automated changelogs, and publishes releases with supply chain provenance. Without standardized pipeline practices, several problems emerge:

1. **Undetected regressions**: Without mandatory lint, format, type, and test checks on every PR, broken code merges to main and reaches consumers via automated releases
2. **Version compatibility gaps**: Testing only against the latest Bun version misses regressions on the minimum supported version (1.3.3), which consumers may still use
3. **Inconsistent release process**: Manual releases are error-prone — forgotten version bumps, missing changelogs, incorrect npm tags, and unsigned packages erode consumer trust
4. **Commit message chaos**: Without enforced conventions, `git log` becomes a mix of "fix stuff", "wip", and "update", making automated changelog generation impossible
5. **Duplicate pipeline runs**: Without concurrency controls, pushing multiple commits in quick succession spawns parallel CI runs that waste resources and produce confusing status checks

The CI/CD landscape offers several approaches:

1. **Jenkins / Self-hosted**: Maximum control and customization. However, requires infrastructure maintenance, has no native GitHub integration, and adds operational overhead disproportionate to a small open-source library.

2. **GitLab CI**: Tightly integrated with GitLab repositories. Not applicable — this project is hosted on GitHub.

3. **CircleCI / Travis CI**: Established third-party CI services with GitHub integration. However, they require separate account management, have slower cold-start times than GitHub Actions, and add a third-party dependency to the release pipeline.

4. **GitHub Actions**: Native GitHub integration, zero infrastructure overhead, extensive action marketplace, built-in concurrency controls, OIDC-based npm provenance support, and free for public repositories. The `oven-sh/setup-bun` action provides first-class Bun runtime setup.

For bun-serve-compress, GitHub Actions is the established CI/CD platform. The project uses two workflows: `ci.yml` for validation (lint, format, typecheck, test) and `release.yml` for automated releases via `TrigenSoftware/simple-release-action`. This pipeline enforces every governance decision in the project — the Bun version matrix validates [GEN-001](./GEN-001-tech-stack-and-runtime.md), `bun test` validates [GEN-002](./GEN-002-testing-standards.md), frozen lockfile validates [GEN-003](./GEN-003-dependency-policy.md), and lint/format checks validate [GEN-004](./GEN-004-code-style-and-formatting.md). The CI pipeline is the enforcement backbone for all ADRs.

## Decision

All CI/CD pipelines MUST use **GitHub Actions** with two workflows: a **CI workflow** (`ci.yml`) that validates every PR and push to main, and a **Release workflow** (`release.yml`) that automates versioning and npm publishing. **Conventional commits** MUST be enforced via commitlint on PR titles.

### Scope

This ADR covers CI/CD platform selection, workflow structure, job configuration, concurrency controls, conventional commit enforcement, and release automation. It does not cover the specific lint rules, test patterns, or dependency management — those are covered in [GEN-004](./GEN-004-code-style-and-formatting.md), [GEN-002](./GEN-002-testing-standards.md), and [GEN-003](./GEN-003-dependency-policy.md) respectively.

### CI Workflow: `.github/workflows/ci.yml`

The CI workflow MUST run on every pull request targeting `main`, every push to `main`, and support `workflow_dispatch` and `workflow_call` triggers. It consists of two mandatory jobs:

**Job: `check` (Lint, Format & Typecheck)**

- Runs on `ubuntu-latest` with Bun `latest`
- Skips draft PRs (`github.event.pull_request.draft == false`)
- Steps: checkout, setup-bun, `bun install --frozen-lockfile`, commitlint validation (PR titles only), `bun run lint`, `bun run fmt:check`, `bun run typecheck`

**Job: `test` (Bun Version Matrix)**

- Runs on `ubuntu-latest` with a Bun version matrix
- Matrix MUST include the minimum supported Bun version (`1.3.3` per [GEN-001](./GEN-001-tech-stack-and-runtime.md)) and `latest`
- Steps: checkout, setup-bun (matrix version), `bun install --frozen-lockfile`, `bun test`

**Concurrency:** The CI workflow MUST use a concurrency group scoped to the workflow and PR number (or ref), with `cancel-in-progress: true` to abort superseded runs.

**Permissions:** The CI workflow MUST use minimal permissions (`contents: read`).

### Release Workflow: `.github/workflows/release.yml`

The release workflow automates versioning, changelog generation, and npm publishing using `TrigenSoftware/simple-release-action@v1`.

**Triggers:** `issue_comment` (for release commands) and `push` to `main`.

**Jobs:**

- `check`: Context validation — determines whether to create a release PR or publish a release
- `pull-request`: Creates or updates the release PR, then triggers CI on the release branch and propagates status checks
- `release`: Validates (`bun run check && bun test`), then publishes to npm with provenance

**Concurrency:** The release workflow MUST use a constant concurrency group (`release`) to prevent duplicate release PRs. The `release` job MUST use a separate `release-publish` concurrency group with `cancel-in-progress: false` to prevent interrupted publishes.

**Permissions:** The release workflow requires `actions: write`, `contents: write`, `id-token: write` (for npm provenance), `pull-requests: write`, and `statuses: write`.

**npm Provenance:** The release job MUST set `NPM_CONFIG_PROVENANCE: "true"` to enable SLSA provenance attestation on published packages.

### Conventional Commits

- All PR titles MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification, validated by commitlint with `@commitlint/config-conventional`
- Accepted commit types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `perf`, `test`, `build`, `style`, `revert`
- The `bun run commit` script (commitizen) provides an interactive conventional commit prompt for local development
- Conventional commit types drive automated versioning: `feat` triggers a minor bump, `fix` triggers a patch bump, and `feat!`/`fix!` (breaking changes) trigger a major bump

## Do's and Don'ts

### Do

- **DO** use `oven-sh/setup-bun@v2` for Bun installation in all workflow jobs
- **DO** run `bun install --frozen-lockfile` as the first step after setup in every CI job — never use a mutable install
- **DO** include both the minimum Bun version (`1.3.3`) and `latest` in the test matrix
- **DO** validate PR titles against conventional commit format using `commitlint` in the `check` job
- **DO** use concurrency groups with `cancel-in-progress: true` on the CI workflow to abort superseded runs
- **DO** use a constant concurrency group (`release`) on the release workflow to serialize release operations
- **DO** set `NPM_CONFIG_PROVENANCE: "true"` in the release job for supply chain security
- **DO** run the full validation suite (`bun run check && bun test`) in the release job before publishing
- **DO** use `actions/checkout@v4` for repository checkout in all jobs
- **DO** skip CI checks on draft PRs (`github.event.pull_request.draft == false`)

### Don't

- **DON'T** remove the Bun version matrix from the test job — testing only against `latest` misses minimum-version regressions
- **DON'T** use `cancel-in-progress: true` on the release `release-publish` concurrency group — interrupted publishes can leave npm in an inconsistent state
- **DON'T** skip the `check` job (lint, format, typecheck) — these are mandatory quality gates that enforce [GEN-004](./GEN-004-code-style-and-formatting.md) and [GEN-001](./GEN-001-tech-stack-and-runtime.md)
- **DON'T** publish to npm without provenance (`NPM_CONFIG_PROVENANCE: "true"`) — unsigned packages are a supply chain risk
- **DON'T** bypass commitlint validation — PR titles MUST conform to conventional commit format for automated changelog generation
- **DON'T** grant permissions beyond what each workflow requires — CI uses `contents: read` only; release uses the minimum set for publishing and PR management

## Consequences

### Positive

- **Automated Quality Gates:** Every PR is automatically validated against lint, format, typecheck, and test suites before merge — no manual enforcement needed for [GEN-001](./GEN-001-tech-stack-and-runtime.md) through [GEN-004](./GEN-004-code-style-and-formatting.md)
- **Version Compatibility Assurance:** The Bun version matrix catches regressions on the minimum supported version (1.3.3), ensuring consumers on older Bun versions are not silently broken
- **Zero-Touch Releases:** The release pipeline handles version bumping, changelog generation, and npm publishing automatically — no manual steps, no human error
- **Supply Chain Security:** npm provenance via OIDC attestation links every published package version to a specific GitHub Actions run, allowing consumers to verify the package was built from the claimed source
- **Resource Efficiency:** Concurrency groups with `cancel-in-progress: true` ensure only the latest push to a PR runs CI, saving GitHub Actions minutes and reducing noise
- **Automated Changelogs:** Conventional commits provide structured metadata that drives automated changelog generation — `feat:` entries appear under "Features", `fix:` entries under "Bug Fixes"
- **Draft PR Respect:** Skipping checks on draft PRs avoids wasting CI resources on work-in-progress code

### Negative

- **GitHub Actions Lock-In:** The pipeline is tightly coupled to GitHub Actions (matrix syntax, concurrency groups, OIDC provenance). Migrating to another CI platform would require significant rewriting
- **Third-Party Action Dependency:** The release pipeline depends on `TrigenSoftware/simple-release-action@v1`, which is an external action not under project control. Breaking changes or abandonment would require migration
- **Conventional Commit Overhead:** Enforcing conventional commits adds friction to contributors who are not familiar with the format, potentially slowing initial contributions

### Risks

- **GitHub Actions Outage:** A GitHub Actions outage blocks all CI validation and releases. **Mitigation:** This is an accepted risk for a free, open-source project. The `workflow_dispatch` trigger allows manual re-runs after recovery. Critical releases can be performed locally with `npm publish` as a last resort.
- **simple-release-action Breaking Changes:** A major version bump to `TrigenSoftware/simple-release-action` may break the release workflow. **Mitigation:** The action is pinned to `@v1` (major version tag). Monitor the action's release notes and test upgrades in a separate branch before merging.
- **Bun Version Matrix Staleness:** The minimum Bun version in the test matrix (`1.3.3`) may become so old that CI runners cannot install it. **Mitigation:** When the minimum supported Bun version is bumped (per [GEN-001](./GEN-001-tech-stack-and-runtime.md)), the test matrix MUST be updated simultaneously. The `bun-version-sync` Archgate rule catches version mismatches in source code, and code reviewers MUST verify matrix alignment.

## Compliance and Enforcement

### Automated Enforcement

- **GitHub branch protection**: The `main` branch MUST require status checks from both the `check` and `test` jobs to pass before merging
- **commitlint in CI**: PR titles are validated against `@commitlint/config-conventional` — non-conforming titles fail the `check` job
- **Frozen lockfile**: `bun install --frozen-lockfile` in CI rejects any dependency changes not committed to `bun.lock`
- **npm provenance**: `NPM_CONFIG_PROVENANCE: "true"` is set in the release workflow — every published version carries SLSA provenance

### Manual Enforcement

- Code reviewers MUST verify that workflow changes do not remove or weaken quality gates (lint, format, typecheck, test)
- Code reviewers MUST verify that the Bun version matrix still includes both the minimum supported version and `latest`
- Code reviewers MUST verify that new CI jobs use `bun install --frozen-lockfile` — never a mutable install
- Code reviewers MUST verify that permission scopes are not broadened beyond what the workflow requires

### Exceptions

Changes to the CI/CD pipeline that remove quality gates or weaken security controls (e.g., removing provenance, dropping the version matrix) MUST be approved by the project maintainer and documented in the PR description with a clear justification.

## References

- [GEN-001: Tech Stack and Runtime](./GEN-001-tech-stack-and-runtime.md) — Bun version constraint drives the test matrix minimum version
- [GEN-002: Testing Standards](./GEN-002-testing-standards.md) — `bun test` runs in CI as the test execution command
- [GEN-003: Dependency Policy](./GEN-003-dependency-policy.md) — `bun install --frozen-lockfile` enforced in all CI jobs
- [GEN-004: Code Style and Formatting](./GEN-004-code-style-and-formatting.md) — `bun run lint` and `bun run fmt:check` run in the check job
- [ARCH-001: Code Organization](./ARCH-001-code-organization.md) — subpath exports validated by the test suite in CI
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [oven-sh/setup-bun Action](https://github.com/oven-sh/setup-bun)
- [TrigenSoftware/simple-release-action](https://github.com/TrigenSoftware/simple-release-action)
- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [npm Provenance (SLSA)](https://docs.npmjs.com/generating-provenance-statements)
- [commitlint Documentation](https://commitlint.js.org/)
