# Testing and coverage

Run from a checkout with dependencies installed using `pnpm install --frozen-lockfile`.
Repository tests use Node 24; the [test container](../README.md#validation) also
provides the native compilers and browser engines needed for E2E validation.

```sh
pnpm run check
pnpm test
pnpm run test:e2e
pnpm run test:package
```

## Required coverage

`pnpm test` invokes `pnpm run test:coverage`. Both require 100% **statements,
branches, functions and lines for every executable production file**, not just an
aggregate percentage. Version 0.2.3 passes 110 tests with 100% in all four metrics.

The scope is the complete generator and browser runtime in `src/**/*.ts`: CLI,
configuration, language adapters, bridge/code generation, output transactions,
process management and Worker protocol/lifecycle. `c8 --all` includes unexecuted
modules. TypeScript source maps merge coverage from unit imports and subprocesses
back to the maintained source; the runner verifies that the report's file list
matches the complete executable build inventory.

Pure type declarations have no executable statements. A compiled module containing
only `export {};` is identified automatically and recorded in `scope.json`; adding
runtime code makes that file subject to the same 100% threshold without changing
an exclusion list. No production coverage-ignore directives are permitted by the
architecture check.

Development scripts, benchmarks, examples, test fixtures and third-party runtimes
are outside this **production TypeScript coverage metric**. Benchmark code has
strict type/architecture checks and measurement tests. Go/C++/Rust source emitted
inside template strings is not native-language instrumented coverage: generation
branches are counted here, and real native behavior is checked by browser E2E.
The percentage does not imply that every possible input or failure is tested.

## Reports

Each coverage run writes to `.artifacts/coverage/`:

| File | Contents |
| --- | --- |
| `index.html` | Browsable source coverage report |
| `coverage-summary.json` | Aggregate and per-file metrics |
| `coverage-final.json` | Istanbul statement/function/branch counters |
| `scope.json` | Exact executable/type-only inventory and thresholds |

Reports and coverage-specific source maps are local artifacts. Normal builds and
package creation rebuild `dist/` without test instrumentation or coverage maps.
Coverage tooling is a development dependency and is not installed by consumers
of the public generator.

The pnpm overrides for `test-exclude@8.0.0` pin patched `glob` and `minimatch`
versions for [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
and [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Revisit these scoped overrides when the upstream dependency ranges include fixed
versions. Validate both a passing report and rejection of an untested module
when changing the coverage toolchain.

## Test boundaries

Unit tests use real temporary directories and subprocesses where practical.
Node module mocks replace OS filesystem/process boundaries for deterministic
permission errors, failed commits/restores, missing compiler assets, signaling
failures and cleanup races. Production modules remain loaded and measured.
The test runner enables `--experimental-test-module-mocks` for these tests.

The CLI generation fixture validates orchestration and interruption; it does not
pretend to compile native code. `test:e2e` and `test:package` use real Go, Emscripten,
Cargo and wasm-bindgen, generated declarations, and Chromium/Firefox/WebKit in
development and production. Package tests install the actual packed archive into
a separate consumer. Run these suites sequentially because build/example outputs
are shared.

Before release, require passing coverage, type/architecture checks and both browser
suites on the release contents. Inspect the tarball, then verify public registry
integrity and a fresh anonymous install after publishing. Coverage alone is not
a substitute for that installed-package validation.
