import test from 'node:test';
import assert from 'node:assert/strict';
import { serve, type WorkerScope } from '../src/runtime/worker.js';
import type { NativeCall, WorkerResponse, Schema } from '../src/runtime/protocol.js';
import type { ResultType, ValueType } from '../src/model/value-types.js';

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
  send(3);
  await tick();
  assert.equal(calls, 1);
});

test('Worker validates all scalar/array boundaries and void/nil result normalization', async () => {
  const cases: Array<{ type: ResultType; valid: unknown[]; invalid: unknown[] }> = [
    { type: 'string', valid: ['', '한글🦀', '\0A\0', '\uD7FF\uE000', '\uD800\uDC00', '\uDBFF\uDFFF'], invalid: [1, '\uD800', '\uDC00', 'A\uDBFF', '\uD800A', '\uDC00\uD800'] },
    { type: 'bool', valid: [true, false], invalid: ['true'] },
    { type: 'f64', valid: [0, -1.5], invalid: ['1', NaN, Infinity] },
    { type: 'i32', valid: [-2147483648, 2147483647], invalid: ['1', 1.5, -2147483649, 2147483648] },
    { type: 'u32', valid: [0, 4294967295], invalid: [null, 0.5, -1, 4294967296] },
    { type: 'f64[]', valid: [[], [1, 2]], invalid: [{}, [Infinity]] },
  ];
  for (const { type, valid, invalid } of cases) {
    const messages: WorkerResponse[] = [];
    const scope: WorkerScope = { onmessage: null, postMessage: value => { messages.push(value); } };
    let calls = 0;
    await serve(async () => (_method, args) => { calls++; return { ok: true, value: args[0] }; }, { value: { params: [{ name: 'input', type: type as ValueType }], result: type } }, scope);
    let id = 0;
    for (const input of [...valid, ...invalid]) {
      scope.onmessage?.(new MessageEvent('message', { data: { id: ++id, method: 'value', args: [input] } }));
      await tick();
      const response = messages.at(-1);
      assert(response?.type === 'result');
      if (valid.includes(input)) { assert.equal(response.ok, true); if (response.ok) assert.deepEqual(response.value, input); }
      else { assert.equal(response.ok, false); if (!response.ok) assert.match(response.error, /value.input/); }
    }
    assert.equal(calls, valid.length);
  }
  for (const [result, value, expected] of [['void', 'ignored', undefined], ['f64[]', null, []]] as const) {
    const messages: WorkerResponse[] = [];
    const scope: WorkerScope = { onmessage: null, postMessage: message => { messages.push(message); } };
    await serve(async () => () => ({ ok: true, value }), { value: { params: [], result } }, scope);
    scope.onmessage?.(new MessageEvent('message', { data: { id: 1, method: 'value', args: [] } }));
    await tick();
    assert.deepEqual(messages.at(-1), { type: 'result', id: 1, ok: true, value: expected });
  }
});

test('Worker rejects ill-formed native string results and still processes later calls', async () => {
  const messages: WorkerResponse[] = [];
  const scope: WorkerScope = { onmessage: null, postMessage: message => { messages.push(message); } };
  let calls = 0;
  await serve(async () => () => ({ ok: true, value: ++calls === 1 ? '\uD800' : '한글🦀\0' }), { value: { params: [], result: 'string' } }, scope);
  for (const id of [1, 2]) scope.onmessage?.(new MessageEvent('message', { data: { id, method: 'value', args: [] } }));
  await tick();
  assert.deepEqual(messages.slice(1), [
    { type: 'result', id: 1, ok: false, error: 'value result: expected well-formed Unicode string' },
    { type: 'result', id: 2, ok: true, value: '한글🦀\0' },
  ]);
});

test('Worker reports initialization, arity, native-result and schema failures', async () => {
  const messages: WorkerResponse[] = [];
  const scope: WorkerScope = { onmessage: null, postMessage: message => { messages.push(message); } };
  await serve(async () => { throw 'not initialized'; }, {}, scope);
  assert.deepEqual(messages, [{ type: 'fatal', error: 'not initialized' }]);
  const schema: Schema = {
    value: { params: [{ name: 'x', type: 'f64' }], result: 'f64' },
    broken: { params: [], result: 'unsupported' as ResultType },
    failure: { params: [], result: 'void' },
  };
  Object.defineProperty(schema, 'empty', { value: undefined });
  await serve(async () => method => method === 'failure' ? { ok: false, error: 'native failure' } : { ok: true, value: 42 }, schema, scope);
  for (const [method, expected] of [['toString', /unknown function/], ['empty', /unknown function/], ['value', /expected 1 arguments/], ['broken', /unsupported type/], ['failure', /native failure/]] as const) {
    scope.onmessage?.(new MessageEvent('message', { data: { id: 1, method, args: [] } }));
    await tick();
    const response = messages.at(-1);
    assert(response?.type === 'result' && !response.ok);
    assert.match(response.error, expected);
  }
});

test('malformed requests close the Worker protocol before native dispatch', async () => {
  let calls = 0;
  const { scope, messages, send } = await fixture(() => { calls++; return { ok: true, value: 42 }; });
  scope.onmessage?.(new MessageEvent('message', { data: null }));
  send(1);
  await tick();
  assert.equal(calls, 0);
  assert.deepEqual(messages.at(-1), { type: 'fatal', error: 'invalid worker request' });
});

test('Worker defaults to self and reports transport failures as fatal', async (t) => {
  const messages: WorkerResponse[] = [];
  let failures = 2;
  const scope: WorkerScope = { onmessage: null, postMessage(message) {
    if (message.type === 'result' && failures-- > 0) throw new Error('transport failed');
    messages.push(message);
  } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self'); });
  await serve(async () => () => ({ ok: true, value: 42 }), { value: { params: [], result: 'f64' } });
  scope.onmessage?.(new MessageEvent('message', { data: { id: 1, method: 'value', args: [] } }));
  await tick();
  assert.deepEqual(messages.at(-1), { type: 'fatal', error: 'transport failed' });
});
