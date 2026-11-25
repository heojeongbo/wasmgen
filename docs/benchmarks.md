# Benchmarks

Run benchmarks from a repository checkout using pnpm and the
[test container](../README.md#validation). The harness is TypeScript and uses the
existing Playwright/Vite dependencies. No benchmark dependency is added to the
published generator or generated browser clients.

```sh
pnpm install --frozen-lockfile
pnpm bench
```

The default runs real Go, C++ and Rust compilation followed by Chromium, Firefox
and WebKit against a production build. Native tools and all selected browser
engines must be installed. A missing tool or browser fails the run; it is not
silently skipped.

```sh
# Fast smoke run: check the harness, not a performance baseline.
pnpm bench --quick --browser chromium

# Full sampling in one engine.
pnpm bench --browser firefox

pnpm bench --help
```

Each run writes a new directory under `.artifacts/benchmarks/` containing
`results.json` (raw samples, settings, source revision and environment) and
`results.md` (tables). Failed runs write `failure.json` and exit nonzero instead
of writing a successful report. Temporary builds are isolated under `.test-output/`
and removed afterward. Existing generated examples are not overwritten.
Run the benchmark separately from builds/tests and other intensive workloads.

## What is measured

The fixtures reuse the public examples' `divide` and `scale` functions. Each
language exports the same two browser signatures. These are small, portable
operations for observing integration costs, not representative application workloads.

| Metric | Measurement boundary | Default sampling |
| --- | --- | --- |
| Generation | Node CLI launch through all three native builds, web code generation and output replacement | First run reported separately, then 3 repeated runs |
| Initialization | Factory invocation through Worker/runtime readiness | 5 fresh browser contexts per language and engine |
| Scalar round trip | `await client.divide(a, b)` | 25 warmup calls, then 9 batches of 25 sequential calls |
| Array round trip | `await client.scale(values, factor)` with 32, 1,024 or 16,384 numbers | Same warmup/batches, separately for each length |
| Module size | Generated `.wasm` bytes, gzip level 9 bytes, and raw module-local JavaScript bytes | One generated output |

The CLI timing excludes the benchmark's own TypeScript build, tool version probes,
Vite build and report writing. It includes process startup, config validation,
compiler work and filesystem operations. Existing download/compiler caches are
retained. The first run is **not** described as a clean-toolchain build; repeated
runs rebuild through wasmgen's temporary directories, not an incremental build API.

Initialization excludes browser launch, navigation and importing the harness.
Each sample gets a fresh [browser context](https://playwright.dev/docs/browser-contexts),
while the browser process and OS caches remain alive. Assets come from localhost
without network throttling. These values do not predict a first visit over the internet.

Calls are timed inside the page with
[`performance.now()`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now),
so Playwright transport latency is outside the measured interval. Timing a batch
reduces the effect of browser timer precision. Browser default timer precision is
preserved; no isolation flags or synthetic clock are enabled.

Each timed batch awaits one call at a time. Its elapsed time is divided by its
call count; reports retain every batch average and show median, mean, minimum,
maximum and nearest-rank p95 in JSON. Markdown shows median, p95 and range.
**The p95 is a percentile of batch averages, not individual-request tail latency.**
With nine samples, nearest-rank p95 is the maximum; use repeated full runs to assess
variation instead of treating that value as a stable tail estimate.

Inputs vary between calls. Input arrays are prepared before timing. Warmup results
and the last result of every measured batch are checked outside the timed interval,
including every element of array results. Incorrect output, unexpected browser
errors, missing Wasm requests or external asset requests fail the run. Clients,
contexts, browsers and the server are closed after use, including failures.

## Interpreting results

- Round trips include generated argument/result validation, Worker messages,
  structured cloning, native bindings, computation and return delivery. They do
  not isolate native computation or measure parallel throughput.
- Array length is the number of `f64` values **in each direction**. These are plain
  JavaScript arrays; their serialized message size is not simply `length × 8` bytes.
- Go uses its standard Wasm runtime and goroutine bridge; C++ uses Emscripten and
  Rust uses wasm-bindgen. The fixtures also have different native error/allocation
  paths. Results are not a fair ranking of the languages or evidence that Wasm is
  faster than JavaScript. There is no JavaScript-only baseline in this suite.
- Binary sizes depend on exported functions, toolchain versions and build settings.
  Module JavaScript sizes exclude shared generated code, license notices and bundler
  output; gzip bytes are calculated sizes, not observed HTTP transfer sizes.
- Browser scheduling, JIT, garbage collection, Docker virtualization, filesystem
  mounts, CPU load and thermal state affect measurements. Headless Linux WebKit is
  not a substitute for Safari on an Apple device.

For comparisons, use the same host, container, toolchain versions, browser engines,
profile and power/load conditions. Save multiple full reports before and after a
change and examine raw samples and ranges. There is deliberately no timing-based
pass/fail threshold in CI; correctness tests and benchmarks serve different purposes.
The quick profile uses 1 repeated build, 2 startup samples, 5 warmup calls and
3 batches of 5 calls, and must not be compared with a full baseline.
