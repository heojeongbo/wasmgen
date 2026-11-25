# Changelog

## Unreleased

### Fixed

- C++ public export names such as `hasOwnProperty`, `calledRun` and `locateFile`
  no longer collide with Emscripten runtime properties.
- C++ bindings no longer require JavaScript dynamic evaluation. Production
  browser tests enforce a CSP permitting Wasm compilation without `unsafe-eval`.
- Config validation rejects output that contains a declared input or the config
  through symlinked files or parent directories.

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
