# Changelog

## 0.2.6

- Qualify C++ native calls and register generated wrappers inside their own scope.
  Global functions such as `val`, `args`, `result`, `arg0` and `call_0` now invoke
  the declared implementation instead of colliding with bridge internals.
- Encode C++ declaration paths as literal header names instead of JSON strings.
  Paths with quotes or backslashes retain their original relative-include behavior.
  Reject paths containing both a double quote and `>` during config validation,
  including characters inherited from the config directory.
- Reject module names that differ only by case. Reject Go file basenames that
  collide after Unicode NFC normalization and lowercasing, and copy sources
  exclusively so filesystem-specific aliases cannot silently overwrite a source.
- Define `string` as well-formed Unicode. Reject lone UTF-16 surrogates in browser
  arguments/results; embedded NUL, valid surrogate pairs and empty strings remain
  supported. Regenerate existing clients to receive this runtime validation.
- Add real-compiler installed-package regressions for C++ names/path handling and
  cross-language numeric/Unicode boundary checks in all three browser engines.

## 0.2.5

- Capture generation's original cancellation signal and progress callback before
  asynchronous config loading. Pre-aborted requests skip config IO, and cancellation
  from progress stops before starting that module's adapter.
- Recheck cancellation after output inspection and backup, restoring the previous
  output before commit. Keep normal SIGINT/SIGTERM termination for `wasmgen check`
  instead of swallowing signals while config IO is pending.
- Preserve both Go compilation and temporary-wrapper cleanup failures. Output and
  adapter cleanup now share the same ordered error aggregation behavior.
- Preserve negative zero in Go scalar and numeric-array arguments instead of
  normalizing it to positive zero through JSON serialization. Browser regressions
  verify the same floating-point behavior across Go, C++ and Rust.
- Clarified compiler versus runtime validation, cancellation ownership, signed-zero
  semantics and recovery from Go wrapper cleanup failure. All 120 unit tests retain
  per-file 100% production TypeScript coverage in all four metrics.

## 0.2.4

- Retain the browser client's original cancellation signal when callers mutate
  their options, remove its listener on disposal, and detect cancellation during
  Worker construction before waiting for initialization.
- Preserve build/rollback failures alongside cleanup failures, including the
  recoverable backup path. Attempt staging and lock cleanup independently.
- Added a language extension guide covering Adapter contracts, schema/registry
  changes, build ownership, browser semantics, required tests and the boundary
  between built-in adapters and a possible future plugin API.
- Added lifecycle/output regression tests and a real-browser mutable-options
  cancellation check; all 114 unit tests retain per-file 100% production
  TypeScript statement, branch, function and line coverage.

## 0.2.3

- Added per-file 100% statement, branch, function and line coverage checks to
  `pnpm test`, with TypeScript source maps and HTML/JSON reports. Untested runtime
  modules count toward the threshold; coverage suppression directives are rejected.
- Added failure, rollback, cancellation, protocol, native compiler orchestration
  and generated-client tests alongside the real browser E2E matrix.
- Release output locks even when staging cleanup fails, and retain the original
  compiler cancellation signal when a caller mutates its options object.
- Removed redundant checks already enforced by configuration/protocol validation.

- Added a TypeScript benchmark harness for CLI generation, generated module sizes,
  browser initialization and sequential scalar/array Worker round trips across
  Go, C++ and Rust in Chromium, Firefox and WebKit.
- Added full/quick sampling profiles, raw JSON and Markdown reports, and documented
  measurement boundaries and reproducibility limits.

## 0.2.2

- Added `--version` / `-v` and expanded CLI help with commands and examples.
- Separated CLI argument parsing from execution. Config flags accept `--config=file`
  and can precede the command; ambiguous values and unknown arguments fail explicitly.
- Config diagnostics include the selected config file, input field and underlying
  validation reason. Build failures identify their module and language, preserving
  the original error in the cause chain.
- Documented reuse of generated client/options types in TypeScript applications.

## 0.2.1

### Fixed

- C++ public export names such as `hasOwnProperty`, `calledRun` and `locateFile`
  no longer collide with Emscripten runtime properties.
- C++ bindings no longer require JavaScript dynamic evaluation. Production
  browser tests enforce a CSP permitting Wasm compilation without `unsafe-eval`.
- Config validation rejects output that contains a declared input or the config
  through symlinked files or parent directories.
- Compiler stdout/stderr preserve split UTF-8 sequences and significant path
  whitespace. Large metadata is captured intact; stdout exceeding 32 MiB fails
  explicitly instead of returning truncated data. Pre-aborted calls do not spawn
  compiler processes.
- Cancellation terminates the compiler process group on POSIX hosts, including
  descendants. Compilers that ignore SIGTERM are force-stopped after one second.

### Maintenance

- Added an architecture check requiring maintained JavaScript code to be TypeScript;
  generated browser JavaScript remains in output directories.

### Documentation

- Added configuration/API reference, troubleshooting and contributor guidance.
- Clarified tool prerequisites, build-time execution, browser support, output
  recovery and the need to regenerate existing browser assets after upgrading.

## 0.2.0

- Added Rust source-file and Cargo library inputs using wasm-bindgen, including
  scalar/string/vector types and fallible `Result` returns.
- Preserved original Cargo workspace `[patch]` and `[replace]` overrides with
  relative paths resolved against that workspace root.
- Separated language validation/compilation contracts and adapter registration
  from the shared generation workflow.
- Added Rust browser and installed-package coverage across Chromium, Firefox and
  WebKit, including dependency overrides and preservation of native inputs.

## 0.1.0

- Initial public Go and C++ generator, typed browser clients and Worker runtime.
- Go package mode, goroutine-compatible calls, output ownership protection and
  browser/installed-package validation.
