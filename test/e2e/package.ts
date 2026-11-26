import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../../src/process.js';
import { runBrowsers } from './browser.js';
import { nativeSnapshot } from './native-snapshot.js';

interface AddClient { add(value: number): Promise<number>; dispose(): void }
type Clamp = (value: number, low: number, high: number) => Promise<number>;
type PackageGlobals = typeof globalThis & { __wasmgenTest: {
  calc: () => Promise<AddClient>;
  geometry: () => Promise<{ clamp: Clamp; hasOwnProperty: Clamp; calledRun: Clamp; locateFile: Clamp; dispose(): void }>;
  rustCalc: () => Promise<AddClient>;
  rustPatch: () => Promise<AddClient>;
  rustReplace: () => Promise<AddClient>;
} };

const artifacts = path.resolve('.artifacts');
await mkdir(artifacts, { recursive: true });
const tarball = path.join(artifacts, 'wasmgen-test.tgz');
await run('pnpm', ['pack', '--out', tarball]);
// Inspect the archive itself: lifecycle output is not a stable JSON channel.
const packed = { filename: tarball, files: (await run('tar', ['-tzf', tarball])).split('\n').filter((file) => !file.endsWith('/')).map((file) => ({ path: file.replace(/^package\//, '') })) };
for (const { path: file } of packed.files) {
  assert(file.startsWith('dist/') || ['package.json', 'README.md', 'CHANGELOG.md', 'docs/configuration.md', 'docs/troubleshooting.md', 'docs/benchmarks.md', 'docs/benchmark-results.md', 'docs/benchmark-results.json', 'docs/testing.md', 'LICENSE'].includes(file), `unexpected public package file: ${file}`);
}
assert(packed.files.some((file) => file.path === 'README.md'), 'package must include usage documentation');
for (const file of ['CHANGELOG.md', 'docs/configuration.md', 'docs/troubleshooting.md', 'docs/benchmarks.md', 'docs/benchmark-results.md', 'docs/benchmark-results.json', 'docs/testing.md']) {
  assert(packed.files.some((entry) => entry.path === file), `package must include ${file}`);
}
const consumer = path.resolve('.test-output/consumer');
await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'wasmgen-consumer', private: true, type: 'module', packageManager: 'pnpm@10.11.0' }));
await run('pnpm', ['add', '--save-dev', '--ignore-scripts', '--registry=https://registry.npmjs.org', path.resolve(artifacts, packed.filename)], { cwd: consumer });
const installedManifest = JSON.parse(await readFile(path.join(consumer, 'node_modules/@heojeongbo/wasmgen/package.json'), 'utf8')) as { version: string };
assert.equal(await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['--version'], { cwd: consumer }), installedManifest.version);
await cp('test/fixtures', path.join(consumer, 'native'), { recursive: true });
await cp('examples/cpp', path.join(consumer, 'native/cpp'), { recursive: true });
const rustLock = await readFile(path.join(consumer, 'native/rust-workspace/Cargo.lock'), 'utf8');
const nativeBefore = await nativeSnapshot(path.join(consumer, 'native'));
const root = path.join(consumer, 'web');
await mkdir(root);
await writeFile(path.join(consumer, 'wasmgen.json'), JSON.stringify({
  version: 1, output: './web/generated', input: [
    { name: 'output', language: 'go', package: './native/go-module/internal/calc', exports: {
      add: { symbol: 'Add', params: [{ name: 'value', type: 'f64' }], result: 'f64' },
    } },
    { name: 'previous', language: 'cpp', files: ['./native/cpp/geometry.cc'], headers: ['./native/cpp/geometry.h'], exports: {
      // Public API names must not overwrite Emscripten's runtime properties.
      ...Object.fromEntries(['clamp', 'hasOwnProperty', 'calledRun', 'locateFile'].map((name) => [name, {
        symbol: 'geometry::Clamp', params: ['value', 'low', 'high'].map((name) => ({ name, type: 'f64' })), result: 'f64',
      }])),
    } },
    { name: 'rustCalc', language: 'rust', package: './native/rust-workspace/calc', exports: {
      add: { symbol: 'arithmetic::add', params: [{ name: 'value', type: 'f64' }], result: 'f64' },
    } },
    { name: 'rustPatch', language: 'rust', package: './native/rust-patch/calc', exports: {
      add: { params: [{ name: 'value', type: 'f64' }], result: 'f64' },
    } },
    { name: 'rustReplace', language: 'rust', package: './native/rust-replace/calc', exports: {
      add: { params: [{ name: 'value', type: 'f64' }], result: 'f64' },
    } },
  ],
}, null, 2));
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['check', '--config', 'wasmgen.json'], { cwd: consumer });
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['gen', '--config', 'wasmgen.json'], { cwd: consumer });
// Rebuilding must replace owned output; public module names cannot collide
// with the generator's staging or backup directories.
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['gen', '--config', 'wasmgen.json'], { cwd: consumer });
// The package API and CLI must both resolve from the installed tarball.
assert.equal(await run('node', ['--input-type=module', '-e', 'import { readConfig } from "@heojeongbo/wasmgen"; console.log((await readConfig("wasmgen.json")).input.length)'], { cwd: consumer }), '5');
assert(!(await readdir(path.join(consumer, 'native/go-module/internal/calc'))).some((entry) => entry.startsWith('.wasmgen-')), 'temporary Go wrapper must be removed');
assert.equal(await readFile(path.join(consumer, 'native/rust-workspace/Cargo.lock'), 'utf8'), rustLock, 'the original Rust lockfile must remain unchanged');
assert.deepEqual((await readdir(path.join(consumer, 'native/rust-workspace'))).sort(), ['Cargo.lock', 'Cargo.toml', 'calc', 'offset']);
assert.deepEqual(await nativeSnapshot(path.join(consumer, 'native')), nativeBefore, 'native sources, override manifests, and lockfiles must remain unchanged');
// Unsupported Cargo targets must fail without replacing a previously working build.
const previousBarrel = await readFile(path.join(root, 'generated/index.js'), 'utf8');
await mkdir(path.join(consumer, 'native/rust-binary/src'), { recursive: true });
await writeFile(path.join(consumer, 'native/rust-binary/Cargo.toml'), '[package]\nname = "binary-only"\nversion = "0.0.0"\nedition = "2021"\n');
await writeFile(path.join(consumer, 'native/rust-binary/src/main.rs'), 'fn main() {}\n');
const nativeBeforeInvalid = await nativeSnapshot(path.join(consumer, 'native'));
for (const directory of ['./native/rust-workspace', './native/rust-binary']) {
  await writeFile(path.join(consumer, 'invalid-rust.json'), JSON.stringify({ version: 1, output: './web/generated', input: [{ name: 'invalid', language: 'rust', package: directory, exports: { add: { result: 'f64' } } }] }));
  await assert.rejects(run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['gen', '--config', 'invalid-rust.json'], { cwd: consumer }), /Rust package must select a library crate/);
  assert.equal(await readFile(path.join(root, 'generated/index.js'), 'utf8'), previousBarrel);
  assert.deepEqual(await nativeSnapshot(path.join(consumer, 'native')), nativeBeforeInvalid);
}
await writeFile(path.join(root, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>wasmgen installed package</title><h1>wasmgen · installed package</h1><pre id="result">Running…</pre><script type="module" src="./main.ts"></script></html>');
await writeFile(path.join(root, 'main.ts'), `import { output as calc, previous as geometry, rustCalc, rustPatch, rustReplace } from './generated/index.js';
Object.assign(globalThis, { __wasmgenTest: { calc, geometry, rustCalc, rustPatch, rustReplace } });
async function typeContract() {
  const api = await calc();
  const value: number = await api.add(1);
  // @ts-expect-error Generated declarations reject incorrect arguments.
  await api.add('incorrect');
  api.dispose();
  const rust = await rustCalc();
  const rustValue: number = await rust.add(1);
  // @ts-expect-error Generated Rust declarations reject incorrect arguments.
  await rust.add('incorrect');
  rust.dispose();
  return value + rustValue;
}
`);
await run('node', [path.resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', path.join(root, 'main.ts')]);
await runBrowsers(root, async (page) => {
  const results = await page.evaluate(async () => {
    const { calc, geometry, rustCalc, rustPatch, rustReplace } = (globalThis as PackageGlobals).__wasmgenTest;
    const go = await calc();
    const cpp = await geometry();
    const rust = await rustCalc();
    const patched = await rustPatch();
    const replaced = await rustReplace();
    try {
      const values = { goInternalWithReplace: await go.add(35), cpp: await cpp.clamp(42, 0, 10), cppRuntimeNames: await Promise.all([cpp.hasOwnProperty(42, 0, 10), cpp.calledRun(42, 0, 10), cpp.locateFile(42, 0, 10)]), rustWorkspaceDependency: await rust.add(35), rustRootPatch: await patched.add(35), rustRootReplace: await replaced.add(35) };
      const result = document.querySelector('#result');
      if (!result) throw new Error('result element is missing');
      result.textContent = JSON.stringify(values, null, 2);
      return values;
    } finally { go.dispose(); cpp.dispose(); rust.dispose(); patched.dispose(); replaced.dispose(); }
  });
  assert.deepEqual(results, { goInternalWithReplace: 42, cpp: 10, cppRuntimeNames: [10, 10, 10], rustWorkspaceDependency: 42, rustRootPatch: 42, rustRootReplace: 84 });
  return results;
}, 'package');
await writeFile(path.join(artifacts, 'package-contents.json'), JSON.stringify(packed, null, 2) + '\n');
