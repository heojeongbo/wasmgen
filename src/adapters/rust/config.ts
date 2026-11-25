import type { ParsedInput } from '../../model/config.js';
import { requireFilesOrPackage, validateNativeFunctions } from '../../model/validation.js';

export function validateInput(input: ParsedInput): void {
  requireFilesOrPackage(input, 'Rust');
  if (input.files && (input.files.length !== 1 || !input.files[0]?.endsWith('.rs'))) {
    throw new Error(`${input.name}: Rust files must contain exactly one .rs crate root; use mod declarations for other files`);
  }
  validateNativeFunctions(input, /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/, true);
}
