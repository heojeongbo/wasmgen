import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { run } from '../src/process.js';
import { hasCode } from '../src/shared/errors.js';

const fixture = fileURLToPath(new URL('./helpers/process-child.js', import.meta.url));

test('compiler stdout preserves UTF-8 sequences split across stream chunks', async () => {
  assert.equal(await run(process.execPath, [fixture, 'unicode-stdout']), '경로 🦀');
});

test('compiler stderr preserves UTF-8 sequences in failure diagnostics', async () => {
  await assert.rejects(run(process.execPath, [fixture, 'unicode-stderr']), /경로 🦀/);
});

test('large compiler metadata is returned completely, not truncated into invalid JSON', async () => {
  const output = await run(process.execPath, [fixture, 'large-json']);
  const expected = JSON.stringify({ metadata: 'x'.repeat(3_000_000) });
  assert.equal(output.length, expected.length);
  assert.equal(output, expected);
});

test('tool-reported paths retain significant whitespace before the newline', async () => {
  assert.equal(await run(process.execPath, [fixture, 'path-with-space']), '/tmp/toolchain directory ');
});

test('compiler failures retain stdout when stderr is empty', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("failure on stdout");process.exitCode=7']), /exited with 7\nfailure on stdout/);
});

test('excessive compiler stdout fails explicitly instead of returning partial data', async () => {
  await assert.rejects(run(process.execPath, [fixture, 'overflow']), /stdout exceeded/);
});

test('an already aborted compiler call rejects before attempting to spawn', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled before compilation');
  controller.abort(reason);
  await assert.rejects(run('wasmgen-nonexistent-tool', [], { signal: controller.signal }), (error: unknown) => error === reason);
});

for (const scenario of ['spawn-descendant', 'ignore-termination']) {
  test(`cancellation cleans up a compiler that uses ${scenario}`, { skip: process.platform === 'win32', timeout: 10_000 }, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-process-'));
    const marker = path.join(directory, 'orphan.txt');
    const ready = path.join(directory, 'ready');
    const controller = new AbortController();
    const result = run(process.execPath, [fixture, scenario, marker, ready], { signal: controller.signal }).then(() => undefined, (error: unknown) => error);
    let pid: number | undefined;
    t.after(async () => {
      controller.abort();
      if (pid) {
        try { process.kill(pid, 'SIGKILL'); }
        catch (error) { if (!hasCode(error, 'ESRCH')) throw error; }
      }
      await result;
      await rm(directory, { recursive: true, force: true });
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      try { pid = Number(await readFile(ready, 'utf8')); break; }
      catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
      await setTimeout(10);
    }
    assert(pid && Number.isInteger(pid), 'compiler fixture must start before cancellation');
    controller.abort();
    const outcome = await Promise.race([result, setTimeout(2500, 'still running', { ref: false })]);
    assert(outcome instanceof Error, 'cancellation must finish even if SIGTERM is ignored');
    await setTimeout(500);
    await assert.rejects(stat(marker), (error: unknown) => hasCode(error, 'ENOENT'));
  });
}
