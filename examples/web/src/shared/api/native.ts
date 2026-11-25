import { geometry, policy } from '../../../generated/index.js';

export interface NativeOperations {
  clamp(value: number, low: number, high: number): Promise<number>;
  uppercase(value: string): Promise<string>;
  dispose(): void;
}

export async function createNativeOperations(): Promise<NativeOperations> {
  const cpp = await geometry();
  try {
    const go = await policy();
    return {
      clamp: (value, low, high) => cpp.clamp(value, low, high),
      uppercase: (value) => go.upper(value),
      dispose() { cpp.dispose(); go.dispose(); },
    };
  } catch (error) { cpp.dispose(); throw error; }
}
