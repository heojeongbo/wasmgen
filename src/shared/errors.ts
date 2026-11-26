export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function hasCode(error: unknown, code: string): boolean { return error instanceof Error && 'code' in error && error.code === code; }

/** Preserve the primary failure when one or more cleanup operations also fail. */
export function throwFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures.map(errorMessage).join('; '), { cause: failures[0] });
}
