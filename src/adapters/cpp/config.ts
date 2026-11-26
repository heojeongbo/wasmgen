import type { ParsedInput } from '../../model/config.js';
import { validateNativeFunctions } from '../../model/validation.js';

export function validateInput(input: ParsedInput): void {
  if (input.package) throw new Error(`${input.name}: package is only valid for Go or Rust`);
  if (!input.headers?.length) throw new Error(`${input.name}: C++ requires declarations in at least one header`);
  // Header-name tokens do not process string escapes. Either delimiter can be
  // used literally, but no include directive can represent a path with both.
  for (const [index, header] of input.headers.entries()) {
    if (header.includes('"') && header.includes('>')) throw new Error(`${input.name}.headers[${index}]: C++ header paths cannot contain both a double quote and >`);
  }
  validateNativeFunctions(input, /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/, false);
}
