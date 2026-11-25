import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import type { Config } from '../src/index.js';
import { run } from '../src/process.js';
import { benchmarkBrowsers } from './browser.js';
import { languages, settings, type BenchmarkReport, type BrowserName } from './model.js';
import { markdown } from './report.js';
import { summarize } from './statistics.js';

const { values } = parseArgs({ options: { quick: { type: 'boolean' }, browser: { type: 'string', default: 'all' }, help: { type: 'boolean', short: 'h' } } });
if (values.help) {
  console.log('Usage: pnpm bench [--quick] [--browser chromium|firefox|webkit|all]\nReports: .artifacts/benchmarks/<run>/results.{json,md}\nRequires the native toolchains and Playwright browsers; see docs/benchmarks.md.');
} else {
  const browser = values.browser;
  if (browser !== 'all' && browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
    throw new Error('--browser must be chromium, firefox, webkit, or all');
  }
  const selected: BrowserName[] = browser === 'all' ? ['chromium', 'firefox', 'webkit'] : [browser];
  const options = settings(Boolean(values.quick));
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.chdir(root);
  await mkdir('.test-output', { recursive: true });
  await mkdir('.artifacts/benchmarks', { recursive: true });
  const directory = await mkdtemp(path.resolve('.artifacts/benchmarks', new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const work = await mkdtemp(path.resolve('.test-output/benchmark-'));
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('benchmark interrupted'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const command = (executable: string, args: string[]) => run(executable, args, { signal: controller.signal });
  try {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    const environment: BenchmarkReport['environment'] = {
      packageVersion: manifest.version, revision: await command('git', ['rev-parse', 'HEAD']),
      dirty: Boolean(await command('git', ['status', '--porcelain'])),
      platform: `${os.platform()} ${os.release()}`, architecture: os.arch(), cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.availableParallelism(), memoryBytes: os.totalmem(), node: process.version,
      toolchains: {},
    };
    for (const [name, executable, args] of [
      ['go', 'go', ['version']], ['emscripten', 'em++', ['--version']],
      ['rust', 'rustc', ['--version']], ['cargo', 'cargo', ['--version']],
      ['wasm-bindgen', 'wasm-bindgen', ['--version']], ['pnpm', 'pnpm', ['--version']],
    ] as const) environment.toolchains[name] = (await command(executable, [...args])).split('\n')[0]!;
    const web = path.join(work, 'web');
    await mkdir(web);
    const nativeFile = (file: string) => path.resolve('examples', file);
    const exports = (divide: string, scale: string, error: boolean) => ({
      divide: { symbol: divide, params: [{ name: 'a', type: 'f64' as const }, { name: 'b', type: 'f64' as const }], result: 'f64' as const, ...(error ? { error: true } : {}) },
      scale: { symbol: scale, params: [{ name: 'values', type: 'f64[]' as const }, { name: 'factor', type: 'f64' as const }], result: 'f64[]' as const },
    });
    const config: Config = { version: 1, output: './web/generated', input: [
      { name: 'goCalc', language: 'go', files: [nativeFile('go/logic.go')], exports: exports('Divide', 'Scale', true) },
      { name: 'cppCalc', language: 'cpp', files: [nativeFile('cpp/geometry.cc')], headers: [nativeFile('cpp/geometry.h')], exports: exports('geometry::Divide', 'geometry::Scale', false) },
      { name: 'rustCalc', language: 'rust', files: [nativeFile('rust/lib.rs')], exports: exports('divide', 'scale', true) },
    ] };
    const configFile = path.join(work, 'wasmgen.json');
    await writeFile(configFile, JSON.stringify(config));
    const timings: number[] = [];
    for (let sample = 0; sample <= options.generationSamples; sample++) {
      const start = performance.now();
      await command(process.execPath, ['dist/cli.js', 'gen', '--config', configFile]);
      timings.push(performance.now() - start);
      console.log(`Generation ${sample + 1}/${options.generationSamples + 1}: ${timings.at(-1)!.toFixed(0)} ms`);
    }
    const assets: BenchmarkReport['assets'] = [];
    for (const language of languages) {
      const module = path.join(web, 'generated', `${language}Calc`);
      let wasmBytes = 0, wasmGzipBytes = 0, moduleJavaScriptBytes = 0;
      for (const file of await readdir(module)) {
        if (!file.endsWith('.wasm') && !file.endsWith('.js')) continue;
        const content = await readFile(path.join(module, file));
        if (file.endsWith('.wasm')) { wasmBytes += content.length; wasmGzipBytes += gzipSync(content, { level: 9 }).length; }
        else moduleJavaScriptBytes += content.length;
      }
      if (!wasmBytes) throw new Error(`no Wasm artifact for ${language}`);
      assets.push({ language, wasmBytes, wasmGzipBytes, moduleJavaScriptBytes });
    }
    const harness = path.relative(web, path.join(root, 'benchmarks/harness.js')).split(path.sep).join('/');
    await writeFile(path.join(web, 'entry.ts'), `import { goCalc, cppCalc, rustCalc } from './generated/index.js';
import { createHarness, type BenchmarkGlobals } from ${JSON.stringify(harness)};
(globalThis as BenchmarkGlobals).__wasmgenBenchmark = createHarness({ go: goCalc, cpp: cppCalc, rust: rustCalc });\n`);
    await writeFile(path.join(web, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>wasmgen benchmark</title><script type="module" src="./entry.ts"></script></html>');
    await writeFile(path.join(work, 'tsconfig.json'), JSON.stringify({ extends: path.join(root, 'tsconfig.json'), compilerOptions: { rootDir: root, noEmit: true }, include: ['./web/entry.ts'] }));
    await command('pnpm', ['exec', 'tsc', '-p', path.join(work, 'tsconfig.json')]);
    controller.signal.throwIfAborted();
    const browsers = await benchmarkBrowsers(web, selected, options, controller.signal);
    controller.signal.throwIfAborted();
    const report: BenchmarkReport = {
      schemaVersion: 1, recordedAt: new Date().toISOString(), environment, settings: options,
      generation: { firstMs: timings[0]!, repeatedMs: summarize(timings.slice(1)) }, assets, browsers,
    };
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(path.join(directory, 'results.md'), markdown(report));
    console.log(`Reports: ${path.relative(root, directory)}/results.{json,md}`);
  } catch (error) {
    await writeFile(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2) + '\n');
    throw error;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await rm(work, { recursive: true, force: true });
  }
}
