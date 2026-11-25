export function workerSource(): string {
  return `import './go-runtime.js';
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
  return async (method, args) => JSON.parse(await globalThis.__wasmgen_api[method](JSON.stringify(args)));
}, schema);`;
}
