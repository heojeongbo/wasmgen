import { createGenerator } from './application/generate.js';
import { cppAdapter } from './adapters/cpp/compiler.js';
import { goAdapter } from './adapters/go/compiler.js';

// Only the composition root knows which concrete compilers the tool ships.
export const generate = createGenerator({ cpp: cppAdapter, go: goAdapter });
export { readConfig } from './config.js';
export type { GenerateOptions } from './application/generate.js';
export type { Config, InputConfig, FunctionConfig, ResolvedConfig, ResolvedInput, ResolvedFunction } from './model/config.js';
export type { ValueType } from './model/value-types.js';
