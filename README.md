# wasmgen

Generate browser WebAssembly modules and typed clients from Go and C++ sources.
Declare native inputs, exported function signatures, and an output directory;
then import the generated code from your TypeScript application.

```text
Go files / package ── Go compiler ───────┐
                                       ├── .wasm + Worker + JS + .d.ts
C++ sources / headers ── Emscripten ─────┘            ↓
                                            TypeScript imports
```

wasmgen orchestrates existing compilers and generates the bindings. Each client
runs in its own Web Worker and exposes Promise-returning functions. Generated
code has no runtime npm dependency on wasmgen and contacts no build service.

The project and CLI are named **wasmgen**. The package is configured as
`@heojeongbo/wasmgen`; it has **not been published to npm**. Rust support is not
implemented in this version.

## Try it before publishing

Build prerequisites: Node.js 22.12+, pnpm 10.11.0, Go 1.22+, and Emscripten's `em++` on
`PATH`. C++ uses C++17. The [test container](test/Dockerfile) supplies the tested
toolchains and browser engines if you do not want to install them locally.

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/cli.js gen --config examples/wasmgen.yaml
pnpm exec vite examples/web
```

Open the URL printed by Vite. The example calls C++ to clamp a number and Go to
uppercase the result label. To build deployable static assets:

```sh
pnpm exec vite build examples/web --base=/demo/
pnpm exec vite preview examples/web --base=/demo/
```

To install the unpublished generator into another project, run `pnpm pack` here,
then `pnpm add -D /absolute/path/to/heojeongbo-wasmgen-0.1.0.tgz`
there. This does not publish anything. Its runtime npm dependencies are the
public `yaml` and `zod` packages. Installation has no install/postinstall scripts
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

`check` validates the configuration and input paths; `gen` also compiles and
checks native calls. All source/output paths resolve relative to the config.
The output is exclusively owned by wasmgen: use a dedicated generated directory.
Failed builds preserve the previous output. Unknown files and symlinks in the
output prevent replacement. Do not hand-edit generated files. A sibling lock
prevents concurrent generation into the same output; after a hard process kill,
remove that lock only after verifying no generator is still running.

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

Factories accept `{ signal?: AbortSignal, timeoutMs?: number }`. The default
30-second timeout applies to initialization and each call, including queue time.
Abort, timeout, disposal, and fatal Wasm traps terminate the whole instance and
reject every outstanding call. Create a new instance to resume. Ordinary Go
errors, Go panics within the exported call, and C++ exceptions reject just that call. Go
panics in independently running goroutines are outside the exported-call boundary.

## Native interface

| Config type | TypeScript | Go parameter | C++ parameter |
| --- | --- | --- | --- |
| `i32` | `number` | `int32` | `std::int32_t` |
| `u32` | `number` | `uint32` | `std::uint32_t` |
| `f64` | `number` | `float64` | `double` |
| `bool` | `boolean` | `bool` | `bool` |
| `string` | `string` | `string` | `std::string` |
| `i32[]`, `u32[]`, `f64[]` | `number[]` | slice of the corresponding type | `std::vector<T>` |
| `void` (result only) | `void` | no result | `void` |

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

Use `tools: { go: /path/to/go, cpp: /path/to/em++ }` to override executables.
Executable names resolve through `PATH`; use absolute paths for overrides outside
`PATH`. Compiler arguments are passed directly, without a shell.

The source and its dependencies must support the browser target. Native OS,
hardware devices, raw sockets, filesystem access, cgo, pthreads, and arbitrary
native libraries are not made browser-compatible automatically. This version
targets portable computation; structs, pointers, callbacks, int64, streaming,
Rust, and WASI are outside its supported interface.

## Build and deploy in a monorepo

Install the public generator as a dev dependency (or use its local tarball for
now), generate from your local native sources, and build the web application.
Native application code and generated artifacts do not need an pnpm package or
an internal package registry. Generation happens explicitly during development
or CI, not during `pnpm install`.

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

Preserve generated license notices in your application's distribution: bundlers
do not copy standalone license text files automatically. See
[runtime notices](src/licenses/README.md) for compiler provenance; also include
notices belonging to your own native dependencies.

## Library API

```ts
import { generate, readConfig } from '@heojeongbo/wasmgen';

await readConfig('wasmgen.yaml');
await generate('wasmgen.yaml', {
  onProgress: console.log,
  signal: new AbortController().signal,
});
```

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
| `src/application/` | Generation workflow using injected compiler adapters |
| `src/adapters/go/`, `src/adapters/cpp/` | Native bridge generation, compiler invocation, language-specific Worker initialization |
| `src/storage/` | Output ownership, lock, staging, replacement, rollback |
| `src/codegen/` | Shared browser client and declaration emission |
| `src/runtime/` | Typed Worker protocol, call ordering, deadlines, lifetime |
| `src/index.ts` | Compose the concrete Go/C++ adapters into the public API |
| `examples/web/src/` | `app → pages → features → shared`; generated native clients enter through `shared/api` |

The Go/C++ implementations adapt distinct toolchains to a single
`CompilerAdapter` contract. The browser adapter presents generated native APIs
as a small `NativeOperations` contract; the calculation feature receives it
as a dependency. The page owns DOM interaction while the feature owns the
calculation sequence. Empty FSD layers, React, and template-specific application
dependencies are not needed for this example.

`pnpm run check` runs strict TypeScript checking and an import-boundary check:
application/codegen cannot import concrete compilers, runtime code cannot import
build-time services, and FSD imports must flow downward through public entry points.
It also rejects explicit TypeScript `any` and disabled type-checking directives.
`pnpm run typecheck:generated` validates the generated declarations and browser
example after generation; test compilation checks all test code too.

## Validation

The container uses Emscripten 4.0.10, Ubuntu's Go 1.22 toolchain, and Playwright
1.60.0. Run from the wasmgen checkout with Docker available:

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

`test:e2e` compiles real Go/C++, checks TypeScript declarations, and runs
Chromium, Firefox, and WebKit against Vite development and production output.
It checks Unicode, numeric boundaries, arrays and memory growth, errors/panics,
concurrency, goroutine/channel/timer completion, call ordering, responsiveness,
cancellation, timeout, and Worker cleanup.

`test:package` packs and installs the unpublished tarball into a separate
consumer, invokes the installed CLI/library, compiles a Go `internal` package
with a local `replace` dependency and a C++ module, typechecks imports, and runs
the same browser/build matrix. Only public generator files enter the package.

All checked-in fixtures are independent, general-purpose examples. No external
application checkout is required. Reports, screenshots, and the local tarball are written to
`.artifacts/`; temporary consumers go under `.test-output/`. Both are gitignored.

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
