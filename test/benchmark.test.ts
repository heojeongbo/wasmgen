import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureBatches } from '../benchmarks/measure.js';
import { summarize } from '../benchmarks/statistics.js';

test('benchmark statistics preserve raw sample order and use nearest-rank p95', () => {
  const values = [4, 1, 3, 2];
  assert.deepEqual(summarize(values), { samples: values, count: 4, min: 1, median: 2.5, mean: 2.5, p95: 4, max: 4 });
  assert.deepEqual(values, [4, 1, 3, 2]);
  assert.equal(summarize(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
  assert.equal(summarize([0]).median, 0);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarize(invalid));
});

test('benchmark excludes warmup and validation from sequential batch timing', async () => {
  let clock = 0, calls = 0, active = false;
  const result = await measureBatches(async i => {
    assert.equal(active, false);
    active = true;
    await Promise.resolve();
    clock += 2;
    calls++;
    active = false;
    return i * 2;
  }, (value, i) => {
    assert.equal(value, i * 2);
    clock += 100;
  }, { warmup: 3, batches: 4, iterations: 5 }, () => clock);
  assert.equal(calls, 23);
  assert.deepEqual(result.samples, [2, 2, 2, 2]);
});

test('benchmark rejects invalid counts and wrong results instead of reporting success', async () => {
  const settings = { warmup: 1, batches: 2, iterations: 3 };
  await assert.rejects(measureBatches(async () => 0, () => { throw new Error('wrong result'); }, settings), /wrong result/);
  for (const invalid of [{ ...settings, warmup: -1 }, { ...settings, batches: 0 }, { ...settings, iterations: 0.5 }]) {
    await assert.rejects(measureBatches(async () => 0, () => {}, invalid), /counts/);
  }
});
