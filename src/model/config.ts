import { z } from 'zod';
import { valueTypes } from './value-types.js';

const reserved = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield arguments eval dispose constructor prototype __proto__'.split(' '));
const text = z.string().min(1).refine((value) => Boolean(value.trim()) && !/[\x00-\x1f]/.test(value), 'expected nonempty text without control characters');
const identifier = text.refine((value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !reserved.has(value), 'invalid identifier');
const exportName = identifier.refine((value) => value !== 'then', 'then is reserved to prevent Promise assimilation');
const valueType = z.enum(valueTypes);
const parameter = z.strictObject({ name: identifier, type: valueType });
const fn = z.strictObject({ symbol: text.optional(), params: z.array(parameter).default([]), result: z.enum([...valueTypes, 'void']), error: z.boolean().optional() });
const input = z.strictObject({
  name: exportName, language: z.enum(['go', 'cpp']), files: z.array(text).min(1).optional(),
  headers: z.array(text).optional(), include: z.array(text).optional(), package: text.optional(),
  exports: z.record(exportName, fn).refine((value) => Object.keys(value).length > 0, 'expected at least one function'),
});
export const configSchema = z.strictObject({
  version: z.literal(1), output: text, input: z.array(input).min(1),
  tools: z.strictObject({ go: text.optional(), cpp: text.optional() }).default({}),
});
export type Config = z.input<typeof configSchema>;
export type InputConfig = z.input<typeof input>;
export type FunctionConfig = z.input<typeof fn>;
export type Language = InputConfig['language'];
export type Tools = z.output<typeof configSchema>['tools'];
export interface ResolvedFunction extends z.output<typeof fn> { name: string; symbol: string; error: boolean }
export interface ResolvedInput {
  name: string; language: Language; files: string[]; headers: string[]; include: string[];
  package?: string; exports: ResolvedFunction[];
}
export interface ResolvedConfig { version: 1; input: ResolvedInput[]; output: string; root: string; tools: Tools }
