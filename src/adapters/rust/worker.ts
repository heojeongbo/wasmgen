import type { ResolvedInput } from '../../model/config.js';

export function workerSource(input: ResolvedInput): string {
  const methods = input.exports.map((fn, index) => `    ${JSON.stringify(fn.name)}: native.wasmgen_call_${index},`).join('\n');
  return `import initialize, * as native from './native.js';
serve(async () => {
  await initialize({ module_or_path: new URL('./native_bg.wasm', import.meta.url) });
  const methods = {
${methods}
  };
  return (method, args) => {
    const value = methods[method](...args);
    return { ok: true, value: schema[method].result.endsWith('[]') ? Array.from(value) : value };
  };
}, schema);`;
}
