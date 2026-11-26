import test from 'node:test';
import assert from 'node:assert/strict';
import { isRequest, isResponse, message } from '../src/runtime/protocol.js';
import { errorMessage, hasCode } from '../src/shared/errors.js';
import { parseArguments } from '../src/cli/arguments.js';

test('Worker protocol rejects malformed envelopes before dispatch', () => {
  for (const value of [null, [], 1, 'ready', undefined, {}, { id: Infinity }, { id: 1, method: 3 }, { id: 1, method: 'f', args: {} }]) assert.equal(isRequest(value), false);
  assert.equal(isRequest({ id: 1, method: 'f', args: [] }), true);
  for (const value of [null, [], 1, {}, { type: 'fatal' }, { type: 'other' }, { type: 'result', id: NaN }, { type: 'result', id: 1 }, { type: 'result', id: 1, ok: false, error: 1 }]) assert.equal(isResponse(value), false);
  for (const value of [{ type: 'ready' }, { type: 'fatal', error: 'failure' }, { type: 'result', id: 1, ok: true, value: 42 }, { type: 'result', id: 2, ok: false, error: 'failure' }]) assert.equal(isResponse(value), true);
  for (const format of [message, errorMessage]) {
    assert.equal(format(new Error('reason')), 'reason');
    assert.equal(format('reason'), 'reason');
    assert.equal(format(null), 'null');
  }
  assert.equal(hasCode(null, 'ENOENT'), false);
  assert.equal(hasCode({}, 'ENOENT'), false);
  assert.equal(hasCode(Object.assign(new Error('missing'), { code: 'ENOENT' }), 'ENOENT'), true);
});

test('CLI defaults are explicit and help works without a command', () => {
  assert.deepEqual(parseArguments([]), { kind: 'help' });
  assert.deepEqual(parseArguments(['gen']), { kind: 'gen', config: 'wasmgen.yaml' });
  assert.deepEqual(parseArguments(['check', '-c', 'a.yaml']), { kind: 'check', config: 'a.yaml' });
});
