import type { BenchmarkReport } from './model.js';

export function markdown(report: BenchmarkReport): string {
  const { environment: env, generation, settings } = report;
  const ms = (value: number) => value.toFixed(3);
  const lines = [
    '# wasmgen benchmark results', '',
    `Recorded: ${report.recordedAt}. Profile: **${settings.profile}**. Package: ${env.packageVersion}.`,
    `Revision: \`${env.revision}\`${env.dirty ? ' (working tree has changes)' : ''}.`, '',
    `Environment: ${env.platform}, ${env.architecture}, ${env.cpu}, ${env.logicalCpus} logical CPUs, ${(env.memoryBytes / 1024 ** 3).toFixed(1)} GiB RAM; Node ${env.node}.`, '',
    ...Object.entries(env.toolchains).map(([tool, version]) => `- ${tool}: ${version}`), '',
    '## Generation', '',
    'Complete CLI generation of all three fixture modules, including native compilation and output replacement.',
    'Existing toolchain/download caches are retained; these are not clean-toolchain or incremental-build measurements.', '',
    '| First run (ms) | Repeated median (ms) | Repeated min–max (ms) | Repeated samples |',
    '| ---: | ---: | ---: | ---: |',
    `| ${ms(generation.firstMs)} | ${ms(generation.repeatedMs.median)} | ${ms(generation.repeatedMs.min)}–${ms(generation.repeatedMs.max)} | ${generation.repeatedMs.count} |`, '',
    '## Generated module sizes', '',
    'Wasm gzip uses level 9. JavaScript sizes are raw, before bundling; shared client code and license notices are excluded.', '',
    '| Language | Wasm bytes | Wasm gzip bytes | Module JavaScript bytes |',
    '| --- | ---: | ---: | ---: |',
    ...report.assets.map(asset => `| ${asset.language} | ${asset.wasmBytes} | ${asset.wasmGzipBytes} | ${asset.moduleJavaScriptBytes} |`), '',
    '## Browser initialization', '',
    `Factory invocation to ready; ${settings.startupSamples} fresh contexts per language/engine. Navigation and harness imports are excluded.`,
    'Browser processes and OS caches are reused; this is not a cold-device network benchmark.', '',
    '| Browser | Version | Language | Median (ms) | Min–max (ms) |',
    '| --- | --- | --- | ---: | ---: |',
    ...report.browsers.map(row => `| ${row.browser} | ${row.version} | ${row.language} | ${ms(row.startupMs.median)} | ${ms(row.startupMs.min)}–${ms(row.startupMs.max)} |`), '',
    '## Sequential Worker round trips', '',
    `${settings.warmup} unmeasured warmup calls per operation, then ${settings.batches} batches × ${settings.iterations} sequential calls.`,
    'Each sample is elapsed batch time / calls. Median and p95 describe **batch averages**, not individual-call tail latency.',
    'Includes generated validation, message passing, copying, native bindings, computation, and result delivery.',
    'Checks run outside timed intervals. Local production assets, headless browsers, no network/CPU throttling.', '',
    '| Browser | Language | Operation | Median (ms/call) | p95 batch average (ms/call) | Min–max (ms/call) |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...report.browsers.flatMap(row => row.rpc.map(({ operation, millisecondsPerCall: d }) =>
      `| ${row.browser} | ${row.language} | ${operation} | ${ms(d.median)} | ${ms(d.p95)} | ${ms(d.min)}–${ms(d.max)} |`)), '',
    'Raw samples and exact settings are in the companion JSON report. Results are observations, not performance guarantees or native-language rankings.', '',
  ];
  return lines.join('\n');
}
