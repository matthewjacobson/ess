# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-25

### Added

- `computeStreamlinesSync(options): StreamlinesResult` — a synchronous variant
  that runs the whole computation on the calling thread and returns the result
  directly (no promise, no handle, no cancellation). Accepts the same options as
  `computeStreamlines` (`timeBudgetMs` is ignored) and produces identical output;
  `result.reason` is always `'completed'`. Useful in scripts, workers, or SSR
  where blocking is acceptable.

## [0.1.0]

### Added

- Initial release: `computeStreamlines` for computing evenly-spaced streamlines
  of a 2D vector field, with per-point `distanceToNearest` spacing, an explicit
  completion signal (`done` promise, `onComplete`, `cancel()`), and a coarse
  fallback grid sweep for disconnected sub-domains. Ships as ESM, CommonJS, and
  UMD with bundled TypeScript declarations.

[0.2.0]: https://github.com/matthewjacobson/ess/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/matthewjacobson/ess/releases/tag/v0.1.0
