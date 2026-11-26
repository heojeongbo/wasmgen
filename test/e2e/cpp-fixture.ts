import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { InputConfig } from '../../src/model/config.js';

export const collisionSymbols = ['val', 'args', 'result', 'arg0', 'size0', 'j', 'array', 'call_0', 'wasmgen_module', 'translation_unit', 'bracket_value'] as const;
export type CollisionClient = Record<typeof collisionSymbols[number], (value: number) => Promise<number>> & {
  value(values: number[]): Promise<number[]>;
  dispose(): void;
};

export async function prepareCppCollisionFixture(nativeRoot: string): Promise<InputConfig> {
  const directory = path.resolve(nativeRoot, 'cpp-symbols');
  // Generated at test time: these are valid POSIX paths but cannot be checked
  // out on Windows. The documented toolchain matrix runs in Linux containers.
  const header = path.join(directory, 'symbols "quoted" \\path.h');
  await copyFile(path.join(directory, 'symbols.h'), header);
  const bracket = path.join(directory, 'bracket > name.h');
  await copyFile(path.join(directory, 'bracket.h'), bracket);
  return {
    name: 'collisions', language: 'cpp', headers: [header, bracket], files: [path.join(directory, 'translation-unit.cc')],
    exports: {
      ...Object.fromEntries(collisionSymbols.map(symbol => [symbol, { params: [{ name: 'input', type: 'f64' }], result: 'f64' }])),
      value: { params: [{ name: 'input', type: 'f64[]' }], result: 'f64[]' },
    },
  };
}
