import { generate, readConfig, type Config } from '@heojeongbo/wasmgen';
import { geometry, policy } from '../../examples/web/generated/index.js';

async function contract() {
  await generate('wasmgen.yaml', { signal: new AbortController().signal });
  const config = await readConfig('wasmgen.yaml');
  const language: 'cpp' | 'go' = config.input[0].language;
  const cpp = await geometry();
  const go = await policy();
  const number: number = await cpp.clamp(1, 0, 10);
  const text: string = await go.upper('wasm');
  const delayed: number = await go.delayedDouble(21, 10);
  const array: number[] = await go.scale([1, 2], 3);
  // @ts-expect-error generated types reject an incompatible parameter
  await cpp.clamp('wrong', 0, 10);
  // @ts-expect-error generated types reject nonexistent functions
  await go.missing();
  cpp.dispose(); go.dispose();
  return { number, text, array, language, delayed };
}
const config: Config = { version: 1, input: [], output: './generated' };
void config; void contract;
