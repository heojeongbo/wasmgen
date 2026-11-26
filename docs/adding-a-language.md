# Adding a language

wasmgen integrates a compiler and its browser bindings through an internal
`LanguageAdapter`. An adapter translates one language's inputs and runtime into
the existing generated client contract. It does not implement a compiler.
Go, C++ and Rust are the currently supported languages; names in the illustrative
scaffold below are not accepted configuration values today.

Use this guide when contributing a built-in language. The public npm API exposes
`readConfig` and `generate`; it does not expose adapter registration, load plugin
packages or accept arbitrary adapters in YAML. Installing a compiler alone does
not add language support.

## Architecture and responsibility

The build flow is:

```text
readConfig → common schema/path checks → adapter.validateInput
generate   → output transaction → adapter.build → shared web codegen
browser    → generated factory → Worker runtime → adapter initializer → native code
```

`src/languages.ts` is the composition point. Its typed registry is injected into
the configuration reader and generation workflow. Configuration depends on
`InputValidator`; generation depends on `LanguageCompiler`. Their intersection,
`LanguageAdapter`, supplies both capabilities without coupling validation to an
installed compiler.

This is Adapter plus dependency injection through ordinary TypeScript objects.
A base class, inheritance hierarchy or dependency injection container is not
required. Each adapter can use different tools and binding techniques while
returning the same `CompiledModule`. The FSD layers in the browser example are
application organization, not the generator's language extension mechanism.

| Owner | Responsibilities |
| --- | --- |
| `src/model/config.ts`, `src/config.ts` | Public schema and inferred types; common identifiers, paths, input existence and output/input separation |
| `src/ports/language.ts` | Internal validation/build contracts, build context and compiled result |
| `src/adapters/<language>/config.ts` | Language-specific input combinations, native symbol syntax and supported error modes |
| `src/adapters/<language>/bridge.ts` | Native wrappers for the explicitly declared signatures |
| `src/adapters/<language>/compiler.ts` | Tool selection, compiler arguments, scratch files, native assets and runtime notices |
| `src/adapters/<language>/worker.ts` | Browser runtime initialization and conversion to `NativeCall` |
| `src/application/generate.ts`, `src/storage/output.ts` | Build sequencing, progress, lock, staging, commit and rollback |
| `src/codegen/web.ts` | Shared JS factories, TypeScript declarations, Worker schema and module barrel |
| `src/runtime/` | Request IDs, validation, serialized calls, readiness, deadlines and client disposal |

Keep language decisions inside the adapter. Shared generation and browser RPC
should not gain `if (language === ...)` branches for a new compiler.
`pnpm run architecture:check` enforces import boundaries: adapters cannot import
one another, shared orchestration cannot import concrete adapters, and browser
runtime code cannot depend on Node build services.

## First establish browser feasibility

Before implementation, prove that the toolchain can compile a tiny function to
the browser and initialize it inside a module Worker. Identify the runtime/glue,
required import functions, memory ownership, error behavior and license notices.
Choose supported input modes and a tested compiler version.

A `.wasm` binary alone is not sufficient. A WASI-only output may expect system
interfaces the browser does not provide; a managed language may require its own
runtime and garbage collector. wasmgen currently supplies neither a generic WASI
host nor arbitrary operating-system emulation. Browser-incompatible dependencies
must be ported or kept outside the selected native API.

Start with the existing scalar/string/numeric-array contract. Do not introduce
new public types or shared-memory requirements just to accommodate one example.
If the language needs additional capabilities, specify their public semantics
and compatibility before changing the shared model.

## Implement the adapter

1. **Extend the schema.** Add the language to the enum in `src/model/config.ts`
   and add any required executable overrides under `tools`. Types are inferred
   from this schema; do not maintain a second language union. Reuse `files` or
   `package` only when their documented meanings fit. A new input field also
   needs common path resolution/validation and configuration documentation.
2. **Validate without compiling.** Implement `validateInput(ParsedInput): void`.
   Reject unsupported combinations, native symbols and signature modes with
   actionable messages. `wasmgen check` must still work without this toolchain.
   Compiler availability, native signature matching and dependency resolution
   belong to generation.
3. **Generate a narrow bridge.** Use the declared `ResolvedInput.exports`, mapping
   public names to private binding names. Follow the existing `wasmgen_call_N`
   convention where bindings expose properties; public names must not collide
   with compiler/runtime internals. Validate native identifiers and use
   `JSON.stringify` for strings embedded in generated JavaScript.
4. **Build native assets.** Implement
   `build(ResolvedInput, BuildContext): Promise<CompiledModule>`. Invoke tools
   through `src/process.ts` with argument arrays and the supplied signal. Keep
   compiler metadata/version parsing here. Use separate files for substantial
   package/workspace logic, as the Rust adapter does.
5. **Emit the Worker initializer.** Return `{ workerSource }` after writing all
   browser-native assets and notices. Shared codegen prepends the `serve` import
   and `schema`; the adapter snippet initializes its runtime and calls `serve`.
6. **Register once.** Add the adapter in `src/languages.ts`. Its
   `satisfies LanguageAdapters` check requires every schema language and verifies
   that each registry entry advertises the matching language literal.

The declaration has this shape **after** the schema is extended. `example` is a
placeholder, and `validateInput` and `build` require real implementations:

```ts
import type { LanguageAdapter } from '../../ports/language.js';

export const exampleAdapter = {
  language: 'example',
  validateInput,
  build,
} satisfies LanguageAdapter<'example'>;
```

The contract is structural; the current adapters use equivalent explicit type
annotations. Inspect `src/adapters/cpp/` for a small integration and
`src/adapters/rust/` for workspace/dependency adaptation. Do not import one
adapter into another to reuse implementation details.

## Build ownership and failure handling

| `BuildContext` field | Contract |
| --- | --- |
| `directory` | Existing module directory inside staged output. Write only final browser assets and license notices here. Shared codegen subsequently writes `index.js`, `index.d.ts` and `worker.js`; reserve those names. |
| `scratch` | Existing module-specific temporary build directory. Put bridges, object files and intermediate metadata here; its contents are not published as generated assets. |
| `tools` | Validated executable overrides. Supply documented defaults and pass executable/arguments separately to `run`. |
| `signal` | Cancellation for this build. Pass it to every compiler invocation and check it before other expensive phases. Do not create an unrelated signal or hide cancellation errors. |

Paths in `ResolvedInput` are already resolved against the config location.
Do not resolve them again against the process working directory. Generated asset
URLs must be relative to the emitted Worker/module, normally using
`new URL('./native.wasm', import.meta.url)`, so production base paths work.

The generation workflow owns the final output and transaction. An adapter must
not replace that output, manage its lock, copy the shared runtime, or write the
barrel. It must await tool completion before returning; background compiler
processes would outlive staging and violate transaction ownership.

Treat native inputs, manifests and lockfiles as caller-owned. If a language
requires a temporary wrapper beside an input to preserve module visibility,
remove that wrapper in `finally` and test both success and failure. Explain the
write-permission requirement. Prefer the supplied scratch directory otherwise.
Copy necessary runtime notices with the generated assets and document provenance.

Preserve underlying errors when adding context with `new Error(message, { cause })`.
The workflow already prefixes compilation failures with the module and language.
If cleanup also fails, retain both failures and any recovery location; never let
a cleanup exception hide the original compilation/rollback diagnostic. Keep
compiler subprocesses under the shared runner's cancellation and output limits.

## Browser boundary

The initializer must resolve only when its runtime can accept a call. It returns
the `NativeCall` shape defined by `src/runtime/protocol.ts`:

```ts
type NativeResult = { ok: true; value?: unknown } | { ok: false; error: string };
type NativeCall = (method: string, args: unknown[]) => NativeResult | Promise<NativeResult>;
```

This is an explanatory copy of the current shape, not a new exported API. The
adapter's generated snippet calls `serve(async () => nativeCall, schema)` after
initializing its compiler-specific JS/Wasm. Do not emit a second readiness message
or implement another request queue: `serve` owns those behaviors.

Maintain these semantics:

- Parameters/results support `i32`, `u32`, finite `f64`, `bool`, `string` and
  `i32[]`/`u32[]`/`f64[]`; `void` is result-only. The shared Worker checks values,
  argument counts and numeric bounds. Convert language-specific containers to
  plain JavaScript arrays before crossing the boundary.
- Ordinary native errors become `{ ok: false, error }` and reject one call.
  Initialization failure and fatal `WebAssembly.RuntimeError` stop the client.
  Do not convert a fatal trap into an ordinary error and keep using damaged state.
- Calls on one client execute serially, including asynchronous native completion.
  Resolve the returned Promise only when results are ready. Native tasks must not
  mutate a result after returning it or leak indefinitely while the Worker lives.
- The client runtime owns its original cancellation signal, deadline timers and
  pending calls. Abort, timeout and `dispose()` terminate the entire Worker.
  Termination does not guarantee language destructors, defers or shutdown hooks.
- Use imports and generated bindings compatible with the tested production CSP.
  Do not require JavaScript `eval`, shared memory or cross-origin isolation
  silently. Changes to these deployment requirements need explicit documentation
  and browser tests.

Additional allocation/free rules inside Wasm belong to the adapter/native bridge.
The current public interface copies strings and arrays and exposes no native
pointers, callbacks, streams or transferable buffers. See the
[configuration reference](configuration.md) and [browser troubleshooting](troubleshooting.md).

## Validation before declaring support

Add a small independent fixture that demonstrates the supported language and
input modes. Do not rely on private application sources. Extend existing suites
at their boundaries:

| Check | Evidence required |
| --- | --- |
| Schema and validator | Valid modes, actionable rejection of unsupported combinations/symbols, `check` without a compiler |
| Bridge and compiler | Correct signatures/bindings, executable overrides, argument arrays, cancellation, failed tool execution and missing assets; mock OS boundaries rather than production modules |
| Native dependencies | Package/workspace resolution where supported; original sources, manifests and lockfiles unchanged after success/failure |
| Browser E2E | Real compiler and Wasm responses in Chromium, Firefox and WebKit, with development and production builds and `/demo/` base path |
| Runtime semantics | Unicode, numeric bounds, empty/large arrays, ordinary errors, fatal failures where applicable, initialization rejection, queued calls, cancellation and disposal without Worker leaks |
| TypeScript and packaging | Generated API/options imports typecheck; installed tarball's CLI/library can compile the fixture; all required glue and notices ship |
| Measurement | Add comparable benchmark fixtures when the existing operations are supported; document unsupported cases instead of presenting fabricated equivalents |

Update `test/Dockerfile` with the toolchain, add the new language to real E2E and
installed-package cases, and update prerequisites, configuration, limitations and
the changelog. When adding a shipped documentation file, update the package test's
file allowlist and required-file assertions in `test/e2e/package.ts`.

Run the [validation commands](testing.md) sequentially. Executable production
TypeScript must retain per-file 100% statements, branches, functions and lines.
That metric covers the generator/runtime, not native instructions represented by
template strings; real browser tests remain required. Use the
[benchmark guide](benchmarks.md) for smoke runs and performance claims.

## When the change exceeds an adapter

| Requested extension | Appropriate scope |
| --- | --- |
| Another native function using existing types | Consumer configuration/native wrapper; no generator extension |
| Another compiler/language using existing browser semantics | Schema/tool declarations, one adapter, registration, tests and docs |
| Another input mode for an existing language | That adapter plus schema/path handling if new fields are needed |
| A new public value type, streaming, callbacks or shared memory | Shared model, validation, codegen, runtime and affected adapters; define semantics and compatibility first |
| Another bundler/deployment environment | Consumer fixtures and asset-loading tests; change adapters only if their emitted assets actually need adaptation |
| Independently published third-party adapters | A separately designed public plugin contract; the current internal registry is insufficient |

A future plugin API would need explicit registration through a documented Node
entry point, a versioned adapter contract, language/tool-schema ownership and
collision checks, stable build/result semantics, and compatibility tests. It
would also need to document that plugins and compiler build scripts execute with
the generator user's privileges; they are not a sandbox. YAML should not silently
import and execute arbitrary packages.

These are design requirements for a possible future feature, not current
behavior or a committed roadmap. Keep adding built-in adapters through the
existing registry until independent plugin distribution is actually needed.
