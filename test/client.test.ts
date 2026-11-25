import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, type WorkerPort } from '../src/runtime/client.js';

class WorkerStub implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  onerror: WorkerPort['onerror'] = null;
  terminated = false;
  terminate() { this.terminated = true; }
  postMessage() {}
  receive(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
}

test('native initialization failure rejects the factory and terminates its worker', async () => {
  const worker = new WorkerStub();
  const connection = connect(() => worker);
  worker.receive({ type: 'fatal', error: 'cannot load Wasm: HTTP 404' });
  await assert.rejects(connection, /HTTP 404/);
  assert(worker.terminated);
});

test('a silent worker cannot leave initialization pending indefinitely', async () => {
  const worker = new WorkerStub();
  await assert.rejects(connect(() => worker, { timeoutMs: 10 }), /initialization timed out/);
  assert(worker.terminated);
});

test('a worker crash rejects all outstanding calls and closes the instance', async () => {
  const worker = new WorkerStub();
  const connection = connect(() => worker);
  worker.receive({ type: 'ready' });
  const client = await connection;
  const first = assert.rejects(client.call('first', []), /native failure/);
  const second = assert.rejects(client.call('second', []), /native failure/);
  worker.receive({ type: 'fatal', error: 'native failure' });
  await Promise.all([first, second]);
  assert(worker.terminated);
  await assert.rejects(client.call('later', []), /disposed/);
});

test('an undecodable worker response rejects pending work and releases the worker', async () => {
  const worker = new WorkerStub();
  const connection = connect(() => worker);
  worker.receive({ type: 'ready' });
  const client = await connection;
  const pending = assert.rejects(client.call('value', []), /could not be decoded/);
  worker.onmessageerror?.();
  await pending;
  assert(worker.terminated);
});
