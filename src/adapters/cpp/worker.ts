export function workerSource(): string {
  return `import initialize from './native.js';
serve(async () => {
  const native = await initialize({ locateFile: () => new URL('./native.wasm', import.meta.url).href });
  return (method, args) => native[method](args);
}, schema);`;
}
