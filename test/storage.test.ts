import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let rename: typeof fs.rename = fs.rename;
let mkdir: typeof fs.mkdir = fs.mkdir;
let lstat: typeof fs.lstat = fs.lstat;
let rm: typeof fs.rm = fs.rm;
mock.module('node:fs/promises', { namedExports: { ...fs,
  rename: (...args: Parameters<typeof fs.rename>) => rename(...args),
  mkdir: (...args: Parameters<typeof fs.mkdir>) => mkdir(...args),
  lstat: (...args: Parameters<typeof fs.lstat>) => lstat(...args),
  rm: (...args: Parameters<typeof fs.rm>) => rm(...args),
} });
const { withOutput, filesIn } = await import('../src/storage/output.js');

async function fixture(t: TestContext, owned = true) {
  rename = fs.rename; mkdir = fs.mkdir; lstat = fs.lstat; rm = fs.rm;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wasmgen-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'generated');
  if (owned) {
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'old.js'), 'previous');
    await fs.writeFile(path.join(output, '.wasmgen.json'), JSON.stringify({ generator: 'wasmgen', files: ['old.js'] }));
  }
  return { root, output };
}
const error = Object.assign(new Error('access denied'), { code: 'EACCES' });
const build = async (_stage: string, result: string) => { await fs.mkdir(path.join(result, 'nested')); await fs.writeFile(path.join(result, 'nested/new.js'), 'next'); };

test('output transactions commit new and empty directories with complete ownership manifests', async (t) => {
  for (const empty of [true, false]) {
    const { root, output } = await fixture(t, false);
    if (empty) await fs.mkdir(output);
    await withOutput(output, build);
    assert.equal(await fs.readFile(path.join(output, 'nested/new.js'), 'utf8'), 'next');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, '.wasmgen.json'), 'utf8')).files, ['nested/new.js']);
    assert.deepEqual(await fs.readdir(root), ['generated']);
  }
});

test('failed commits restore existing output or remove staging for a new output', async (t) => {
  for (const owned of [true, false]) {
    const { root, output } = await fixture(t, owned);
    rename = async (from, to) => { if (String(from).endsWith('/output')) throw error; await fs.rename(from, to); };
    await assert.rejects(withOutput(output, build), cause => cause === error);
    assert.deepEqual(await fs.readdir(root), owned ? ['generated'] : []);
    if (owned) assert.equal(await fs.readFile(path.join(output, 'old.js'), 'utf8'), 'previous');
  }
});

test('failed rollback preserves the only recoverable copy and exposes both causes', async (t) => {
  const { root, output } = await fixture(t);
  const restore = new Error('restore failed');
  rename = async (from, to) => {
    if (String(from).endsWith('/output')) throw error;
    if (String(from).endsWith('/previous')) throw restore;
    await fs.rename(from, to);
  };
  await assert.rejects(withOutput(output, build), failure => {
    assert(failure instanceof AggregateError);
    assert.deepEqual(failure.errors, [error, restore]);
    assert.equal(failure.cause, error);
    assert.match(failure.message, /preserved at/);
    return true;
  });
  const entries = await fs.readdir(root);
  assert.equal(entries.length, 1);
  assert.equal(await fs.readFile(path.join(root, entries[0]!, 'previous/old.js'), 'utf8'), 'previous');
});

test('output permissions and concurrent edits fail without deleting user data', async (t) => {
  const { root, output } = await fixture(t);
  mkdir = (async (...args: Parameters<typeof fs.mkdir>) => { if (String(args[0]).endsWith('.wasmgen-lock')) throw error; return fs.mkdir(...args); }) as typeof fs.mkdir;
  await assert.rejects(withOutput(output, build), failure => failure === error);
  mkdir = fs.mkdir;
  lstat = (async () => { throw error; }) as typeof fs.lstat;
  await assert.rejects(withOutput(output, build), failure => failure === error);
  lstat = fs.lstat;
  await assert.rejects(withOutput(output, async (stage, result) => { await build(stage, result); await fs.writeFile(path.join(output, 'notes.txt'), 'keep'); }), /unmanaged/);
  assert.equal(await fs.readFile(path.join(output, 'notes.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(root), ['generated']);
});

test('staging cleanup errors still release the generation lock', async (t) => {
  const { root, output } = await fixture(t);
  rm = async (file, options) => { if (path.basename(String(file)).startsWith('.wasmgen-stage-')) throw error; await fs.rm(file, options); };
  await assert.rejects(withOutput(output, build), failure => failure === error);
  assert.equal(await fs.readFile(path.join(output, 'nested/new.js'), 'utf8'), 'next');
  assert(!(await fs.readdir(root)).includes('generated.wasmgen-lock'));
});

test('cleanup failures retain the build failure and attempt both cleanup operations', async (t) => {
  const { root, output } = await fixture(t);
  const primary = new Error('compiler failed');
  const stagingError = new Error('cannot clean staging');
  const lockError = new Error('cannot release lock');
  const cleaned: string[] = [];
  rm = async file => {
    cleaned.push(String(file));
    throw String(file).endsWith('.wasmgen-lock') ? lockError : stagingError;
  };
  await assert.rejects(withOutput(output, async () => { throw primary; }), failure => {
    assert(failure instanceof AggregateError);
    assert.deepEqual(failure.errors, [primary, stagingError, lockError]);
    assert.equal(failure.cause, primary);
    assert.match(failure.message, /compiler failed/);
    assert.match(failure.message, /cannot release lock/);
    return true;
  });
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[1], output + '.wasmgen-lock');
  assert.equal(await fs.readFile(path.join(output, 'old.js'), 'utf8'), 'previous');
  assert((await fs.readdir(root)).includes('generated.wasmgen-lock'));
});

test('lock cleanup cannot hide the recovery path after a failed rollback', async (t) => {
  const { root, output } = await fixture(t);
  const restore = new Error('restore failed');
  rename = async (from, to) => {
    if (String(from).endsWith('/output')) throw error;
    if (String(from).endsWith('/previous')) throw restore;
    await fs.rename(from, to);
  };
  rm = async () => { throw new Error('lock cleanup failed'); };
  await assert.rejects(withOutput(output, build), failure => {
    assert(failure instanceof AggregateError);
    assert.match(failure.message, /cannot restore previous output; preserved at/);
    assert.match(failure.message, /lock cleanup failed/);
    const rollback: unknown = failure.errors[0];
    assert(rollback instanceof AggregateError);
    assert.deepEqual(rollback.errors, [error, restore]);
    return true;
  });
  const stage = (await fs.readdir(root)).find(entry => entry.startsWith('.wasmgen-stage-'))!;
  assert.equal(await fs.readFile(path.join(root, stage, 'previous/old.js'), 'utf8'), 'previous');
});

test('output inventory rejects symbolic links without following their targets', async (t) => {
  const { root, output } = await fixture(t);
  await fs.symlink(root, path.join(output, 'redirect'));
  await assert.rejects(filesIn(output), /symbolic link: redirect/);
});

test('cancellation before commit preserves the previous output', async (t) => {
  const { root, output } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(withOutput(output, async (stage, result) => {
    await build(stage, result);
    controller.abort(new Error('cancelled before commit'));
  }, controller.signal), /cancelled before commit/);
  assert.equal(await fs.readFile(path.join(output, 'old.js'), 'utf8'), 'previous');
  assert.deepEqual(await fs.readdir(root), ['generated']);
});

test('cancellation during final output inspection or backup cannot publish the staged build', async (t) => {
  for (const phase of ['inspection', 'backup']) {
    const { root, output } = await fixture(t);
    const controller = new AbortController();
    const reason = new Error(`cancelled during ${phase}`);
    let inspections = 0;
    lstat = (async (...args: Parameters<typeof fs.lstat>) => {
      if (++inspections === 2 && phase === 'inspection') controller.abort(reason);
      return fs.lstat(...args);
    }) as typeof fs.lstat;
    const renamed: string[] = [];
    rename = async (from, to) => {
      renamed.push(String(from));
      await fs.rename(from, to);
      if (String(from) === output && phase === 'backup') controller.abort(reason);
    };
    await assert.rejects(withOutput(output, build, controller.signal), failure => failure === reason);
    assert.equal(await fs.readFile(path.join(output, 'old.js'), 'utf8'), 'previous');
    assert.deepEqual(await fs.readdir(root), ['generated']);
    assert.equal(renamed.length, phase === 'inspection' ? 0 : 2);
    assert(!renamed.some(file => file.endsWith('/output')));
  }
});
