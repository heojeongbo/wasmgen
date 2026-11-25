# Configuration reference

The config accepts YAML or JSON. Unknown fields, duplicate YAML keys and aliases
are rejected. Paths refer to the directory containing the selected config file,
independently of the shell's working directory. No glob expansion is performed.
This reference describes the current checkout; consult the [changelog](../CHANGELOG.md)
when using a published version.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | Yes | Config format version; must be `1`, independently of the npm package version. |
| `output` | Yes | Dedicated generated directory. Do not use a source or application root. |
| `input` | Yes | Nonempty list of native modules. |
| `tools` | No | Executable overrides; defaults to `{}`. See below. |

## Input modules

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | Yes | Unique module name and generated TypeScript factory export. |
| `language` | Yes | `go`, `cpp`, or `rust`. |
| `files` | Depends on language | Explicit list of source files. An empty list is invalid; omit it when unused. |
| `package` | Depends on language | Go package or concrete Rust library directory. |
| `headers` | C++ only | Nonempty list of C++ declaration headers. |
| `include` | No; C++ only | Additional include directories; defaults to `[]`. |
| `exports` | Yes | Nonempty mapping from browser function name to native signature. |

| Language | Valid input selection |
| --- | --- |
| Go | Exactly one of `files` or `package`. Files must be non-test `.go` files with distinct basenames. File mode isolates the selected package; use package mode for module dependencies, workspaces, `replace`, or `internal` packages. |
| C++ | `headers` is required. Omit `files` for header-only code. `package` is not accepted. |
| Rust | Exactly one of `files` or `package`. File mode takes one `.rs` crate root; use relative `mod` declarations for additional files. Package mode takes a concrete library crate, not a virtual workspace or binary-only crate. |

Go and Rust do not accept nonempty `headers` or `include`. See the README's
[native interface](../README.md#native-interface) for dependency handling and type mappings.
`check` validates paths and config rules, but package/library suitability and native
signatures are validated by `gen` using the actual compiler.

## Exported functions

| Field | Default | Meaning |
| --- | --- | --- |
| `symbol` | The export's key | Native function name. Go requires an exported identifier such as `Add`; C++ and Rust also accept qualified names such as `math::add`. |
| `params` | `[]` | Ordered list of `{ name, type }` objects. Parameter names must be unique within the function. |
| `result` | Required | A supported value type or `void`. |
| `error` | `false` | Go: `(T, error)` or `error`; Rust: `Result<T, E>` or `Result<(), E>`. Omit entirely for C++, including `error: false`. |

Value types are `i32`, `u32`, `f64`, `bool`, `string`, `i32[]`, `u32[]`, and
`f64[]`. Use quotes around array types in inline YAML mappings.
Structs, pointers, `int64`, callbacks and nested arrays are not supported.

Module, function and parameter names must match `[A-Za-z_][A-Za-z0-9_]*` and
must not be reserved JavaScript/TypeScript identifiers. `arguments`, `eval`,
`dispose`, `constructor`, `prototype` and `__proto__` are also reserved.
`then` is additionally forbidden for module and exported function names to prevent
Promise assimilation. Use `symbol` to expose a native function under another name.
These rules do not restrict ordinary names such as `hasOwnProperty` in the current
checkout; compiler bindings use private names.

## Tool overrides

| Field | Default executable |
| --- | --- |
| `tools.go` | `go` |
| `tools.cpp` | `em++` |
| `tools.cargo` | `cargo` |
| `tools.wasmBindgen` | `wasm-bindgen` |

Only tools needed by configured modules are invoked. Use an executable name on
`PATH` or an absolute path. Unlike source paths, executable overrides are not
resolved relative to the config. Do not put arguments or shell commands in a
tool value. Arbitrary compiler/linker flags and feature-selection options are
not exposed by this version.

## CLI

```sh
pnpm exec wasmgen check --config wasmgen.yaml
pnpm exec wasmgen gen --config wasmgen.yaml
```

`-c` aliases `--config`; the default is `wasmgen.yaml` in the current directory.
`--help` or `-h` prints usage. Failures print a diagnostic to stderr and return
exit status `1`. Generation progress goes to stderr; success goes to stdout.

`check` performs no compilation or browser execution. `gen` builds each module
sequentially into staging and replaces output only after all modules succeed.
An existing output must be empty or owned by wasmgen. Unknown files and symlinks
block replacement. Previously generated files are replaceable: editing an owned
file does not protect it from the next generation.

## Library API

Import from `@heojeongbo/wasmgen` in Node.js ESM. The package root does not expose
a browser runtime or a CommonJS `require` entry point.

- `readConfig(configPath)` returns `Promise<ResolvedConfig>`: normalized inputs,
  absolute source/output paths, config root, and tool settings. It performs the
  same checks as the CLI's `check` command.
- `generate(configPath, options?)` returns
  `Promise<{ output: string; modules: string[] }>` after successful replacement.
  `output` is absolute; `modules` contains factory names in config order.
- `options.onProgress?: (message: string) => void` receives build progress.
- `options.signal?: AbortSignal` cancels generation and active compiler execution;
  cancellation before replacement preserves previous output.

On POSIX hosts, cancellation also stops compiler descendants in the runner's
process group. SIGTERM is followed by SIGKILL after one second if necessary.
Windows uses direct child termination; descendant cleanup there is not covered
by the supported test matrix. This build-process cancellation is separate from
browser Worker termination.

The generated browser factory has different options: `signal` owns the lifetime
of the entire client and `timeoutMs` applies to initialization and each call,
including queue time. See [browser client usage](../README.md#import-from-typescript).
