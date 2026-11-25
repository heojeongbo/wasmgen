import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit, type Page } from 'playwright';
import { build, createServer, preview } from 'vite';

export async function runBrowsers(root: string, exercise: (page: Page) => Promise<unknown>, label: string) {
  const artifacts = path.resolve('.artifacts');
  await mkdir(artifacts, { recursive: true });
  const report: { label: string; cases: Array<{ browser: string; version?: string; mode: string; status: string; results?: unknown; wasmRequests?: string[]; error?: string; console?: string[] }> } = { label, cases: [] };
  try {
    for (const mode of ['development', 'production']) {
      let httpServer: NonNullable<Awaited<ReturnType<typeof createServer>>['httpServer']>;
      let close: () => Promise<void>;
      if (mode === 'development') {
        const server = await createServer({ root, base: '/demo/', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
        await server.listen();
        assert(server.httpServer);
        httpServer = server.httpServer;
        close = () => server.close();
      } else {
        await build({ root, base: '/demo/', logLevel: 'error', build: { outDir: 'dist', assetsInlineLimit: 0 } });
        const server = await preview({ root, base: '/demo/', logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
        httpServer = server.httpServer;
        close = () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
      }
      const address = httpServer.address();
      assert(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}/demo/`;
      try {
        for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
          const browser = await engine.launch();
          const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
          const errors: string[] = [];
          const requests: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
          page.context().on('request', (request) => requests.push(request.url()));
          try {
            await page.goto(url);
            await page.waitForFunction(() => '__wasmgenTest' in globalThis, undefined, { timeout: 30_000 });
            const results = await exercise(page);
            assert.deepEqual(errors, [], `unexpected browser errors (${name}/${mode})`);
            assert(requests.some((request) => request.includes('.wasm')), 'must fetch actual Wasm');
            assert(requests.every((request) => request.startsWith(new URL(url).origin)), 'generated clients must not contact external services');
            await page.screenshot({ path: path.join(artifacts, `${label}-${mode}-${name}.png`) });
            report.cases.push({ browser: name, version: browser.version(), mode, status: 'passed', results, wasmRequests: requests.filter((request) => request.includes('.wasm')) });
            console.log(`PASS ${label}: ${name} ${mode}`);
          } catch (error) {
            await page.screenshot({ path: path.join(artifacts, `${label}-${mode}-${name}-failed.png`) }).catch(() => {});
            report.cases.push({ browser: name, mode, status: 'failed', error: String(error), console: errors });
            throw error;
          } finally { await browser.close(); }
        }
      } finally {
        await close();
      }
    }
    return report;
  } finally { await writeFile(path.join(artifacts, `${label}-report.json`), JSON.stringify(report, null, 2) + '\n'); }
}
