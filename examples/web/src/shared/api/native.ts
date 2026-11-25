import { arithmetic, geometry, policy } from '../../../generated/index.js';

export interface NativeOperations {
  clamp(value: number, low: number, high: number): Promise<number>;
  uppercase(value: string): Promise<string>;
  label(value: string): Promise<string>;
  dispose(): void;
}

export async function createNativeOperations(): Promise<NativeOperations> {
  const clients: Array<{ dispose(): void }> = [];
  const dispose = () => { for (const client of clients.splice(0).reverse()) client.dispose(); };
  try {
    const cpp = await geometry();
    clients.push(cpp);
    const go = await policy();
    clients.push(go);
    const rust = await arithmetic();
    clients.push(rust);
    return {
      clamp: (value, low, high) => cpp.clamp(value, low, high),
      uppercase: (value) => go.upper(value),
      label: (value) => rust.label(value),
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
