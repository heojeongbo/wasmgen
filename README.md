# wasmgen

Generate browser WebAssembly modules and typed clients from Go, C++ and Rust sources.
Declare native inputs, exported function signatures, and an output directory;
then import the generated code from your TypeScript application.

```text
Go files / package ── Go compiler ────────────┐
C++ sources / headers ── Emscripten ──────────┼── .wasm + Worker + JS + .d.ts
Rust crate root / package ── Cargo + bindgen ─┘            ↓
                                            TypeScript imports
```

wasmgen orchestrates existing compilers and generates the bindings. Each client
runs in its own Web Worker and exposes Promise-returning functions. Generated
code has no runtime npm dependency on wasmgen and contacts no build service.

The project and CLI are named **wasmgen**. The npm package is
`@heojeongbo/wasmgen`. Rust support, including Cargo workspace dependency
overrides, is available starting with `0.2.0`.

This README describes the current checkout. See the [changelog](CHANGELOG.md)
for released changes and work that is still unreleased.

- [Configuration reference](docs/configuration.md): fields, defaults, CLI and library API.
- [Troubleshooting](docs/troubleshooting.md): toolchains, browser loading, CSP and output recovery.
- [Contributing](CONTRIBUTING.md): validation, adapter boundaries and release checks.

## Install

The generator requires Node.js 22+ and the toolchain for each
configured language: Go 1.22+, Emscripten's `em++` (C++17), or Rust/Cargo with the
`wasm32-unknown-unknown` target and `wasm-bindgen` CLI on `PATH`.
The repository's Vite example and tests require Node.js 22.12+; contributors use
pnpm 10.11.0. Browser consumers need the generated assets, not these build tools.
The [test container](test/Dockerfile) supplies all tested toolchains and browsers.

```sh
pnpm add -D @heojeongbo/wasmgen
```

Create a `wasmgen.yaml` using the configuration below, then generate the browser
modules:

```sh
pnpm exec wasmgen gen --config wasmgen.yaml
```

## Run the repository example

Clone this repository and run:

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/cli.js gen --config examples/wasmgen.yaml
pnpm exec vite examples/web
```

Open the URL printed by Vite. The example calls C++ to clamp a number, Go to
uppercase its label, and Rust to decorate that label. To build deployable static assets:

```sh
pnpm exec vite build examples/web --base=/demo/
pnpm exec vite preview examples/web --base=/demo/
```

To test a local build of the generator in another project, run `pnpm pack` here,
then `pnpm add -D /absolute/path/to/heojeongbo-wasmgen-0.2.3.tgz`
there. This does not publish anything. Its runtime npm dependencies are the
public `yaml`, `zod`, and `smol-toml` packages. Installation has no install/postinstall scripts
or native builds; `prepack` compiles TypeScript when packaging the generator.

## Configure inputs and output

`wasmgen.yaml` (JSON is also accepted):

```yaml
version: 1
output: ./web/generated
input:
  - name: geometry
    language: cpp
    files: [./cpp/geometry.cc]
    headers: [./cpp/geometry.h]
    exports:
      clamp:
        symbol: geometry::Clamp
        params:
          - { name: value, type: f64 }
          - { name: low, type: f64 }
          - { name: high, type: f64 }
        result: f64
  - name: policy
    language: go
    files: [./go/logic.go]
    exports:
      upper:
        symbol: Upper
        params:
          - { name: value, type: string }
        result: string
```

The matching source files are in [examples](examples/wasmgen.yaml).

```sh
pnpm exec wasmgen check --config wasmgen.yaml
pnpm exec wasmgen gen --config wasmgen.yaml
```

`check` validates the configuration and input paths without invoking a compiler.
It does not verify native signatures, compiler availability or dependency resolution;
`gen` checks signatures during compilation. Neither command executes exported native
functions in a browser. All source/output paths resolve relative to the config.
The output is exclusively owned by wasmgen: use a dedicated generated directory.
Failed builds preserve the previous output. Unknown files and symlinks in the
output prevent replacement. Do not hand-edit generated files. A sibling lock
prevents concurrent generation into the same output; after a hard process kill,
remove that lock only after verifying no generator is still running.
The config and declared inputs must stay outside the output, including through
symlinked files or parent directories. Do not move inputs or retarget symlinks while
generation is running.

## Import from TypeScript

```ts
import { geometry, policy } from './generated/index.js';

const cpp = await geometry();
try {
  const go = await policy();
  try {
    const clamped: number = await cpp.clamp(23, 0, 10);
    const label: string = await go.upper(`value: ${clamped}`);
    console.log(label); // VALUE: 10
  } finally {
    go.dispose();
  }
} finally {
  cpp.dispose();
}
```

Each factory starts a separate Worker and native runtime. Calls within an
instance execute serially; separate instances can run independently. Strings
and arrays are copied across boundaries. Array parameters and results use plain
JavaScript arrays, not typed arrays or shared memory.

Reuse the generated types when storing a client or accepting one as a dependency:

```ts
import type { API as GeometryAPI, Options as GeometryOptions } from './generated/geometry/index.js';

const options: GeometryOptions = { timeoutMs: 10_000 };
const client: GeometryAPI = await geometry(options);
try {
  console.log(await client.clamp(23, 0, 10));
} finally {
  client.dispose();
}
```

These are type-only imports. The declarations are generated from the same signatures
as the client; keep them with its JavaScript and Wasm output.

Factories accept `{ signal?: AbortSignal, timeoutMs?: number }`. The default
30-second timeout applies to initialization and each call, including queue time.
Abort, timeout, disposal, and fatal Wasm traps terminate the whole instance and
reject every outstanding call. Create a new instance to resume. Ordinary Go
errors, Go panics within the exported call, Rust `Result::Err`, and C++ exceptions reject just that call. Go
panics in independently running goroutines are outside the exported-call boundary.
Rust panics abort the Wasm instance: pending calls reject and the Worker is
terminated. Create a new client after a panic.

## Native interface

| Config type | TypeScript | Go parameter | C++ parameter | Rust parameter |
| --- | --- | --- | --- | --- |
| `i32` | `number` | `int32` | `std::int32_t` | `i32` |
| `u32` | `number` | `uint32` | `std::uint32_t` | `u32` |
| `f64` | `number` | `float64` | `double` | `f64` |
| `bool` | `boolean` | `bool` | `bool` | `bool` |
| `string` | `string` | `string` | `std::string` | `String` |
| `i32[]`, `u32[]`, `f64[]` | `number[]` | slice of the corresponding type | `std::vector<T>` | `Vec<T>` |
| `void` (result only) | `void` | no result | `void` | `()` |

Numeric arguments/results are validated at runtime; `f64` requires finite values.
`i32` and `u32` enforce their integer ranges. Nil Go slices become empty arrays.
For Go functions returning `(T, error)`, add `error: true` to the export; use
`result: void` for functions returning only `error`.

Exports use ordinary native function signatures. Go functions may wait on
goroutines, channels, and timers; the generated bridge returns a JavaScript
Promise and invokes native work in a goroutine so the JS event loop can resume.
The Go runtime is compiled into the Wasm binary; wasmgen copies `wasm_exec.js`
from the same selected toolchain as `go-runtime.js`. This supports concurrency
within a Worker, not Go CPU parallelism across OS threads. Exported calls on
one client still execute in order. Abort/timeout terminates the Worker rather
than invoking Go defers or performing a graceful `context.Context` cancellation.
User-created goroutines must have their own exit path while the instance lives.

See `DelayedDouble` in [the Go example](examples/go/logic.go) for a channel/timer
example tested in real browsers. C++ exports remain synchronous inside their Worker.
Rust exports are also synchronous inside their Worker; `async fn` and Rust thread
creation are not supported by this integration.
Signatures are explicit in the config;
wasmgen does not infer a whole native API. Use small native adapters for methods,
custom parameter types, or APIs that differ from this table. C++ const-reference
parameters and templates work when callable with the generated argument types.
`dispose` and `then` cannot be exported as function names; `then` also cannot
be a module name because dynamic imports would treat it as a Promise callback.

Go has two input modes:

- `files`: selected `.go` files from one non-main package, with standard-library
  imports only. Files are compiled in an isolated temporary module with `GOWORK=off`.
- `package`: an importable package directory in an existing Go module. This
  preserves module dependencies, `replace`, workspace resolution, and `internal`
  visibility. The package directory must be writable: a temporary wrapper directory
  is created there and removed afterward. Go may resolve/download dependencies or a
  selected toolchain according to the original module's settings.

```yaml
version: 1
output: ./web/generated
input:
  - name: calculation
    language: go
    package: ./native/internal/calc
    exports:
      add:
        symbol: Add
        params: [{ name: value, type: f64 }]
        result: f64
```

C++ requires `headers`; `files` is optional for header-only functions. `include`
adds include directories. All supplied sources are compiled and linked into a
single module, with `-O3`, LTO, and warnings treated as errors. This version does
not drive CMake or expose arbitrary linker flags.

Rust uses Cargo to compile an isolated bridge crate for `wasm32-unknown-unknown`,
then `wasm-bindgen --target web` generates its JavaScript bindings. Your native
functions do not need `#[wasm_bindgen]` annotations. Install the browser target,
a host linker (`cc`, needed by Cargo build scripts), and the binding CLI:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

The generated bridge pins its `wasm-bindgen` crate to the installed CLI's exact
version. The tested versions are Rust 1.100.0 and wasm-bindgen 0.2.130. If your
package already depends on wasm-bindgen, use a compatible version of that CLI.

Rust input modes:

- `files: [./native/lib.rs]`: exactly one Rust 2021 crate root, with standard-library
  dependencies. Relative `mod` declarations and `crate::` paths are preserved.
- `package: ./native/my-crate`: a directory containing a library `Cargo.toml`.
  This supports path dependencies and workspace-inherited package/dependency
  settings. Select a concrete crate, not a virtual workspace or binary-only crate.

The bridge uses the package's default features and inherits the original
workspace root's `[patch]` or `[replace]` tables. Relative override `path` values
are resolved against that root before being written into the temporary bridge;
Git source selectors, revisions, registry names, aliases, and dependency options
are preserved. Member-local overrides remain ignored, matching Cargo's rules.
This also works for standalone library packages, whose manifest is the workspace root.
Write overrides in the original `Cargo.toml`; no extra wasmgen configuration is needed:

```toml
# Original workspace Cargo.toml
[patch.crates-io]
my_math = { path = "vendor/my-math" }
```

Legacy `[replace]` entries such as `"my-math:1.2.3" = { path = "vendor/my-math" }`
are also preserved. Cargo deprecates `[replace]` in favor of `[patch]`; its normal
validation and version-selection rules still apply. The bridge keeps its own
release profile rather than inheriting workspace release profiles.

A copy of the original workspace lockfile seeds resolution; Cargo may resolve additional binding
dependencies in the temporary copy. Original sources, manifests, and lockfiles
are not modified. Cargo may download dependencies during generation.

For `Result<T, E>` returns, set `error: true`; `E` must implement `Display`.
Use `result: void` for `Result<(), E>`. String and vector parameters are owned
`String` and `Vec<T>`; adapt borrowed/custom types with ordinary Rust functions.
Returned numeric typed arrays from wasm-bindgen are copied into the same plain
`number[]` contract as Go and C++.

```yaml
version: 1
output: ./web/generated
input:
  - name: arithmetic
    language: rust
    package: ./native/my-crate
    exports:
      divide:
        symbol: math::divide
        params: [{ name: a, type: f64 }, { name: b, type: f64 }]
        result: f64
        error: true
```

Import the generated factory just like the other languages:

```ts
import { arithmetic } from './generated/index.js';

const rust = await arithmetic();
try {
  console.log(await rust.divide(42, 2)); // 21
} finally {
  rust.dispose();
}
```

Use `tools: { go: /path/to/go, cpp: /path/to/em++ }` to override executables.
Rust supports `tools: { cargo: /path/to/cargo, wasmBindgen: /path/to/wasm-bindgen }`.
Executable names resolve through `PATH`; use absolute paths for overrides outside
`PATH`. Compiler arguments are passed directly, without a shell.

The source and its dependencies must support the browser target. Native OS,
hardware devices, raw sockets, filesystem access, cgo, pthreads, and arbitrary
native libraries are not made browser-compatible automatically. This version
targets portable computation; structs, pointers, callbacks, int64, streaming,
async Rust exports, and WASI are outside its supported interface.

## Build and deploy in a monorepo

Install the public generator as a dev dependency, generate from your local native
sources, and build the web application.
Native application code and generated artifacts do not need a pnpm package or
an internal package registry. Generation happens explicitly during development
or CI, not during `pnpm install`.

For example, in the web application's `package.json`:

```json
{
  "scripts": {
    "gen:wasm": "wasmgen gen --config wasmgen.yaml",
    "build": "pnpm run gen:wasm && vite build"
  }
}
```

Run generation after changing native code or the config; no watch mode is provided.
Use trusted native inputs and dependencies: compiler tools and Cargo build scripts
run on the build machine. wasmgen is not a sandbox for building untrusted code.

The generated directory contains module factories, `.d.ts` declarations,
Workers, `.wasm` binaries, and runtime/license files. Vite is tested in both
development and production, including a `/demo/` base path. Its normal
`new Worker(new URL(..., import.meta.url))` and asset handling bundle the files.
Other bundlers are not yet tested. Native ESM serving requires preserving the
relative generated directory structure and serving JavaScript/Wasm over HTTP(S).

Deploy the entire bundler output. Serve `.wasm` as `application/wasm` and keep
Worker scripts/assets accessible from the application. The current implementation
does not use SharedArrayBuffer or require cross-origin isolation. A restrictive
CSP must allow the application's Workers and WebAssembly compilation.
The current C++ adapter disables Emscripten dynamic JavaScript execution;
the production browser matrix runs without CSP `unsafe-eval`. Apply the policy to
Worker script responses too. See [CSP and loading issues](docs/troubleshooting.md#browser-loading-and-csp)
for the tested policy and compatibility notes.

Preserve generated license notices in your application's distribution: bundlers
do not copy standalone license text files automatically. See
[runtime notices](src/licenses/README.md) for compiler provenance; also include
notices belonging to your own native dependencies.

## Library API

```ts
import { generate, readConfig } from '@heojeongbo/wasmgen';

await readConfig('wasmgen.yaml');
const { output, modules } = await generate('wasmgen.yaml', {
  onProgress: console.log,
  signal: new AbortController().signal,
});
console.log(output, modules);
```

This is a Node.js ESM build API. Browser applications import the generated code,
not `@heojeongbo/wasmgen` itself. [API options and results](docs/configuration.md#library-api)
are documented separately from the generated browser client.

## Architecture

Sources, tests, and build/check scripts are TypeScript. `pnpm run build` emits
the distributable JavaScript and declarations into `dist/`; browser codegen
emits executable JS plus `.d.ts`. There are no separately maintained public
type declarations. Configuration types are inferred from the Zod schema.

The structure follows the strict typing, downward dependencies, public module
entry points, and injection principles in
[ui-app-template](https://github.com/heojeongbo/ui-app-template/blob/c852869c2342c92b4a196cd6b0fe3691799eb724/docs/architecture.md).
The generator is infrastructure, so its modules follow their responsibilities;
the browser example uses the FSD subset it needs.

| Module | Responsibility |
| --- | --- |
| `src/model/` | Configuration schema and value contracts |
| `src/config.ts` | Parse, validate, and resolve input paths |
| `src/ports/` | Language validation/compilation contracts and compiled-module result |
| `src/application/` | Generation workflow using injected language adapters and configuration reader |
| `src/adapters/go/`, `src/adapters/cpp/`, `src/adapters/rust/` | Each language's validation, native bridge, compiler orchestration, and Worker initializer |
| `src/storage/` | Output ownership, lock, staging, replacement, rollback |
| `src/codegen/` | Shared browser client and declaration emission |
| `src/runtime/` | Typed Worker protocol, call ordering, deadlines, lifetime |
| `src/languages.ts`, `src/index.ts` | Register language implementations once and compose the public API |
| `examples/web/src/` | `app → pages → features → shared`; generated native clients enter through `shared/api` |

The implementations adapt distinct toolchains to a typed `LanguageAdapter`
contract. The registry maps each language to an adapter of that exact language.
Configuration loading depends only on `InputValidator`; generation depends only
on `LanguageCompiler`, keeping validation and compilation interfaces separate.
The generation workflow receives the registry and configuration reader through
dependency injection. Each compiler returns a `CompiledModule` with its Worker
initializer; web codegen receives that string and has no compiler dependency.
Validation, native bridge generation, compilation, and browser initialization
live in separate files inside each language adapter.

Adding a built-in language requires its adapter, registration in `src/languages.ts`,
and schema/tool/type declarations. Configuration loading, output replacement,
browser RPC, and shared web codegen do not need language branches. This is an
internal extension point; this version does not expose a third-party plugin API.

The browser adapter presents generated native APIs
as a small `NativeOperations` contract; the calculation feature receives it
as a dependency. The page owns DOM interaction while the feature owns the
calculation sequence. Empty FSD layers, React, and template-specific application
dependencies are not needed for this example. The native API adapter owns all
created clients and disposes them in reverse order, including partial initialization failures.

`pnpm run check` runs strict TypeScript checking and an import-boundary check:
application/configuration/codegen cannot import concrete language adapters;
adapters cannot import one another; ports depend on the model; runtime code cannot import
build-time services, and FSD imports must flow downward through public entry points.
It also rejects explicit TypeScript `any`, disabled type-checking directives,
and maintained `.js`/`.mjs`/`.cjs` files in source, script and test directories.
Executable JavaScript is emitted into generated output directories.
`pnpm run typecheck:generated` validates the generated declarations and browser
example after generation; test compilation checks all test code too.

## Validation

The container uses Emscripten 4.0.10, Ubuntu's Go 1.22 toolchain, Rust 1.100.0,
wasm-bindgen 0.2.130, and Playwright 1.60.0. Run from the wasmgen checkout with Docker available:

```sh
docker build -t wasmgen-test:local -f test/Dockerfile .
docker run --rm -it --ipc=host \
  --mount type=bind,source="$PWD",target=/work \
  --mount type=volume,source=wasmgen-test-node-modules,target=/work/node_modules \
  wasmgen-test:local bash
```

Inside the container:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run test:e2e
pnpm run test:package
```

`pnpm test` requires **100% statements, branches, functions and lines per file**
across executable `src/**/*.ts`. It includes untested modules and fails below any
threshold. The 0.2.3 suite passes 110 tests at 100% in all four metrics.
HTML and JSON reports are written to `.artifacts/coverage/`.
See [test coverage scope and workflow](docs/testing.md) for type-only modules,
compiler fault injection, and the separate real-Wasm browser checks.

`test:e2e` compiles real Go/C++/Rust, checks TypeScript declarations, and runs
Chromium, Firefox, and WebKit against Vite development and production output.
It checks Unicode, numeric boundaries, arrays and memory growth, errors/panics,
concurrency, goroutine/channel/timer completion, call ordering, responsiveness,
cancellation, timeout, and Worker cleanup. Rust coverage includes fallible scalar,
array and void results, relative modules, `crate::` resolution, bindgen-name collisions,
memory growth, and panic rejection of pending calls.

`test:package` packs and installs a local tarball into a separate
consumer, invokes the installed CLI/library, compiles a Go `internal` package
with a local `replace` dependency, a C++ module, and a Rust workspace library with
a path dependency and custom library name. Additional crates verify a workspace
root's transitive `[patch.crates-io]` override with an aliased package and a path
containing spaces, plus an exact-version `[replace]` override. It checks all native
sources, manifests, and lockfiles stay unchanged, typechecks imports, and runs
the same browser/build matrix.
The C++ package fixture also checks public names that overlap Emscripten internals;
production cases apply a CSP that permits Wasm compilation but blocks JavaScript eval.
Only public generator files enter the package.

All checked-in fixtures are independent, general-purpose examples. No external
application checkout is required. Reports, screenshots, and the local tarball are written to
`.artifacts/`; temporary consumers go under `.test-output/`. Both are gitignored.

## Benchmarks

Run `pnpm bench` from a checkout with the [test toolchains](#validation) installed.
It measures full CLI generation, module sizes, Worker initialization, and scalar/array
round trips through real Go/C++/Rust Wasm in Chromium, Firefox and WebKit.
`pnpm bench --quick --browser chromium` provides a shorter harness smoke run.

Each run writes JSON raw samples and Markdown tables to `.artifacts/benchmarks/`.
See [benchmark methodology and commands](docs/benchmarks.md) for timing boundaries,
cache conditions and interpretation. Browser round trips include validation and
data copying; they are not native-language speed rankings.

The [recorded baseline](docs/benchmark-results.md) (2026-11-25, Linux arm64 container,
Chromium 148, full profile) has these median round-trip values:

| Fixture | Initialization (ms) | Scalar divide (ms/call) | Scale 1,024 numbers (ms/call) |
| --- | ---: | ---: | ---: |
| Go | 35.000 | 0.124 | 0.724 |
| C++ | 9.100 | 0.060 | 0.444 |
| Rust | 8.400 | 0.052 | 0.188 |

Repeated generation of all three modules had a 6.095-second median with existing
toolchain caches. See the full tables and [raw samples](docs/benchmark-results.json)
for the other engines, payload sizes and observed variation. These are fixture
measurements from one environment, not application latency guarantees.

## Maintainer credentials

The project `.npmrc` uses the public npm registry and reads authentication from
`NPM_TOKEN`. Never put a token directly in `.npmrc`. For local storage, copy
`.env.example` to `.env.local`, restrict its permissions with `chmod 600 .env.local`,
and fill in the value. `.env.local` is gitignored; pnpm does not load it
automatically, so explicitly load it into the publishing process when needed.
Public dependency installation requires no token. With `NPM_TOKEN` unset,
pnpm 10 may print an environment-substitution warning but still installs public
dependencies. Do not share token values in chat or commit them to the repository.

## License

MIT. Native inputs remain under their original licenses.
