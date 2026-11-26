#!/usr/bin/env node
import { generate, readConfig } from './index.js';
import { errorMessage } from './shared/errors.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { help, parseArguments } from './cli/arguments.js';

try {
  const command = parseArguments(process.argv.slice(2));
  if (command.kind === 'help') console.log(help);
  else if (command.kind === 'version') {
    const metadata = z.object({ version: z.string() }).parse(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as unknown);
    console.log(metadata.version);
  } else if (command.kind === 'check') {
    const result = await readConfig(command.config);
    console.log(`valid: ${result.input.length} module(s), output ${result.output}`);
  } else {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('generation interrupted'));
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    try {
      const result = await generate(command.config, { signal: controller.signal, onProgress: (message) => console.error(message) });
      console.log(`generated ${result.modules.join(', ')} in ${result.output}`);
    } finally {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    }
  }
} catch (error) {
  console.error(`wasmgen: ${errorMessage(error)}`);
  process.exitCode = 1;
}
