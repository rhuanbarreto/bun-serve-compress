# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.1.3](https://github.com/rhuanbarreto/bun-serve-compress/compare/v0.1.2...v0.1.3) (2026-03-22)

### Bug Fixes

* add proper type inference to serve() ([#12](https://github.com/rhuanbarreto/bun-serve-compress/issues/12)) ([65d7f88](https://github.com/rhuanbarreto/bun-serve-compress/commit/65d7f888ca74e390f6a9b9448d6b0bf632dd3c69))

## [0.1.2](https://github.com/rhuanbarreto/bun-serve-compress/compare/v0.1.1...v0.1.2) (2026-03-21)

### Bug Fixes

* **ci:** ignore CHANGELOG.md formatting and fix release pipeline ([#10](https://github.com/rhuanbarreto/bun-serve-compress/issues/10)) ([8d94f5d](https://github.com/rhuanbarreto/bun-serve-compress/commit/8d94f5d6397e117a79e17813420275e3eea29aff))

## [0.1.1](https://github.com/rhuanbarreto/bun-serve-compress/compare/v0.1.0...v0.1.1) (2026-03-21)

### Bug Fixes

- **ci:** add conventional-changelog dependencies for simple-release ([#4](https://github.com/rhuanbarreto/bun-serve-compress/issues/4)) ([02f5b3d](https://github.com/rhuanbarreto/bun-serve-compress/commit/02f5b3d8415c2beec97d23746fb1d3d8d2edf7d2))
- **ci:** add type module to package.json for simple-release ([#3](https://github.com/rhuanbarreto/bun-serve-compress/issues/3)) ([8455f45](https://github.com/rhuanbarreto/bun-serve-compress/commit/8455f457e3ccd2134b72b1b177563dfca454d6c8))
- **ci:** format changelog before triggering CI on release branch ([#9](https://github.com/rhuanbarreto/bun-serve-compress/issues/9)) ([d60248d](https://github.com/rhuanbarreto/bun-serve-compress/commit/d60248d1c764d120120b4ba26ccc3abbc9f621e0))
- **ci:** trigger CI directly on release branch for status checks ([#8](https://github.com/rhuanbarreto/bun-serve-compress/issues/8)) ([4133779](https://github.com/rhuanbarreto/bun-serve-compress/commit/413377985c36c4b2eabd047fa8315c4978e195c9))

## [0.1.0](https://github.com/rhuanbarreto/bun-serve-compress/commits/v0.1.0) (2026-03-21)

### Features

- initial implementation of bun-serve-compress with gzip, brotli, and zstd support ([0df90ec](https://github.com/rhuanbarreto/bun-serve-compress/commit/0df90ec72c61f141412a91802907f13971ab40ce))
- comprehensive test suite and Cache-Control no-transform support ([38d255c](https://github.com/rhuanbarreto/bun-serve-compress/commit/38d255c))
- add Bun version guard using Bun.semver.satisfies() ([3d81652](https://github.com/rhuanbarreto/bun-serve-compress/commit/3d81652))
- add Elysia and Hono framework adapters as subpath exports ([744dabd](https://github.com/rhuanbarreto/bun-serve-compress/commit/744dabdde9f5301d9e194c00fb5b0fe90bd43550))
