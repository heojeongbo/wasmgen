import { generate, readConfig, type Config } from '@heojeongbo/wasmgen';
import { arithmetic, geometry, policy } from '../../examples/web/generated/index.js';

async function contract() {
  await generate('wasmgen.yaml', { signal: new AbortController().signal });
  const config = await readConfig('wasmgen.yaml');
  const language: 'cpp' | 'go' | 'rust' = config.input[0].language;
  const cpp = await geometry();
  const go = await policy();
  const rust = await arithmetic();
  const rustText: string = await rust.label('wasm');
  const rustValues: number[] = await rust.signed([-1, 2]);
  const rustVoid: void = await rust.checkedNotify(true);
  // @ts-expect-error generated Rust declarations reject an incompatible parameter
  await rust.scale('wrong', 2);
  const number: number = await cpp.clamp(1, 0, 10);
  const text: string = await go.upper('wasm');
  const delayed: number = await go.delayedDouble(21, 10);
  const array: number[] = await go.scale([1, 2], 3);
  // @ts-expect-error generated types reject an incompatible parameter
  await cpp.clamp('wrong', 0, 10);
  // @ts-expect-error generated types reject nonexistent functions
  await go.missing();
  cpp.dispose(); go.dispose(); rust.dispose();
  return { number, text, array, language, delayed, rustText, rustValues, rustVoid };
}
const config: Config = { version: 1, input: [], output: './generated' };
void config; void contract;
