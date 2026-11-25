import { createGenerator } from './application/generate.js';
import { readConfig as read } from './config.js';
import { languages } from './languages.js';

export const readConfig = (configPath: string) => read(configPath, languages);
export const generate = createGenerator(languages, readConfig);
export type { GenerateOptions } from './application/generate.js';
export type { Config, InputConfig, FunctionConfig, ResolvedConfig, ResolvedInput, ResolvedFunction } from './model/config.js';
export type { ValueType } from './model/value-types.js';
