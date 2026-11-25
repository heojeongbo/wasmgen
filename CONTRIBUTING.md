# Contributing to wasmgen

Use TypeScript for generator, browser runtime, scripts and tests, and pnpm 10.11.0
for repository commands. Native fixtures are independent examples; do not copy
private application code, credentials or external checkouts into this project.
Start with the [architecture](README.md#architecture) and
[configuration reference](docs/configuration.md).

## Local validation

Use the [test container](README.md#validation) for a reproducible set of Go,
Emscripten, Rust, wasm-bindgen and browser versions. Install dependencies with
`pnpm install --frozen-lockfile` inside it.

| Change | Validation |
| --- | --- |
| Config, output handling or other generator logic | `pnpm run check` and `pnpm test`; add a regression for a reproduced behavior change. |
| Native adapters, generated code or browser lifecycle | The above, plus `pnpm run test:e2e`. |
| Packaging, public exports, dependencies or installed-user behavior | The above, plus `pnpm run test:package`. |
| Documentation | Check relative links and verify commands/API descriptions against the implementation; run applicable commands when they change. |

Run suites sequentially: they share `dist/`, generated examples and test output.
`test:e2e` generates examples before checking their declarations. `test:package`
builds and installs a real tarball into an isolated consumer and verifies all
three languages. Both browser suites use Chromium, Firefox and WebKit in
development and production. Production responses include the tested CSP.
Reports and screenshots appear in `.artifacts/`; they are not source files.

## Extending the implementation

Keep native validation, bridge generation, compiler execution and Worker
initialization inside the relevant language adapter. The generator owns build
ordering and output replacement; the shared runtime owns RPC validation, ordering
and client lifetime. Avoid adding language switches to those shared modules.

A new built-in language needs its schema/types, an adapter satisfying
`LanguageAdapter`, and registration in `src/languages.ts`. Follow the existing
contracts before introducing another abstraction. This is an internal extension
point, not a supported third-party plugin API. Public browser names must remain
independent of compiler runtime names.

Test native success and errors, generated TypeScript, initialization failure,
termination, queued calls and actual browser execution. Dependency integration
tests should verify original sources/manifests/lockfiles are unchanged. Update
user documentation and the unreleased changelog when supported behavior changes.

## Preparing a release

Run the full validation matrix on the release contents. Update the package version
and changelog, then create and inspect a tarball with `pnpm pack`. The package's
allowlist includes compiled generator files, user documentation and license files;
credentials, examples, test consumers and native application sources stay outside it.

Publish the reviewed tarball from the intended release commit. After publishing,
verify its public registry integrity and install the exact version into a fresh
consumer without credentials. Record the version, commit, test results and public
installation result together. A successful local pack is not proof of publication.

Authentication is needed only for publishing. Follow
[maintainer credential storage](README.md#maintainer-credentials); do not place
tokens in command-line arguments, logs, package files or Git. The repository's
local `.env.local` is not automatically loaded by pnpm.
