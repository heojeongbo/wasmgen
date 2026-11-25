import assert from 'node:assert/strict';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../../src/process.js';
import { runBrowsers } from './browser.js';

const artifacts = path.resolve('.artifacts');
await mkdir(artifacts, { recursive: true });
const tarball = path.join(artifacts, 'wasmgen-test.tgz');
await run('pnpm', ['pack', '--out', tarball]);
// Inspect the archive itself: lifecycle output is not a stable JSON channel.
const packed = { filename: tarball, files: (await run('tar', ['-tzf', tarball])).split('\n').filter((file) => !file.endsWith('/')).map((file) => ({ path: file.replace(/^package\//, '') })) };
for (const { path: file } of packed.files) {
  assert(file.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(file), `unexpected public package file: ${file}`);
}
assert(packed.files.some((file) => file.path === 'README.md'), 'package must include usage documentation');
const consumer = path.resolve('.test-output/consumer');
await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'wasmgen-consumer', private: true, type: 'module', packageManager: 'pnpm@10.11.0' }));
await run('pnpm', ['add', '--save-dev', '--ignore-scripts', '--registry=https://registry.npmjs.org', path.resolve(artifacts, packed.filename)], { cwd: consumer });
await cp('test/fixtures', path.join(consumer, 'native'), { recursive: true });
await cp('examples/cpp', path.join(consumer, 'native/cpp'), { recursive: true });
const root = path.join(consumer, 'web');
await mkdir(root);
await writeFile(path.join(consumer, 'wasmgen.json'), JSON.stringify({
  version: 1, output: './web/generated', input: [
    { name: 'output', language: 'go', package: './native/go-module/internal/calc', exports: {
      add: { symbol: 'Add', params: [{ name: 'value', type: 'f64' }], result: 'f64' },
    } },
    { name: 'previous', language: 'cpp', files: ['./native/cpp/geometry.cc'], headers: ['./native/cpp/geometry.h'], exports: {
      clamp: { symbol: 'geometry::Clamp', params: ['value', 'low', 'high'].map((name) => ({ name, type: 'f64' })), result: 'f64' },
    } },
  ],
}, null, 2));
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['check', '--config', 'wasmgen.json'], { cwd: consumer });
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['gen', '--config', 'wasmgen.json'], { cwd: consumer });
// Rebuilding must replace owned output; public module names cannot collide
// with the generator's staging or backup directories.
await run(path.join(consumer, 'node_modules/.bin/wasmgen'), ['gen', '--config', 'wasmgen.json'], { cwd: consumer });
// The package API and CLI must both resolve from the installed tarball.
assert.equal(await run('node', ['--input-type=module', '-e', 'import { readConfig } from "@heojeongbo/wasmgen"; console.log((await readConfig("wasmgen.json")).input.length)'], { cwd: consumer }), '2');
assert(!(await readdir(path.join(consumer, 'native/go-module/internal/calc'))).some((entry) => entry.startsWith('.wasmgen-')), 'temporary Go wrapper must be removed');
await writeFile(path.join(root, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>wasmgen installed package</title><h1>wasmgen · installed package</h1><pre id="result">Running…</pre><script type="module" src="./main.ts"></script></html>');
await writeFile(path.join(root, 'main.ts'), `import { output as calc, previous as geometry } from './generated/index.js';
Object.assign(globalThis, { __wasmgenTest: { calc, geometry } });
async function typeContract() {
  const api = await calc();
  const value: number = await api.add(1);
  // @ts-expect-error Generated declarations reject incorrect arguments.
  await api.add('incorrect');
  api.dispose();
  return value;
}
`);
await run('node', [path.resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', path.join(root, 'main.ts')]);
await runBrowsers(root, async (page) => {
  const results = await page.evaluate(async () => {
    const { calc, geometry } = (globalThis as typeof globalThis & { __wasmgenTest: { calc: () => Promise<{ add(value: number): Promise<number>; dispose(): void }>; geometry: () => Promise<{ clamp(value: number, low: number, high: number): Promise<number>; dispose(): void }> } }).__wasmgenTest;
    const go = await calc();
    const cpp = await geometry();
    try {
      const values = { goInternalWithReplace: await go.add(35), cpp: await cpp.clamp(42, 0, 10) };
      const result = document.querySelector('#result');
      if (!result) throw new Error('result element is missing');
      result.textContent = JSON.stringify(values, null, 2);
      return values;
    } finally { go.dispose(); cpp.dispose(); }
  });
  assert.deepEqual(results, { goInternalWithReplace: 42, cpp: 10 });
  return results;
}, 'package');
await writeFile(path.join(artifacts, 'package-contents.json'), JSON.stringify(packed, null, 2) + '\n');
