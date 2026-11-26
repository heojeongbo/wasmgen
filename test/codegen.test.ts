import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGenerator, type GenerateOptions } from '../src/application/generate.js';
import type { ResolvedConfig } from '../src/model/config.js';
import type { LanguageCompiler } from '../src/ports/language.js';

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

async function cancellationFixture(t: test.TestContext, build: LanguageCompiler['build'], read = async () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-generation-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: ResolvedConfig = { version: 1, root, output: path.join(root, 'generated'), tools: {}, input: [{
    name: 'sample', language: 'go', files: [], headers: [], include: [],
    exports: [{ name: 'value', symbol: 'Value', params: [], result: 'f64', error: false }],
  }] };
  const generate = createGenerator({ go: { language: 'go', build }, cpp: { language: 'cpp', build }, rust: { language: 'rust', build } }, async () => { await read(); return config; });
  return { root, generate };
}

test('pre-aborted generation does not read config or start a build', async (t) => {
  let reads = 0;
  let builds = 0;
  const { root, generate } = await cancellationFixture(t,
    async () => { builds++; return { workerSource: '' }; },
    async () => { reads++; },
  );
  const controller = new AbortController();
  const reason = new Error('already cancelled');
  controller.abort(reason);
  await assert.rejects(generate('fixture.json', { signal: controller.signal }), error => error === reason);
  assert.equal(reads, 0);
  assert.equal(builds, 0);
  assert.deepEqual(await readdir(root), []);
});

test('caller mutations during config loading do not replace generation options', async (t) => {
  for (const cancelOriginal of [false, true]) {
    const original = new AbortController();
    const replacement = new AbortController();
    const progress: string[] = [];
    let builds = 0;
    const { root, generate } = await cancellationFixture(t, async (_input, context) => {
      builds++;
      assert.equal(context.signal, original.signal);
      return { workerSource: '' };
    });
    const options: GenerateOptions = { signal: original.signal, onProgress(message) { assert.equal(this, options); progress.push(message); } };
    const pending = generate('fixture.json', options);
    options.signal = replacement.signal;
    options.onProgress = () => { throw new Error('replacement progress must not run'); };
    replacement.abort(new Error('unrelated cancellation'));
    if (cancelOriginal) {
      const reason = new Error('cancelled while reading config');
      original.abort(reason);
      await assert.rejects(pending, error => error === reason);
      assert.equal(builds, 0);
      assert.deepEqual(progress, []);
      assert.deepEqual(await readdir(root), []);
    } else {
      await pending;
      assert.equal(builds, 1);
      assert.deepEqual(progress, ['building sample (go)']);
      assert.deepEqual(await readdir(root), ['generated']);
    }
  }
});

test('cancelling from progress stops before invoking an adapter even after options mutation', async (t) => {
  let builds = 0;
  const { root, generate } = await cancellationFixture(t, async () => { builds++; return { workerSource: '' }; });
  const controller = new AbortController();
  const reason = new Error('cancelled from progress');
  const options: GenerateOptions = { signal: controller.signal, onProgress: () => {
    delete options.signal;
    controller.abort(reason);
  } };
  await assert.rejects(generate('fixture.json', options), error => error === reason);
  assert.equal(builds, 0);
  assert.deepEqual(await readdir(root), []);
});
