import type { NativeOperations } from '../../../shared/api/index.js';

export async function calculate(native: NativeOperations, value: number): Promise<{ clamped: number; label: string }> {
  const clamped = await native.clamp(value, 0, 10);
  return { clamped, label: await native.uppercase(`value: ${clamped}`) };
}
