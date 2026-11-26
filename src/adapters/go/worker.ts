export function workerSource(): string {
  return `import './go-runtime.js';
// The shared runtime validates scalar/flat-array arguments before encoding.
// JSON.stringify converts -0 to 0; keep its sign for native floating-point APIs.
function encodeArgument(value) {
  if (Object.is(value, -0)) return '-0';
  if (Array.isArray(value) && value.some(item => Object.is(item, -0))) {
    return '[' + value.map(encodeArgument).join(',') + ']';
  }
  return JSON.stringify(value);
}
serve(async () => {
  const go = new globalThis.Go();
  const response = await fetch(new URL('./native.wasm', import.meta.url));
  if (!response.ok) throw new Error('cannot load Go Wasm: HTTP ' + response.status);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
  let ready;
  const registered = new Promise((resolve) => { ready = resolve; });
  globalThis.__wasmgen_ready = ready;
  const running = go.run(instance);
  // A module that exits before registration must reject initialization.
  await Promise.race([registered, running.then(() => { throw new Error('Go exited before registration'); })]);
  running.then(() => self.postMessage({ type: 'fatal', error: 'Go runtime exited' }), (error) => self.postMessage({ type: 'fatal', error: String(error) }));
  delete globalThis.__wasmgen_ready;
  return async (method, args) => JSON.parse(await globalThis.__wasmgen_api[method]('[' + args.map(encodeArgument).join(',') + ']'));
}, schema);`;
}
