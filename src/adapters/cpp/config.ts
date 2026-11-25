import type { ParsedInput } from '../../model/config.js';
import { validateNativeFunctions } from '../../model/validation.js';

export function validateInput(input: ParsedInput): void {
  if (input.package) throw new Error(`${input.name}: package is only valid for Go or Rust`);
  if (!input.headers?.length) throw new Error(`${input.name}: C++ requires declarations in at least one header`);
  validateNativeFunctions(input, /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/, false);
}
