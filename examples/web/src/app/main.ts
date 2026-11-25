import { mountCalculator } from '../pages/calculator/index.js';
import { createNativeOperations } from '../shared/api/index.js';

async function start(): Promise<void> {
  const native = await createNativeOperations();
  try {
    const unmount = mountCalculator(document, native);
    window.addEventListener('pagehide', () => { unmount(); native.dispose(); }, { once: true });
  } catch (error) { native.dispose(); throw error; }
}
start().catch((error: unknown) => {
  const status = document.querySelector('#status');
  if (status) status.textContent = String(error);
});
