import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type * as Generated from '../../examples/web/generated/index.js';

export async function exerciseRust(page: Page) {
  const values = await page.evaluate(async () => {
    const { arithmetic } = (globalThis as typeof globalThis & { __wasmgenTest: typeof Generated }).__wasmgenTest;
    const rust = await arithmetic();
    const errorOf = async (call: () => Promise<unknown>) => {
      try { await call(); return 'NO ERROR'; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    };
    try {
      const results = {
        label: await rust.label('안녕 🦀'),
        emptyString: await rust.label(''),
        scaled: await rust.scale([1, -2, 0, 3.5], 2),
        zeroSigns: [Object.is(await rust.divide(-0, 1), -0), ...(await rust.scale([-0, 0], 1)).map(value => Object.is(value, -0)), Object.is((await rust.scale([1], -0))[0], -0)],
        empty: await rust.scale([], 2),
        signed: await rust.signed([-2147483648, 2147483647]),
        unsigned: await rust.unsigned([0, 4294967295]),
        signedScalar: await rust.signedScalar(-2147483648),
        unsignedScalar: await rust.unsignedScalar(4294967295),
        negated: await rust.negate(false),
        resultOk: await rust.divide(42, 2),
        resultError: await errorOf(() => rust.divide(1, 0)),
        resultArray: await rust.checkedValues(true),
        resultArrayError: await errorOf(() => rust.checkedValues(false)),
        resultVoid: await rust.checkedNotify(true) === undefined,
        resultVoidError: await errorOf(() => rust.checkedNotify(false)),
        reservedBindgenName: await rust.initSync() === undefined,
        outOfRange: await errorOf(() => rust.unsignedScalar(-1)),
        nonFiniteResult: await errorOf(() => rust.scale([Number.MAX_VALUE], 2)),
        recovered: await rust.label('recovered'),
        concurrent: await Promise.all(Array.from({ length: 20 }, (_, i) => rust.divide(i, 2))),
      };
      const big = await rust.scale(Array.from({ length: 1_100_000 }, (_, i) => i), 2);
      const largeBuffer = [big.length, big[0], big.at(-1)];
      const panicClient = await arithmetic();
      const panic = await Promise.all([
        errorOf(() => panicClient.fail()),
        errorOf(() => panicClient.label('queued after panic')),
      ]);
      const afterPanic = await errorOf(() => panicClient.label('later'));
      panicClient.dispose();
      const controller = new AbortController();
      const abortable = await arithmetic({ signal: controller.signal });
      const pending = abortable.busy();
      setTimeout(() => controller.abort(new Error('cancel Rust computation')), 20);
      const aborted = await errorOf(() => pending);
      const timed = await arithmetic({ timeoutMs: 1000 });
      const timeout = await errorOf(() => timed.busy());
      timed.dispose();
      return { ...results, largeBuffer, panic, afterPanic, aborted, timeout };
    } finally { rust.dispose(); }
  });
  assert.equal(values.label, 'Rust: 안녕 🦀');
  assert.equal(values.emptyString, 'Rust: ');
  assert.deepEqual(values.scaled, [2, -4, 0, 7]);
  assert.deepEqual(values.zeroSigns, [true, true, false, true]);
  assert.deepEqual(values.empty, []);
  assert.deepEqual(values.signed, [-2147483648, 2147483647]);
  assert.deepEqual(values.unsigned, [0, 4294967295]);
  assert.equal(values.signedScalar, -2147483648);
  assert.equal(values.unsignedScalar, 4294967295);
  assert.equal(values.negated, true);
  assert.equal(values.resultOk, 21);
  assert.match(values.resultError, /division by zero/);
  assert.deepEqual(values.resultArray, [1, 2]);
  assert.match(values.resultArrayError, /invalid values/);
  assert.equal(values.resultVoid, true);
  assert.match(values.resultVoidError, /notification rejected/);
  assert.equal(values.reservedBindgenName, true);
  assert.match(values.outOfRange, /expected u32/);
  assert.match(values.nonFiniteResult, /expected f64/);
  assert.equal(values.recovered, 'Rust: recovered');
  assert.deepEqual(values.concurrent, Array.from({ length: 20 }, (_, i) => i / 2));
  assert.deepEqual(values.largeBuffer, [1_100_000, 0, 2_199_998]);
  assert.equal(values.panic.length, 2);
  for (const error of values.panic) assert.match(error, /unreachable|trap/i);
  assert.match(values.afterPanic, /disposed/);
  assert.match(values.aborted, /cancel Rust computation/);
  assert.match(values.timeout, /timed out/);
  return values;
}
