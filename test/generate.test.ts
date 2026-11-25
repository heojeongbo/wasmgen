import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generate } from '@heojeongbo/wasmgen';
import { run } from '../src/process.js';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-output-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'source.go'), 'package sample\nfunc Value() float64 { return 1 }\n');
  const file = path.join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ version: 1, output: 'generated', tools: { go: 'wasmgen-missing-compiler' }, input: [{ name: 'sample', language: 'go', files: ['source.go'], exports: { value: { symbol: 'Value', result: 'f64' } } }] }));
  return { dir, file, output: path.join(dir, 'generated') };
}
test('failed builds preserve the previous output and release the generation lock', async (t) => {
  const { dir, file, output } = await fixture(t);
  await mkdir(output);
  await writeFile(path.join(output, 'index.js'), 'previous output');
  await writeFile(path.join(output, '.wasmgen.json'), JSON.stringify({ generator: 'wasmgen', files: ['index.js'] }));
  await assert.rejects(generate(file), (error: unknown) => {
    assert(error instanceof Error && error.cause instanceof Error);
    assert.match(error.message, /sample \(go\) build failed:.*cannot run/);
    assert.match(error.cause.message, /cannot run/);
    return true;
  });
  assert.equal(await readFile(path.join(output, 'index.js'), 'utf8'), 'previous output');
  assert.deepEqual((await readdir(dir)).sort(), ['config.json', 'generated', 'source.go']);
});
test('unmanaged files are never deleted', async (t) => {
  const { file, output } = await fixture(t);
  await mkdir(output);
  await writeFile(path.join(output, 'application.ts'), 'keep me');
  await assert.rejects(generate(file), /not owned by wasmgen/);
  assert.equal(await readFile(path.join(output, 'application.ts'), 'utf8'), 'keep me');
});
test('an unmanaged file added to a generated directory is preserved', async (t) => {
  const { file, output } = await fixture(t);
  await mkdir(output);
  await writeFile(path.join(output, '.wasmgen.json'), JSON.stringify({ generator: 'wasmgen', files: [] }));
  await writeFile(path.join(output, 'notes.txt'), 'keep me');
  await assert.rejects(generate(file), /unmanaged output file/);
});
test('a concurrent generation lock is preserved', async (t) => {
  const { file, output } = await fixture(t);
  await mkdir(output + '.wasmgen-lock');
  await assert.rejects(generate(file), /another generation owns/);
  assert.deepEqual(await readdir(output + '.wasmgen-lock'), []);
});
test('output symlinks cannot redirect replacement', async (t) => {
  const { dir, file, output } = await fixture(t);
  const target = path.join(dir, 'private');
  await mkdir(target);
  await symlink(target, output);
  await assert.rejects(generate(file), /real directory/);
});
test('tool arguments are not interpreted by a shell', async () => {
  const value = 'space `command` $(command) ; false';
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]), value);
});
