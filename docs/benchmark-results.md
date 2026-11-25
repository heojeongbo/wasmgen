# wasmgen benchmark results

Recorded: 2026-11-25T11:12:29.190Z. Profile: **full**. Package: 0.2.2.
Revision: `4e433f012342130a0ce740f21cb53f9e8fc98371`.

Environment: linux 7.0.14-linuxkit, arm64, unknown, 12 logical CPUs, 11.7 GiB RAM; Node v24.15.0.

- go: go version go1.22.2 linux/arm64
- emscripten: emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.10 (b7dc6e5747465580df5984e723b9d1f10d8e804b)
- rust: rustc 1.100.0 (0ef1bc386 2026-11-09)
- cargo: cargo 1.100.0 (3acc79c0c 2026-11-05)
- wasm-bindgen: wasm-bindgen 0.2.130
- pnpm: 10.11.0

## Generation

Complete CLI generation of all three fixture modules, including native compilation and output replacement.
Existing toolchain/download caches are retained; these are not clean-toolchain or incremental-build measurements.

| First run (ms) | Repeated median (ms) | Repeated min–max (ms) | Repeated samples |
| ---: | ---: | ---: | ---: |
| 6639.285 | 6095.194 | 6075.459–6202.349 | 3 |

## Generated module sizes

Wasm gzip uses level 9. JavaScript sizes are raw, before bundling; shared client code and license notices are excluded.

| Language | Wasm bytes | Wasm gzip bytes | Module JavaScript bytes |
| --- | ---: | ---: | ---: |
| go | 2755562 | 785119 | 18380 |
| cpp | 22931 | 8855 | 31907 |
| rust | 20144 | 8042 | 7879 |

## Browser initialization

Factory invocation to ready; 5 fresh contexts per language/engine. Navigation and harness imports are excluded.
Browser processes and OS caches are reused; this is not a cold-device network benchmark.

| Browser | Version | Language | Median (ms) | Min–max (ms) |
| --- | --- | --- | ---: | ---: |
| chromium | 148.0.7778.0 | go | 35.000 | 32.900–46.200 |
| chromium | 148.0.7778.0 | cpp | 9.100 | 8.600–11.800 |
| chromium | 148.0.7778.0 | rust | 8.400 | 7.500–9.400 |
| firefox | 150.0.2 | go | 86.000 | 69.000–112.000 |
| firefox | 150.0.2 | cpp | 13.000 | 13.000–16.000 |
| firefox | 150.0.2 | rust | 14.000 | 11.000–30.000 |
| webkit | 26.4 | go | 37.000 | 34.000–49.000 |
| webkit | 26.4 | cpp | 9.000 | 9.000–9.000 |
| webkit | 26.4 | rust | 7.000 | 6.000–21.000 |

## Sequential Worker round trips

25 unmeasured warmup calls per operation, then 9 batches × 25 sequential calls.
Each sample is elapsed batch time / calls. Median and p95 describe **batch averages**, not individual-call tail latency.
Includes generated validation, message passing, copying, native bindings, computation, and result delivery.
Checks run outside timed intervals. Local production assets, headless browsers, no network/CPU throttling.

| Browser | Language | Operation | Median (ms/call) | p95 batch average (ms/call) | Min–max (ms/call) |
| --- | --- | --- | ---: | ---: | ---: |
| chromium | go | divide | 0.124 | 0.240 | 0.096–0.240 |
| chromium | go | scale[32] | 0.152 | 0.256 | 0.124–0.256 |
| chromium | go | scale[1024] | 0.724 | 1.264 | 0.668–1.264 |
| chromium | go | scale[16384] | 10.520 | 15.696 | 10.136–15.696 |
| chromium | cpp | divide | 0.060 | 0.068 | 0.052–0.068 |
| chromium | cpp | scale[32] | 0.076 | 0.084 | 0.068–0.084 |
| chromium | cpp | scale[1024] | 0.444 | 0.452 | 0.436–0.452 |
| chromium | cpp | scale[16384] | 6.676 | 11.152 | 6.412–11.152 |
| chromium | rust | divide | 0.052 | 0.056 | 0.048–0.056 |
| chromium | rust | scale[32] | 0.064 | 0.068 | 0.060–0.068 |
| chromium | rust | scale[1024] | 0.188 | 0.200 | 0.176–0.200 |
| chromium | rust | scale[16384] | 2.136 | 2.612 | 2.080–2.612 |
| firefox | go | divide | 0.240 | 0.280 | 0.200–0.280 |
| firefox | go | scale[32] | 0.400 | 0.440 | 0.360–0.440 |
| firefox | go | scale[1024] | 4.760 | 5.240 | 4.560–5.240 |
| firefox | go | scale[16384] | 75.120 | 76.800 | 73.200–76.800 |
| firefox | cpp | divide | 0.080 | 0.080 | 0.040–0.080 |
| firefox | cpp | scale[32] | 0.080 | 0.120 | 0.080–0.120 |
| firefox | cpp | scale[1024] | 0.840 | 0.960 | 0.760–0.960 |
| firefox | cpp | scale[16384] | 11.320 | 12.160 | 11.040–12.160 |
| firefox | rust | divide | 0.080 | 0.120 | 0.040–0.120 |
| firefox | rust | scale[32] | 0.080 | 0.120 | 0.040–0.120 |
| firefox | rust | scale[1024] | 0.240 | 0.280 | 0.160–0.280 |
| firefox | rust | scale[16384] | 2.440 | 3.320 | 2.240–3.320 |
| webkit | go | divide | 0.120 | 0.400 | 0.120–0.400 |
| webkit | go | scale[32] | 0.160 | 0.240 | 0.120–0.240 |
| webkit | go | scale[1024] | 0.640 | 1.360 | 0.560–1.360 |
| webkit | go | scale[16384] | 8.960 | 9.480 | 8.360–9.480 |
| webkit | cpp | divide | 0.080 | 0.120 | 0.040–0.120 |
| webkit | cpp | scale[32] | 0.080 | 0.120 | 0.080–0.120 |
| webkit | cpp | scale[1024] | 0.520 | 0.600 | 0.440–0.600 |
| webkit | cpp | scale[16384] | 7.200 | 7.280 | 6.960–7.280 |
| webkit | rust | divide | 0.080 | 0.120 | 0.040–0.120 |
| webkit | rust | scale[32] | 0.080 | 0.080 | 0.040–0.080 |
| webkit | rust | scale[1024] | 0.160 | 0.200 | 0.160–0.200 |
| webkit | rust | scale[16384] | 2.360 | 2.600 | 2.240–2.600 |

Raw samples and exact settings are in the companion JSON report. Results are observations, not performance guarantees or native-language rankings.
