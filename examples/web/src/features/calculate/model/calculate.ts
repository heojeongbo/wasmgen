import type { NativeOperations } from '../../../shared/api/index.js';

export async function calculate(native: NativeOperations, value: number): Promise<{ clamped: number; label: string; rustLabel: string }> {
  const clamped = await native.clamp(value, 0, 10);
  const label = await native.uppercase(`value: ${clamped}`);
  return { clamped, label, rustLabel: await native.label(label) };
}
