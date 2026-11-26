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

test('invalid timeouts and aborted signals never create a Worker', async () => {
  const factory = () => { throw new Error('must not create Worker'); };
  for (const timeoutMs of [0, -1, Infinity, NaN, 2147483648]) await assert.rejects(connect(factory, { timeoutMs }), /timeoutMs/);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(connect(factory, { signal: controller.signal }), /cancelled/);
  Object.defineProperty(controller.signal, 'reason', { value: undefined });
  await assert.rejects(connect(factory, { signal: controller.signal }), /wasmgen aborted/);
  await assert.rejects(connect(factory), /must not create Worker/);
});

test('client settles replies once and disposal rejects queued work', async () => {
  const worker = new WorkerStub();
  const connection = connect(() => worker);
  worker.receive({ type: 'ready' });
  worker.receive({ type: 'ready' });
  const client = await connection;
  const first = client.call('value', []);
  worker.receive({ type: 'result', id: 1, ok: true, value: 42 });
  assert.equal(await first, 42);
  worker.receive({ type: 'result', id: 1, ok: true, value: 99 });
  const second = assert.rejects(client.call('value', []), /recoverable/);
  worker.receive({ type: 'result', id: 2, ok: false, error: 'recoverable' });
  await second;
  const pending = assert.rejects(client.call('value', []), /disposed/);
  client.dispose(); client.dispose();
  worker.receive({ type: 'ready' });
  await pending;
  assert(worker.terminated);
});

test('posting an uncloneable argument rejects just that call', async () => {
  const worker = new WorkerStub();
  worker.postMessage = () => { throw new DOMException('cannot clone', 'DataCloneError'); };
  const connection = connect(() => worker);
  worker.receive({ type: 'ready' });
  const client = await connection;
  await assert.rejects(client.call('value', [() => {}]), /cannot clone/);
  assert.equal(worker.terminated, false);
  client.dispose();
});

test('call deadlines terminate all pending work', async () => {
  const worker = new WorkerStub();
  const connection = connect(() => worker, { timeoutMs: 10 });
  worker.receive({ type: 'ready' });
  const client = await connection;
  await assert.rejects(client.call('slow', []), /call slow timed out/);
  assert(worker.terminated);
});

test('aborting after initialization terminates the instance, including signals without reasons', async () => {
  for (const legacy of [false, true]) {
    const worker = new WorkerStub();
    const controller = new AbortController();
    if (legacy) Object.defineProperty(controller.signal, 'reason', { value: undefined });
    const connection = connect(() => worker, { signal: controller.signal });
    worker.receive({ type: 'ready' });
    const client = await connection;
    const pending = assert.rejects(client.call('value', []), legacy ? /wasmgen aborted/ : /cancelled/);
    controller.abort(new Error('cancelled'));
    await pending;
    assert(worker.terminated);
  }
});

test('invalid messages and Worker errors fail initialization deterministically', async () => {
  for (const payload of [null, { type: 'other' }]) {
    const worker = new WorkerStub();
    const connection = connect(() => worker);
    worker.receive(payload);
    await assert.rejects(connection, /invalid worker response/);
    assert(worker.terminated);
  }
  for (const message of ['script load failed', '']) {
    const worker = new WorkerStub();
    const connection = connect(() => worker);
    const event = Object.assign(new Event('error', { cancelable: true }), { message }) as ErrorEvent;
    worker.onerror?.(event);
    await assert.rejects(connection, message ? /script load failed/ : /worker failed/);
    assert(event.defaultPrevented);
    assert(worker.terminated);
  }
});
