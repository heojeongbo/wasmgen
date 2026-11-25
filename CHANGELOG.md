# Changelog

## Unreleased

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
