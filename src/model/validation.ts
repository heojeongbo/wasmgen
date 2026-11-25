import type { ParsedInput } from './config.js';

export function requireFilesOrPackage(input: ParsedInput, language: string): void {
  if (input.headers?.length || input.include?.length) throw new Error(`${input.name}: headers/include are only for C++`);
  if (Boolean(input.package) === Boolean(input.files?.length)) throw new Error(`${input.name}: ${language} requires exactly one of files or package`);
}

export function validateNativeFunctions(input: ParsedInput, symbolPattern: RegExp, acceptsErrors: boolean): void {
  for (const [name, fn] of Object.entries(input.exports)) {
    const symbol = fn.symbol ?? name;
    if (!symbolPattern.test(symbol)) throw new Error(`${input.name}.${name}: invalid ${input.language} symbol ${symbol}`);
    if (!acceptsErrors && fn.error !== undefined) throw new Error(`${input.name}.${name}: error is only valid for Go or Rust`);
  }
}
