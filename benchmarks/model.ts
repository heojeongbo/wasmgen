import type { Distribution } from './statistics.js';

export const languages = ['go', 'cpp', 'rust'] as const;
export type Language = typeof languages[number];
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export interface Settings {
  profile: 'full' | 'quick';
  generationSamples: number;
  startupSamples: number;
  batches: number;
  iterations: number;
  warmup: number;
  arrayLengths: number[];
}
export function settings(quick: boolean): Settings {
  return quick
    ? { profile: 'quick', generationSamples: 1, startupSamples: 2, batches: 3, iterations: 5, warmup: 5, arrayLengths: [32, 1024, 16384] }
    : { profile: 'full', generationSamples: 3, startupSamples: 5, batches: 9, iterations: 25, warmup: 25, arrayLengths: [32, 1024, 16384] };
}
export interface Client {
  divide(a: number, b: number): Promise<number>;
  scale(values: number[], factor: number): Promise<number[]>;
  dispose(): void;
}
export type Factories = Record<Language, () => Promise<Client>>;
export interface RpcResult { operation: string; millisecondsPerCall: Distribution }
export interface BrowserResult {
  browser: BrowserName;
  version: string;
  language: Language;
  startupMs: Distribution;
  rpc: RpcResult[];
}
export interface BenchmarkReport {
  schemaVersion: 1;
  recordedAt: string;
  environment: {
    packageVersion: string; revision: string; dirty: boolean; platform: string;
    architecture: string; cpu: string; logicalCpus: number; memoryBytes: number;
    node: string; toolchains: Record<string, string>;
  };
  settings: Settings;
  generation: { firstMs: number; repeatedMs: Distribution };
  assets: Array<{ language: Language; wasmBytes: number; wasmGzipBytes: number; moduleJavaScriptBytes: number }>;
  browsers: BrowserResult[];
}
