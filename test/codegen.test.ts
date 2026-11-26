import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGenerator } from '../src/application/generate.js';
import type { ResolvedConfig } from '../src/model/config.js';

test('generation composes injected adapters, emits typed clients and replaces owned output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-codegen-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: ResolvedConfig = { version: 1, root, output: path.join(root, 'web'), tools: {}, input: [{
    name: 'sample', language: 'go', files: [], headers: [], include: [], exports: [
      { name: 'scale', symbol: 'Scale', params: [{ name: 'values', type: 'f64[]' }], result: 'f64[]', error: false },
      { name: 'notify', symbol: 'Notify', params: [], result: 'void', error: false },
    ],
  }] };
  const build = async (_mod: unknown, context: { directory: string }) => { await writeFile(path.join(context.directory, 'native.wasm'), Buffer.from([0,97,115,109,1,0,0,0])); return { workerSource: 'serve(async () => native, schema);' }; };
  const generate = createGenerator({ go: { language: 'go', build }, cpp: { language: 'cpp', build }, rust: { language: 'rust', build } }, async file => { assert.equal(file, 'fixture.json'); return config; });
  const progress: string[] = [];
  const result = await generate('fixture.json', { onProgress: value => progress.push(value), signal: new AbortController().signal });
  assert.deepEqual(result, { output: config.output, modules: ['sample'] });
  assert.deepEqual(progress, ['building sample (go)']);
  assert.match(await readFile(path.join(config.output, 'sample/index.d.ts'), 'utf8'), /scale\(values: number\[\]\): Promise<number\[\]>/);
  assert.match(await readFile(path.join(config.output, 'sample/index.d.ts'), 'utf8'), /notify\(\): Promise<void>/);
  assert.match(await readFile(path.join(config.output, 'sample/index.js'), 'utf8'), /client.call\("scale", args\)/);
  assert.match(await readFile(path.join(config.output, 'sample/worker.js'), 'utf8'), /"result":"f64\[\]"/);
  assert.match(await readFile(path.join(config.output, 'index.js'), 'utf8'), /create as sample/);
  await generate('fixture.json');
  assert.deepEqual(await readdir(root), ['web']);
  const controller = new AbortController();
  controller.abort(new Error('cancelled generation'));
  await assert.rejects(generate('fixture.json', { signal: controller.signal }), /cancelled generation/);
  assert.deepEqual(await readdir(root), ['web']);
});
