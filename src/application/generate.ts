import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ConfigReader, LanguageCompilers } from '../ports/language.js';
import { writeBarrel, writeShared, writeWeb } from '../codegen/web.js';
import { withOutput } from '../storage/output.js';
import { errorMessage } from '../shared/errors.js';

export interface GenerateOptions { signal?: AbortSignal; onProgress?: (message: string) => void }
export function createGenerator(adapters: LanguageCompilers, readConfig: ConfigReader) {
  return async (configPath: string, options: GenerateOptions = {}): Promise<{ output: string; modules: string[] }> => {
    const config = await readConfig(configPath);
    await withOutput(config.output, async (staging, result) => {
      const builds = path.join(staging, 'builds');
      await mkdir(builds);
      await writeShared(result);
      for (const mod of config.input) {
        options.signal?.throwIfAborted();
        options.onProgress?.(`building ${mod.name} (${mod.language})`);
        const directory = path.join(result, mod.name);
        const scratch = path.join(builds, mod.name);
        await mkdir(directory);
        await mkdir(scratch);
        const adapter = adapters[mod.language];
        try {
          const compiled = await adapter.build(mod, { directory, scratch, tools: config.tools, signal: options.signal });
          await writeWeb(mod, directory, compiled.workerSource);
        } catch (error) {
          throw new Error(`${mod.name} (${mod.language}) build failed: ${errorMessage(error)}`, { cause: error });
        }
      }
      await writeBarrel(config.input, result);
    }, options.signal);
    return { output: config.output, modules: config.input.map((mod) => mod.name) };
  };
}
