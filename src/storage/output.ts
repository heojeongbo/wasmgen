import { mkdir, mkdtemp, lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { errorMessage, hasCode } from '../shared/errors.js';

export async function filesIn(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`output contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) result.push(...await filesIn(path.join(directory, entry.name), relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}
async function inspectOutput(output: string): Promise<boolean> {
  try {
    const info = await lstat(output);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`output must be a real directory: ${output}`);
  } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
  const files = await filesIn(output);
  if (!files.length) return true;
  let manifest;
  try { manifest = z.object({ generator: z.literal('wasmgen'), files: z.array(z.string()) }).parse(JSON.parse(await readFile(path.join(output, '.wasmgen.json'), 'utf8')) as unknown); }
  catch { throw new Error(`refusing to replace output not owned by wasmgen: ${output}`); }
  const owned = new Set([...manifest.files, '.wasmgen.json']);
  for (const file of files) if (!owned.has(file)) throw new Error(`refusing to delete unmanaged output file: ${file}`);
  return true;
}

export async function withOutput(output: string, build: (staging: string, result: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const lock = output + '.wasmgen-lock';
  try { await mkdir(lock); }
  catch (error) {
    if (hasCode(error, 'EEXIST')) throw new Error(`another generation owns ${lock}; remove it only if no generator is running`);
    throw error;
  }
  let staging: string | undefined;
  let backup: string | undefined;
  let preserveStaging = false;
  const failures: unknown[] = [];
  try {
    await inspectOutput(output);
    staging = await mkdtemp(path.join(parent, '.wasmgen-stage-'));
    const result = path.join(staging, 'output');
    await mkdir(result);
    await build(staging, result);
    await writeFile(path.join(result, '.wasmgen.json'), JSON.stringify({ generator: 'wasmgen', version: 1, files: await filesIn(result) }, null, 2) + '\n');
    signal?.throwIfAborted();
    // Check again: an editor may have added an unmanaged file during compilation.
    if (await inspectOutput(output)) {
      backup = path.join(staging, 'previous');
      await rename(output, backup);
    }
    try { await rename(result, output); }
    catch (error) {
      if (backup) {
        try { await rename(backup, output); }
        catch (restoreError) {
          preserveStaging = true;
          throw new AggregateError([error, restoreError], `cannot restore previous output; preserved at ${backup}`);
        }
      }
      throw error;
    }
  } catch (error) {
    failures.push(error);
  } finally {
    for (const directory of [preserveStaging ? undefined : staging, lock]) {
      if (!directory) continue;
      try { await rm(directory, { recursive: true, force: true }); }
      catch (error) { failures.push(error); }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures.map(errorMessage).join('; '), { cause: failures[0] });
}
