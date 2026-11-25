import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig, readConfig } from '../src/config.js';

const valid = () => ({ version: 1, output: './web/generated', input: [{ name: 'math', language: 'go', files: ['./math.go'], exports: { add: { symbol: 'Add', params: [{ name: 'a', type: 'f64' }], result: 'f64' } } }] });

test('resolves inputs and output relative to the config, independently of cwd', () => {
  const config = validateConfig(valid(), '/project/tools/wasmgen.yaml');
  assert.equal(config.input[0]?.files[0], '/project/tools/math.go');
  assert.equal(config.output, '/project/tools/web/generated');
});

const withInput = (changes: Record<string, unknown>) => ({ ...valid(), input: [{ ...valid().input[0], ...changes }] });
const withFunction = (changes: Record<string, unknown>) => withInput({ exports: { add: { symbol: 'Add', params: [{ name: 'a', type: 'f64' }], result: 'f64', ...changes } } });
const cases: Array<[string, unknown, RegExp]> = [
  ['format version', { ...valid(), version: 2 }, /expected 1/],
  ['unknown setting', { ...valid(), out: 'typo' }, /out/],
  ['unsupported type', withFunction({ result: 'int64' }), /Invalid option/],
  ['duplicate modules', { ...valid(), input: [...valid().input, ...valid().input] }, /duplicate module/],
  ['reserved export', withInput({ exports: { dispose: { symbol: 'Dispose', result: 'void' } } }), /Invalid key/],
  ['thenable export', withInput({ exports: { then: { symbol: 'Then', result: 'void' } } }), /Invalid key/],
  ['thenable module', withInput({ name: 'then' }), /Promise assimilation/],
  ['duplicate parameters', withFunction({ params: [{ name: 'a', type: 'f64' }, { name: 'a', type: 'f64' }] }), /duplicate parameter/],
  ['code in symbol', withFunction({ symbol: 'Add();panic(1)' }), /invalid go symbol/],
  ['output contains input', { ...valid(), output: '.' }, /must not contain input/],
  ['package and files', withInput({ package: '.' }), /exactly one/],
  ['duplicate Go basenames', withInput({ files: ['./math.go', './other/math.go'] }), /duplicate Go basenames/],
  ['C++ missing declarations', withInput({ language: 'cpp' }), /requires declarations/],
];
for (const [name, config, message] of cases) {
  test(`rejects ${name} before invoking a compiler`, () => {
    assert.throws(() => validateConfig(config, '/project/wasmgen.yaml'), message);
  });
}

test('YAML duplicate keys fail instead of silently replacing configuration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-config-'));
  try {
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'version: 1\nversion: 2\n');
    await assert.rejects(readConfig(file), /invalid config/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
