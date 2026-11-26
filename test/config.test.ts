import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig as validate } from '../src/config.js';
import { readConfig } from '../src/index.js';
import { languages } from '../src/languages.js';

const validateConfig = (value: unknown, file: string) => validate(value, file, languages);

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
  ['C++ package input', withInput({ language: 'cpp', package: './native' }), /package is only valid/],
  ['C++ error option', withInput({ language: 'cpp', headers: ['a.h'], exports: { value: { result: 'void', error: false } } }), /error is only valid/],
  ['Go test file', withInput({ files: ['math_test.go'] }), /non-test .go/],
  ['Go wrong file extension', withInput({ files: ['math.cc'] }), /non-test .go/],
  ['Go include directories', withInput({ include: ['native'] }), /only for C\+\+/],
  ['Rust without a crate root', withInput({ language: 'rust', files: undefined }), /exactly one/],
  ['Rust with multiple crate roots', withInput({ language: 'rust', files: ['lib.rs', 'other.rs'] }), /exactly one .rs/],
  ['Rust with a non-Rust input', withInput({ language: 'rust' }), /exactly one .rs/],
  ['Rust with C++ headers', withInput({ language: 'rust', files: ['lib.rs'], headers: ['api.h'] }), /only for C\+\+/],
  ['Rust with package and files', withInput({ language: 'rust', files: ['lib.rs'], package: 'crate' }), /exactly one/],
  ['code in Rust symbol', withInput({ language: 'rust', files: ['lib.rs'], exports: { add: { symbol: 'value(); panic!()', result: 'void' } } }), /invalid rust symbol/],
];
for (const [name, config, message] of cases) {
  test(`rejects ${name} before invoking a compiler`, () => {
    assert.throws(() => validateConfig(config, '/project/wasmgen.yaml'), message);
  });
}

test('Rust packages support qualified symbols, fallible results and separate tool overrides', () => {
  const config = validateConfig({ ...withInput({ language: 'rust', files: undefined, package: './crate', exports: { add: { symbol: 'math::add', result: 'f64', error: true } } }), tools: { cargo: '/tools/cargo', wasmBindgen: '/tools/wasm-bindgen' } }, '/project/wasmgen.yaml');
  assert.equal(config.input[0]?.package, '/project/crate');
  assert.equal(config.input[0]?.exports[0]?.error, true);
  assert.equal(config.tools.cargo, '/tools/cargo');
});

test('package and header-only inputs resolve default symbols and verify directory kinds', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-config-kinds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  await mkdir(path.join(dir, 'native'));
  await writeFile(path.join(dir, 'native/api.h'), '// header');
  for (const input of [
    { name: 'native', language: 'go', package: 'native', exports: { Value: { result: 'f64' } } },
    { name: 'native', language: 'cpp', headers: ['native/api.h'], include: ['native'], exports: { value: { result: 'f64' } } },
  ]) {
    await writeFile(file, JSON.stringify({ version: 1, output: 'generated', input: [input] }));
    const config = await readConfig(file);
    assert.equal(config.input[0]?.exports[0]?.symbol, Object.keys(input.exports)[0]);
  }
  await writeFile(file, JSON.stringify({ version: 1, output: 'generated', input: [{ name: 'native', language: 'go', package: 'native/api.h', exports: { Value: { result: 'f64' } } }] }));
  await assert.rejects(readConfig(file), /input is not a directory/);
});

test('filesystem access and symlink-loop errors retain their original diagnostics', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-config-loop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  await symlink('loop.go', path.join(dir, 'loop.go'));
  await writeFile(file, JSON.stringify(withInput({ files: ['loop.go'] })));
  await assert.rejects(readConfig(file), /cannot access.*ELOOP/);
  await writeFile(path.join(dir, 'math.go'), 'package sample');
  await symlink('loop', path.join(dir, 'loop'));
  await writeFile(file, JSON.stringify({ ...valid(), output: 'loop/output' }));
  await assert.rejects(readConfig(file), /ELOOP/);
});

test('YAML duplicate keys fail instead of silently replacing configuration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-config-'));
  try {
    const file = path.join(dir, 'config.yaml');
    await writeFile(file, 'version: 1\nversion: 2\n');
    await assert.rejects(readConfig(file), /invalid config/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const redirect of ['input', 'output-parent', 'config'] as const) {
  test(`rejects output containing an input through a ${redirect} symlink`, async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-path-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = path.join(dir, 'generated');
    await mkdir(output);
    await writeFile(path.join(output, 'source.go'), 'package sample\nfunc Value() float64 { return 1 }\n');
    let source = './generated/source.go';
    let destination = './generated';
    let configFile = path.join(dir, 'config.json');
    if (redirect === 'input') {
      await symlink(path.join(output, 'source.go'), path.join(dir, 'source.go'));
      source = './source.go';
    } else if (redirect === 'output-parent') {
      await symlink(dir, path.join(dir, 'alias'), 'dir');
      destination = './alias/generated';
    } else {
      await writeFile(path.join(dir, 'source.go'), 'package sample\n');
      source = './source.go';
      configFile = path.join(output, 'config.json');
      await symlink(configFile, path.join(dir, 'config.json'));
    }
    await writeFile(configFile, JSON.stringify({ ...valid(), output: destination, input: [{ ...valid().input[0], files: [source] }] }));
    await assert.rejects(readConfig(path.join(dir, 'config.json')), /must not contain input/);
  });
}

test('accepts an output beneath a symlinked parent when inputs stay outside it', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-path-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'web'));
  await symlink(path.join(dir, 'web'), path.join(dir, 'alias'), 'dir');
  await writeFile(path.join(dir, 'math.go'), 'package sample\n');
  const file = path.join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ ...valid(), output: './alias/nested/generated' }));
  assert.equal((await readConfig(file)).output, path.join(dir, 'alias/nested/generated'));
});

test('schema diagnostics identify the config file, field and invalid record-key reason', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-diagnostic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.json');
  await writeFile(file, JSON.stringify(withInput({ exports: { dispose: { result: 'void' } } })));
  await assert.rejects(readConfig(file), (error: unknown) => {
    assert(error instanceof Error && error.cause instanceof Error);
    assert(error.message.startsWith(file + ':'));
    assert.match(error.message, /input\[0\]\.exports\.dispose/);
    assert.match(error.message, /non-reserved JavaScript identifier/);
    return true;
  });
});

test('missing input diagnostics identify the config, module and field and preserve the filesystem cause', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-diagnostic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.json');
  await writeFile(file, JSON.stringify(valid()));
  await assert.rejects(readConfig(file), (error: unknown) => {
    assert(error instanceof Error && error.cause instanceof Error);
    assert(error.message.startsWith(file + ':'));
    assert.match(error.message, /math\.files\[0\]: file not found/);
    const original = error.cause.cause;
    assert(original instanceof Error && 'code' in original && original.code === 'ENOENT');
    return true;
  });
});

test('wrong input kinds identify the offending header field', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-diagnostic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'headers'));
  const file = path.join(directory, 'config.json');
  await writeFile(file, JSON.stringify(withInput({ language: 'cpp', files: undefined, headers: ['headers'] })));
  await assert.rejects(readConfig(file), /math\.headers\[0\]: input is not a file/);
});
