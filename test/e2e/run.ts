import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBrowsers } from './browser.js';
import { exerciseRust } from './rust.js';
import { exerciseBoundaries } from './boundaries.js';

import type * as Generated from '../../examples/web/generated/index.js';
type BrowserGlobals = typeof globalThis & { __wasmgenTest: typeof Generated };

const root = path.resolve('.test-output/browser');
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp('examples/web', root, { recursive: true, filter: (source) => !source.includes('/dist') });
await writeFile(path.join(root, 'test-entry.ts'), "import './src/app/main.ts';\nimport { arithmetic, geometry, policy } from './generated/index.js';\nObject.assign(globalThis, { __wasmgenTest: { arithmetic, geometry, policy } });\n");
const html = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(path.join(root, 'index.html'), html.replace('./src/app/main.ts', './test-entry.ts'));

await runBrowsers(root, async (page) => {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('are ready'));
  await page.locator('#value').fill('23');
  await page.getByRole('button', { name: 'Call C++, Go and Rust' }).click();
  await page.waitForFunction(() => document.querySelector('#result')?.textContent?.includes('VALUE: 10'));
  assert.deepEqual(JSON.parse(await page.locator('#result').innerText()), { clamped: 10, label: 'VALUE: 10', rustLabel: 'Rust: VALUE: 10' });
  const values = await page.evaluate(async () => {
    const { geometry, policy } = (globalThis as BrowserGlobals).__wasmgenTest;
    const cpp = await geometry();
    const go = await policy();
    const errorOf = async (call: () => Promise<unknown>) => { try { await call(); return 'NO ERROR'; } catch (error) { return error instanceof Error ? error.message : String(error); } };
    try {
      const results = {
        cpp: await cpp.clamp(-3, 0, 10),
        cppString: await cpp.greet('로봇 🦀'),
        cppArray: await cpp.scale([1, -2, 0, 3.5], 2),
        cppZeroSigns: [Object.is(await cpp.divide(-0, 1), -0), ...(await cpp.scale([-0, 0], 1)).map(value => Object.is(value, -0)), Object.is((await cpp.scale([1], -0))[0], -0)],
        goString: await go.upper('안녕 wasm 🦀'),
        goArray: await go.scale([1, -2, 0, 3.5], 2),
        goZeroSigns: [Object.is(await go.divide(-0, 1), -0), ...(await go.scale([-0, 0], 1)).map(value => Object.is(value, -0)), Object.is((await go.scale([1], -0))[0], -0)],
        goBool: await go.negate(false),
        signed: await go.signed(-2147483648),
        unsigned: await go.unsigned(4294967295),
        empty: await go.empty(),
        voidIsUndefined: await go.notify() === undefined,
        cppError: await errorOf(() => cpp.divide(1, 0)),
        goError: await errorOf(() => go.divide(1, 0)),
        goPanic: await errorOf(() => go.fail()),
        rangeError: await errorOf(() => go.signed(2147483648)),
        nanError: await errorOf(() => cpp.clamp(NaN, 0, 10)),
        sparseError: await errorOf(() => cpp.scale(new Array(3), 2)),
        // @ts-expect-error Exercise invalid runtime calls from untyped JavaScript.
        arityError: await errorOf(() => cpp.clamp(1)),
        // @ts-expect-error Exercise structured-clone failure from untyped JavaScript.
        cloneError: await errorOf(() => go.upper(() => {})),
        recovered: await go.upper('recovered'),
        goroutine: await go.delayedDouble(21, 25),
        goroutineError: await errorOf(() => go.delayedDouble(1, -1)),
        concurrent: await Promise.all(Array.from({ length: 30 }, (_, i) => cpp.clamp(i, 0, 20))),
      };
      const order: string[] = [];
      await Promise.all([
        go.delayedDouble(10, 60).then(() => order.push('first')),
        go.delayedDouble(20, 0).then(() => order.push('second')),
      ]);
      const goAbort = new AbortController();
      const goPendingClient = await policy({ signal: goAbort.signal });
      const goPending = goPendingClient.delayedDouble(1, 10_000);
      setTimeout(() => goAbort.abort(new Error('cancel sleeping goroutine')), 20);
      const abortedGoroutine = await errorOf(() => goPending);
      const goTimed = await policy({ timeoutMs: 1000 });
      const goroutineTimeout = await errorOf(() => goTimed.delayedDouble(1, 10_000));
      goTimed.dispose();
      const big = await cpp.scale(Array.from({ length: 1_100_000 }, (_, i) => i), 2);
      const largeBuffer = [big.length, big[0], big.at(-1)];
      let finished = false;
      const computation = cpp.busy(400).then(() => { finished = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const mainThreadResponsive = !finished;
      await computation;
      cpp.dispose(); cpp.dispose();
      const afterDispose = await errorOf(() => cpp.clamp(1, 0, 10));
      const other = await geometry();
      const pending = other.busy(10_000);
      other.dispose();
      const disposedPending = await errorOf(() => pending);
      const abort = new AbortController();
      const abortable = await policy({ signal: abort.signal });
      abort.abort(new Error('test abort'));
      const aborted = await errorOf(() => abortable.upper('a'));
      const preAborted = await errorOf(() => policy({ signal: abort.signal }));
      const initializing = new AbortController();
      const initialization = policy({ signal: initializing.signal });
      initializing.abort(new Error('abort during initialization'));
      const abortInitialization = await errorOf(() => initialization);
      const pendingAbort = new AbortController();
      const pendingOptions = { signal: pendingAbort.signal };
      const pendingClient = await geometry(pendingOptions);
      const replacement = new AbortController();
      pendingOptions.signal = replacement.signal;
      replacement.abort(new Error('replacement must not own this client'));
      const pendingCall = pendingClient.busy(10_000);
      pendingAbort.abort(new Error('abort pending computation'));
      const abortPending = await errorOf(() => pendingCall);
      const timed = await geometry({ timeoutMs: 500 });
      const timeout = await errorOf(() => timed.busy(10_000));
      timed.dispose();
      return { ...results, order, abortedGoroutine, goroutineTimeout, largeBuffer, mainThreadResponsive, afterDispose, disposedPending, aborted, preAborted, abortInitialization, abortPending, timeout };
    } finally { cpp.dispose(); go.dispose(); }
  });
  assert.equal(values.goroutine, 42);
  assert.match(values.goroutineError, /nonnegative/);
  assert.deepEqual(values.order, ['first', 'second']);
  assert.match(values.abortedGoroutine, /cancel sleeping goroutine/);
  assert.match(values.goroutineTimeout, /timed out/);
  assert.equal(values.cpp, 0);
  assert.equal(values.cppString, 'hello, 로봇 🦀');
  assert.deepEqual(values.cppArray, [2, -4, 0, 7]);
  assert.deepEqual(values.cppZeroSigns, [true, true, false, true]);
  assert.equal(values.goString, '안녕 WASM 🦀');
  assert.deepEqual(values.goArray, [2, -4, 0, 7]);
  assert.deepEqual(values.goZeroSigns, [true, true, false, true]);
  assert.equal(values.goBool, true);
  assert.equal(values.signed, -2147483648);
  assert.equal(values.unsigned, 4294967295);
  assert.deepEqual(values.empty, []);
  assert.equal(values.voidIsUndefined, true);
  assert.match(values.cppError, /division by zero/);
  assert.match(values.goError, /division by zero/);
  assert.match(values.goPanic, /fixture panic/);
  assert.match(values.rangeError, /expected i32/);
  assert.match(values.nanError, /expected f64/);
  assert.match(values.sparseError, /expected f64/);
  assert.match(values.arityError, /expected 3 arguments/);
  assert.notEqual(values.cloneError, 'NO ERROR');
  assert.equal(values.recovered, 'RECOVERED');
  assert.deepEqual(values.concurrent, Array.from({ length: 30 }, (_, i) => Math.min(i, 20)));
  assert.deepEqual(values.largeBuffer, [1_100_000, 0, 2_199_998]);
  assert.equal(values.mainThreadResponsive, true);
  assert.match(values.afterDispose, /disposed/);
  assert.match(values.disposedPending, /disposed/);
  assert.match(values.aborted, /disposed/);
  assert.match(values.preAborted, /test abort/);
  assert.match(values.abortInitialization, /abort during initialization/);
  assert.match(values.abortPending, /abort pending computation/);
  assert.match(values.timeout, /timed out/);
  const rust = await exerciseRust(page);
  const boundaries = await exerciseBoundaries(page);
  // Only the three live example clients remain after all test instances close.
  await Promise.all(page.workers().slice(3).map((worker) => worker.waitForEvent('close', { timeout: 15_000 })));
  assert.equal(page.workers().length, 3, 'disposed workers must not leak');
  return { ...values, rust, boundaries };
}, 'browser');
