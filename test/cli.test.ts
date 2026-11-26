import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const execute = promisify(execFile);
const cli = path.resolve('dist/cli.js');
const invoke = (args: string[], cwd?: string) => execute(process.execPath, [cli, ...args], { cwd });

test('version flags identify the installed generator without requiring a config', async () => {
  const metadata: unknown = JSON.parse(await readFile('package.json', 'utf8'));
  assert(metadata && typeof metadata === 'object' && 'version' in metadata);
  for (const flag of ['--version', '-v']) assert.equal((await invoke([flag], os.tmpdir())).stdout.trim(), metadata.version);
});

test('help documents commands, config flags and version without compiling', async () => {
  const result = await invoke(['gen', '--help'], os.tmpdir());
  assert.match(result.stdout, /without compiling/);
  assert.match(result.stdout, /--version/);
  assert.match(result.stdout, /--config/);
  assert.equal(result.stderr, '');
});

test('config paths beginning with an option name are consumed as values', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'sample.go'), 'package sample\n');
  await writeFile(path.join(directory, '--help'), JSON.stringify({ version: 1, output: 'generated', tools: { go: 'must-not-be-invoked' }, input: [
    { name: 'sample', language: 'go', files: ['sample.go'], exports: { value: { symbol: 'Value', result: 'f64' } } },
  ] }));
  const result = await invoke(['--config=--help', 'check'], directory);
  assert.match(result.stdout, /valid: 1 module/);
  assert(!result.stdout.includes('Usage:'));
});

const invalid: Array<[string, string[], RegExp]> = [
  ['ambiguous option value', ['gen', '--config', '--help'], /ambiguous|argument|value/i],
  ['unknown command', ['geen', '--help'], /unknown command geen/],
  ['unknown option', ['gen', '--wat'], /Unknown option/],
  ['extra positional argument', ['check', 'config.yaml'], /unexpected positional/],
  ['empty config path', ['check', '--config='], /nonempty file path/],
  ['config without command', ['--config', 'config.yaml'], /requires a gen or check command/],
  ['conflicting informational flags', ['--help', '--version'], /either --help or --version/],
];
for (const [name, args, message] of invalid) {
  test(`CLI rejects ${name} with a nonzero exit and a diagnostic`, async () => {
    await assert.rejects(invoke(args), (error: unknown) => {
      assert(error instanceof Error && 'code' in error && 'stderr' in error);
      assert.equal(error.code, 1);
      assert.match(String(error.stderr), message);
      return true;
    });
  });
}

test('CLI generates through its public entrypoint and cancels running compilers on SIGINT', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-cli-gen-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compiler = fileURLToPath(new URL('./helpers/compiler.js', import.meta.url));
  await chmod(compiler, 0o755);
  await mkdir(path.join(root, 'lib/wasm'), { recursive: true });
  await writeFile(path.join(root, 'lib/wasm/wasm_exec.js'), '// runtime');
  await writeFile(path.join(root, 'LICENSE'), 'fixture license');
  await writeFile(path.join(root, 'sample.go'), 'package sample');
  await writeFile(path.join(root, 'config.json'), JSON.stringify({ version: 1, output: 'generated', tools: { go: compiler }, input: [
    { name: 'sample', language: 'go', files: ['sample.go'], exports: { Value: { result: 'f64' } } },
  ] }));
  const env = { ...process.env, WASMGEN_TEST_GOROOT: root };
  const args = [cli, 'gen', '--config', 'config.json'];
  const result = await execute(process.execPath, args, { cwd: root, env });
  assert.match(result.stdout, /generated sample/);
  assert.match(result.stderr, /building sample \(go\)/);
  const previous = await readFile(path.join(root, 'generated/.wasmgen.json'), 'utf8');
  const marker = path.join(root, 'ready');
  const running = execute(process.execPath, args, { cwd: root, env: { ...env, WASMGEN_TEST_READY_FILE: marker } });
  const outcome = running.then(() => undefined, (error: unknown) => error);
  t.after(() => { running.child.kill('SIGKILL'); });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await readdir(root)).includes('ready')) { ready = true; break; }
    await setTimeout(10);
  }
  assert(ready, 'compiler must be running before interrupt');
  running.child.kill('SIGINT');
  const failure = await outcome;
  assert(failure instanceof Error && 'stderr' in failure);
  assert.match(String(failure.stderr), /aborted|interrupted/);
  assert.equal(await readFile(path.join(root, 'generated/.wasmgen.json'), 'utf8'), previous);
  assert(!(await readdir(root)).some(file => file.startsWith('.wasmgen-') || file.endsWith('.wasmgen-lock')));
});

test('CLI check honors termination signals while config IO is pending', { skip: process.platform === 'win32', timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-cli-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = fileURLToPath(new URL('./helpers/blocked-config.js', import.meta.url));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const marker = path.join(root, signal);
    const running = execute(process.execPath, ['--experimental-test-module-mocks', helper, cli, path.join(root, 'config.json'), marker]);
    const outcome = running.then(() => undefined, (error: unknown) => error);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if ((await readdir(root)).includes(signal)) { ready = true; break; }
        await setTimeout(10);
      }
      assert(ready, 'config read must be pending before interruption');
      running.child.kill(signal);
      const failure = await Promise.race([outcome, setTimeout(2000, undefined, { ref: false })]);
      assert(failure instanceof Error && 'signal' in failure, 'check must not swallow termination and keep waiting for IO');
      assert.equal(failure.signal, signal);
    } finally {
      running.child.kill('SIGKILL');
      await outcome;
    }
  }
});
