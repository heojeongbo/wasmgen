import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as processes from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

class Child extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined = 123456;
  signals: Array<NodeJS.Signals | undefined> = [];
  kill(signal?: NodeJS.Signals) { this.signals.push(signal); return true; }
}
let child: Child;
mock.module('node:child_process', { namedExports: { ...processes, spawn: () => child } });
const { run } = await import('../src/process.js');

test('group signalling falls back to the child for permission errors and absent process IDs', async (t) => {
  const kills = t.mock.method(process, 'kill', () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
  for (const pid of [123456, undefined]) {
    child = new Child(); child.pid = pid;
    const controller = new AbortController();
    const pending = assert.rejects(run('compiler', [], { signal: controller.signal }), /compilation aborted/);
    controller.abort(new Error('cancelled'));
    child.emit('close', null, 'SIGTERM');
    await pending;
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  }
  assert.equal(kills.mock.callCount(), 2);
});

test('simultaneous output overflow and cancellation preserve the first failure and stop once', async (t) => {
  t.mock.method(process, 'kill', () => true);
  child = new Child(); child.pid = undefined;
  const controller = new AbortController();
  const pending = assert.rejects(run('compiler', [], { signal: controller.signal }), /stdout exceeded/);
  child.stdout.write('x'.repeat(32 * 1024 * 1024 + 1));
  controller.abort();
  child.stdout.write('late output');
  child.emit('close', null, 'SIGTERM');
  await pending;
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('changing caller options cannot detach cancellation cleanup from the original signal', async (t) => {
  child = new Child();
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, 'removeEventListener');
  const options: { signal?: AbortSignal } = { signal: controller.signal };
  const pending = run('compiler', [], options);
  delete options.signal;
  child.stdout.write('complete');
  child.emit('close', 0, null);
  assert.equal(await pending, 'complete');
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0]?.arguments[0], 'abort');
});
