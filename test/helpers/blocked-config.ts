import { mock } from 'node:test';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [cli, config, marker] = process.argv.slice(2);
if (!cli || !config || !marker) throw new Error('expected CLI, config and marker paths');
mock.module('node:fs/promises', { namedExports: { ...fs, readFile: async (...args: Parameters<typeof fs.readFile>) => {
  if (String(args[0]) === config) {
    await fs.writeFile(marker, 'reading config');
    // Model pending filesystem IO; the owning test always terminates this child.
    await new Promise<never>(() => { setInterval(() => {}, 1000); });
  }
  return fs.readFile(...args);
} } });
process.argv = [process.execPath, cli, 'check', '--config', config];
await import(pathToFileURL(cli).href);
