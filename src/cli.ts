#!/usr/bin/env node
import { generate, readConfig } from './index.js';
import { errorMessage } from './shared/errors.js';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: wasmgen <gen|check> [--config <wasmgen.yaml>]\n\nBuild browser Wasm and typed imports, or validate inputs without building.');
} else {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('generation interrupted'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const command = args.shift();
    if (!command || !['gen', 'check'].includes(command)) throw new Error(`unknown command ${command}`);
    let config = 'wasmgen.yaml';
    if (args.length) {
      if (args.length !== 2 || !args[0] || !args[1] || !['--config', '-c'].includes(args[0])) throw new Error('expected --config <file>');
      config = args[1];
    }
    if (command === 'check') {
      const result = await readConfig(config);
      console.log(`valid: ${result.input.length} module(s), output ${result.output}`);
    } else {
      const result = await generate(config, { signal: controller.signal, onProgress: (message) => console.error(message) });
      console.log(`generated ${result.modules.join(', ')} in ${result.output}`);
    }
  } catch (error) {
    console.error(`wasmgen: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
