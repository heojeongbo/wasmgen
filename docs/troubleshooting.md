# Troubleshooting

Start with `pnpm exec wasmgen check --config wasmgen.yaml`, then `gen`.
A successful check does not establish that a compiler is installed or that a
native dependency supports the browser target. Use `pnpm exec wasmgen --version`
to identify the installed generator. Keep the compiler diagnostic
when reporting a failure; include a minimal input/config and tool versions.

Config diagnostics include the config path and offending field, for example
`/project/wasmgen.yaml: geometry.files[0]: file not found: /project/native/math.cc`.
Paths resolve from that config's directory. A message starting with
`geometry (cpp) build failed:` identifies the module whose compiler or generated
output failed; the following diagnostic carries the underlying cause.

## Compiler and dependency failures

| Symptom | Check |
| --- | --- |
| `cannot run ... ENOENT` | Put the required executable on `PATH`, or set its absolute path under `tools`. Emscripten needs `em++`, not the host's C++ compiler. |
| Go imports fail in `files` mode | Use `package` for an existing module with dependencies, workspace settings or `internal` imports. File mode copies only selected files into an isolated module. |
| Go package wrapper cannot be created | Package mode temporarily creates a directory inside the selected package. The package must be writable. |
| Rust target or linker is missing | Install `wasm32-unknown-unknown` with rustup and a host C/C++ linker for dependency build scripts. |
| wasm-bindgen version mismatch | Match the installed CLI to the crate version used by the dependency graph. The bridge pins the exact CLI version. |
| Rust package is rejected | Select the library crate directory, not the workspace root or a binary-only package. |
| Cargo override does not take effect | Put `[patch]` or `[replace]` at the original workspace root. Check package name/version constraints; a patch still follows Cargo's version selection. |
| C++ warning stops the build | This integration uses C++17 with warnings treated as errors. Fix the native warning; arbitrary compiler-flag overrides are not supported. |
| `stdout exceeded 32 MiB` | The tool produced more machine-readable output than the runner can capture. Verify the selected executable and workspace size. wasmgen fails explicitly rather than parsing or using a truncated result. |

The tested toolchain versions and Docker commands are in
[Validation](../README.md#validation). Tests run on Linux in that container;
other host OS/toolchain combinations are not covered by the automated matrix.
Cargo, Go and their dependencies may access public registries during generation.
An npm-only install does not install native compilers or guarantee an offline build.

## Browser loading and CSP

Serve the web application over HTTP(S), not `file://`. In the Network panel,
check Worker scripts and `.wasm` responses for their URL, status and content type.
A SPA fallback returning HTML with status 200 is not a valid Wasm response.
Deploy the complete bundler output, preserve its base path, and serve `.wasm`
as `application/wasm`. Check stale caches if the client and assets come from
different builds.

The production E2E matrix applies this focused policy to the document **and
Worker script responses**:

```http
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'; base-uri 'none'
```

This demonstrates the generated clients' requirements; it is not a complete
policy for every consuming app. Merge these requirements with the app's existing
CSP and resource origins. A document's CSP alone does not test dynamic-code
restrictions inside a separately served Worker. Development tooling may have
additional requirements, so this policy is tested against production output.

The current checkout sets Emscripten's
[`DYNAMIC_EXECUTION=0`](https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution)
to avoid `eval`/`new Function` in its C++ glue. This disables Emscripten features
that require dynamic JavaScript execution and can use slower binding paths.
Published `0.2.0` C++ output predates this change; upgrade to `0.2.1` or later
and regenerate the browser modules. See the [changelog](../CHANGELOG.md).
Updating the npm generator alone does not change existing
generated files. Go and Rust use their own generated runtimes.

The project tests Chromium, Firefox and WebKit from the pinned Playwright image,
with Vite development/production and a `/demo/` base path. This is not a claim
that all older browser versions or other bundlers work. The current integration
uses no shared memory and does not require cross-origin isolation.

## Calls reject or stop responding

Runtime validation rejects wrong argument counts, numeric ranges, nonfinite
`f64` values and sparse arrays. Pass plain arrays, not typed arrays. Ordinary
native errors reject one call and allow later calls to continue.

Abort, timeout, disposal or a fatal Wasm trap closes the entire client, including
queued calls. Create a new client to recover. The default timeout is 30 seconds
for initialization and each call, including time spent waiting behind other calls.
Increase `timeoutMs` when intentional work needs more time, or reduce the batch
size. Calls on one instance are serialized; they do not execute concurrently.

Always call `dispose()` when finished. Termination is not a graceful native
shutdown: Go defers or native cleanup hooks cannot be relied on after the Worker
is killed. Goroutines started by native code need their own exit path while the
instance remains alive.

## Output ownership and recovery

- `refusing to replace output not owned by wasmgen`: choose a dedicated generated
  directory. Do not manufacture `.wasmgen.json` to claim an existing source tree.
- `unmanaged output file`: move hand-maintained files out of the generated directory
  before generating again. Owned generated files may be overwritten.
- `must not contain input`: move the output away from the config and declared
  inputs. The current checkout also checks their resolved filesystem locations.
- `another generation owns ...wasmgen-lock`: first establish that no generation
  process is still using that output. After an interrupted process has fully exited,
  remove only the lock directory named in the diagnostic, then retry.
- `cannot restore previous output`: preserve the staging/backup path printed in
  the error. Inspect and recover the previous output from there before retrying.

Normal failures preserve previous output and clean staging. A hard process kill
or machine shutdown can leave staging/lock directories or a partially completed
directory swap; do not assume crash recovery is automatic. Do not retarget
symlinks or edit the output concurrently with generation.

## Public npm installation

Use `pnpm add -D @heojeongbo/wasmgen`. No internal registry or npm token is needed.
In this repository, a warning about an unset `NPM_TOKEN` comes from the maintainer
`.npmrc`; it does not make the public package private. Never paste tokens into a
bug report. Preserve generated license notices when deploying the application.
