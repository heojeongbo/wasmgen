import type { ResolvedInput } from '../../model/config.js';

export function workerSource(input: ResolvedInput): string {
  const methods = input.exports.map((fn, index) => `    ${JSON.stringify(fn.name)}: native.wasmgen_call_${index},`).join('\n');
  return `import initialize from './native.js';
serve(async () => {
  const native = await initialize({ locateFile: () => new URL('./native.wasm', import.meta.url).href });
  const methods = {
${methods}
  };
  return (method, args) => methods[method](args);
}, schema);`;
}
