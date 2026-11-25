import type { ResultType, ValueType } from '../model/value-types.js';

export interface CallRequest { id: number; method: string; args: unknown[] }
export type NativeResult = { ok: true; value?: unknown } | { ok: false; error: string };
export type WorkerResponse = { type: 'ready' } | { type: 'fatal'; error: string } | ({ type: 'result'; id: number } & NativeResult);
export interface FunctionSchema { params: { name: string; type: ValueType }[]; result: ResultType }
export type Schema = Record<string, FunctionSchema>;
export type NativeCall = (method: string, args: unknown[]) => NativeResult | Promise<NativeResult>;

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function isRequest(value: unknown): value is CallRequest {
  return object(value) && Number.isSafeInteger(value['id']) && typeof value['method'] === 'string' && Array.isArray(value['args']);
}
export function isResponse(value: unknown): value is WorkerResponse {
  if (!object(value)) return false;
  if (value['type'] === 'ready') return true;
  if (value['type'] === 'fatal') return typeof value['error'] === 'string';
  return value['type'] === 'result' && Number.isSafeInteger(value['id']) && (value['ok'] === true || (value['ok'] === false && typeof value['error'] === 'string'));
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
