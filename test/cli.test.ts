import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

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
