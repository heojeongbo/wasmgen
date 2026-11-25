import test from 'node:test';
import assert from 'node:assert/strict';
import { serve, type WorkerScope } from '../src/runtime/worker.js';
import type { NativeCall, WorkerResponse } from '../src/runtime/protocol.js';

async function fixture(call: NativeCall) {
  const messages: WorkerResponse[] = [];
  const scope: WorkerScope = { onmessage: null, postMessage(message) { messages.push(message); } };
  await serve(async () => call, { value: { params: [], result: 'f64' } }, scope);
  return { scope, messages, send: (id: number) => scope.onmessage?.(new MessageEvent('message', { data: { id, method: 'value', args: [] } })) };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('async native calls finish in order without overlapping a later call', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const { send, messages } = await fixture(async () => {
    const value = ++calls;
    if (value === 1) await gate;
    return { ok: true, value };
  });
  send(1); send(2);
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(messages, [{ type: 'ready' }]);
  assert(release); release();
  await tick();
  assert.deepEqual(messages.slice(1), [
    { type: 'result', id: 1, ok: true, value: 1 },
    { type: 'result', id: 2, ok: true, value: 2 },
  ]);
});

test('a rejected native Promise rejects its call and allows the next queued call', async () => {
  let calls = 0;
  const { send, messages } = await fixture(async () => {
    if (++calls === 1) throw new Error('native rejected');
    return { ok: true, value: 42 };
  });
  send(1); send(2);
  await tick();
  assert.deepEqual(messages.slice(1), [
    { type: 'result', id: 1, ok: false, error: 'native rejected' },
    { type: 'result', id: 2, ok: true, value: 42 },
  ]);
});

test('a fatal Wasm trap prevents queued calls from entering damaged native state', async () => {
  let calls = 0;
  const { send, messages } = await fixture(() => { calls++; throw new WebAssembly.RuntimeError('trap'); });
  send(1); send(2);
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(messages.slice(1), [{ type: 'fatal', error: 'trap' }]);
});
