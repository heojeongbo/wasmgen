import assert from 'node:assert/strict';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { build, preview } from 'vite';
import type { BenchmarkGlobals } from './harness.js';
import { languages, type BrowserName, type BrowserResult, type Settings } from './model.js';
import { summarize } from './statistics.js';

async function withPage<T>(browser: Browser, url: string, exercise: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    context.on('request', request => requests.push(request.url()));
    await page.goto(url);
    await page.waitForFunction(() => '__wasmgenBenchmark' in globalThis);
    const result = await exercise(page);
    assert.deepEqual(errors, [], 'benchmark must not hide browser errors');
    assert(requests.some(request => new URL(request).pathname.endsWith('.wasm')), 'must load real Wasm');
    assert(requests.every(request => new URL(request).origin === new URL(url).origin), 'must use local assets');
    return result;
  } finally { await context.close(); }
}

export async function benchmarkBrowsers(root: string, selected: BrowserName[], settings: Settings, signal: AbortSignal): Promise<BrowserResult[]> {
  signal.throwIfAborted();
  await build({ root, base: '/benchmark/', logLevel: 'error', build: { outDir: 'dist', assetsInlineLimit: 0 } });
  const server = await preview({
    root, base: '/benchmark/', logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0, headers: {
      'Content-Security-Policy': "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'; base-uri 'none'",
    } },
  });
  try {
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/benchmark/`;
    const results: BrowserResult[] = [];
    for (const name of selected) {
      signal.throwIfAborted();
      const browser = await { chromium, firefox, webkit }[name].launch();
      const abort = () => { void browser.close().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        for (const language of languages) {
          const startups: number[] = [];
          for (let i = 0; i < settings.startupSamples; i++) {
            startups.push(await withPage(browser, url, async page => page.evaluate(async language => {
              const harness = (globalThis as BenchmarkGlobals).__wasmgenBenchmark;
              try { return await harness.initialize(language); } finally { harness.dispose(); }
            }, language)));
          }
          const rpc = await withPage(browser, url, async page => page.evaluate(async ({ language, settings }) => {
            const harness = (globalThis as BenchmarkGlobals).__wasmgenBenchmark;
            try { await harness.initialize(language); return await harness.measure(settings); }
            finally { harness.dispose(); }
          }, { language, settings }));
          results.push({ browser: name, version: browser.version(), language, startupMs: summarize(startups), rpc });
          console.log(`Benchmarked ${name}/${language}`);
        }
      } finally { signal.removeEventListener('abort', abort); await browser.close(); }
    }
    return results;
  } finally {
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
}
