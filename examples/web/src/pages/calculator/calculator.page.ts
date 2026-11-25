import { calculate } from '../../features/calculate/index.js';
import type { NativeOperations } from '../../shared/api/index.js';
import { content } from './calculator.content.js';

export function mountCalculator(document: Document, native: NativeOperations): () => void {
  const status = document.querySelector<HTMLParagraphElement>('#status');
  const button = document.querySelector<HTMLButtonElement>('button');
  const result = document.querySelector<HTMLPreElement>('#result');
  const input = document.querySelector<HTMLInputElement>('#value');
  const form = document.querySelector<HTMLFormElement>('#compute');
  if (!status || !button || !result || !input || !form) throw new Error('calculator markup is incomplete');
  status.textContent = content.ready;
  button.disabled = false;
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    button.disabled = true;
    try { result.textContent = JSON.stringify(await calculate(native, input.valueAsNumber), null, 2); }
    catch (error) { result.textContent = String(error); }
    finally { button.disabled = false; }
  };
  form.addEventListener('submit', submit);
  return () => form.removeEventListener('submit', submit);
}
