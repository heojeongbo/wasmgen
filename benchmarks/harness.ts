import type { Client, Factories, Language, RpcResult, Settings } from './model.js';
import { measureBatches } from './measure.js';

export function createHarness(factories: Factories) {
  let client: Client | undefined;
  return {
    async initialize(language: Language): Promise<number> {
      client?.dispose();
      client = undefined;
      const start = performance.now();
      client = await factories[language]();
      return performance.now() - start;
    },
    async measure(settings: Settings): Promise<RpcResult[]> {
      const native = client;
      if (!native) throw new Error('initialize a client before measuring');
      const results: RpcResult[] = [{
        operation: 'divide',
        millisecondsPerCall: await measureBatches(
          i => native.divide(42 + i, 2),
          (value, i) => { if (value !== (42 + i) / 2) throw new Error('incorrect scalar result'); },
          settings,
        ),
      }];
      for (const length of settings.arrayLengths) {
        const values = Array.from({ length }, (_, i) => (i % 97) - 48);
        results.push({
          operation: `scale[${length}]`,
          millisecondsPerCall: await measureBatches(
            i => native.scale(values, 2 + i % 3),
            (result, i) => {
              const factor = 2 + i % 3;
              if (result.length !== length || result.some((value, index) => value !== values[index]! * factor)) {
                throw new Error(`incorrect array result (${length})`);
              }
            },
            settings,
          ),
        });
      }
      return results;
    },
    dispose(): void { client?.dispose(); client = undefined; },
  };
}

export type BenchmarkGlobals = typeof globalThis & { __wasmgenBenchmark: ReturnType<typeof createHarness> };
