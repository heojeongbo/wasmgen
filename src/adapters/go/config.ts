import path from 'node:path';
import type { ParsedInput } from '../../model/config.js';
import { requireFilesOrPackage, validateNativeFunctions } from '../../model/validation.js';

export function validateInput(input: ParsedInput): void {
  requireFilesOrPackage(input, 'Go');
  const files = input.files ?? [];
  if (files.some((file) => !file.endsWith('.go') || file.endsWith('_test.go'))) throw new Error(`${input.name}: expected non-test .go files`);
  if (new Set(files.map((file) => path.basename(file))).size !== files.length) throw new Error(`${input.name}: duplicate Go basenames`);
  validateNativeFunctions(input, /^[A-Z][A-Za-z0-9_]*$/, true);
}
