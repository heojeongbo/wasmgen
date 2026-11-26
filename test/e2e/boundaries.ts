import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type * as Generated from '../../examples/web/generated/index.js';

export async function exerciseBoundaries(page: Page) {
  const report = await page.evaluate(async () => {
    const { geometry, policy, arithmetic } = (globalThis as typeof globalThis & { __wasmgenTest: typeof Generated }).__wasmgenTest;
    const cpp = await geometry();
    const go = await policy();
    const rust = await arithmetic();
    let numericChecks = 0;
    let stringChecks = 0;
    let rejectedStrings = 0;
    const equal = (actual: unknown, expected: unknown, context: string) => {
      if (!Object.is(actual, expected)) throw new Error(`${context}: received ${String(actual)}, expected ${String(expected)}`);
    };
    try {
      // ASCII is uppercase already, so Go's uppercase example preserves it.
      const strings = ['', '\0', 'A\0B', '"\\\n\t', '한글🦀', 'A\u2028B\u2029C', '\uD7FF\uE000', '\uD800\uDC00', '\uDBFF\uDFFF'];
      const invalid = ['\uD800', '\uDC00', '\uDBFF', '\uDFFF', '\uD800A', 'A\uDC00', '\uDC00\uD800', '\uD800\uD800\uDC00'];
      for (const [language, call] of Object.entries({ cpp: async (input: string) => (await cpp.greet(input)).slice('hello, '.length), go: (input: string) => go.upper(input), rust: async (input: string) => (await rust.label(input)).slice('Rust: '.length) })) {
        for (const input of strings) {
          equal(await call(input), input, `${language} Unicode round-trip`);
          stringChecks++;
        }
        for (const input of invalid) {
          let rejected = false;
          try { await call(input); }
          catch (error) {
            if (!(error instanceof Error) || !error.message.includes('expected well-formed Unicode string')) throw error;
            rejected = true;
          }
          if (!rejected) throw new Error(`${language} accepted ill-formed UTF-16`);
          rejectedStrings++;
        }
        equal(await call('RECOVERED'), 'RECOVERED', `${language} recovery after invalid strings`);
      }
      const numbers = [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Number.EPSILON, Number.MAX_SAFE_INTEGER, 1e-300];
      for (const [language, client] of Object.entries({ cpp, go, rust })) {
        for (const a of numbers) for (const b of [1, -1, 2, Number.MIN_VALUE, 0]) {
          const expected = a / b;
          let rejected = false;
          let actual;
          try { actual = await client.divide(a, b); } catch { rejected = true; }
          if (Number.isFinite(expected)) {
            if (rejected) throw new Error(`${language} rejected finite division ${a}/${b}`);
            equal(actual, expected, `${language} division ${a}/${b}`);
          } else if (!rejected) throw new Error(`${language} accepted nonfinite division`);
          numericChecks++;
        }
        const actual = await client.scale(numbers, 1);
        equal(actual.length, numbers.length, `${language} array length`);
        for (let i = 0; i < numbers.length; i++) {
          equal(actual[i], numbers[i], `${language} array index ${i}`);
          numericChecks++;
        }
        equal(await client.divide(42, 2), 21, `${language} recovery after invalid numbers`);
      }
      return { numericChecks, stringChecks, rejectedStrings };
    } finally { cpp.dispose(); go.dispose(); rust.dispose(); }
  });
  assert.deepEqual(report, { numericChecks: 198, stringChecks: 27, rejectedStrings: 24 });
  return report;
}
