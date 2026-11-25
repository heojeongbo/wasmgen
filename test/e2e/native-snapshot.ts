import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function nativeSnapshot(directory: string, prefix = ''): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(snapshot, await nativeSnapshot(filename, relative + '/'));
    else if (entry.isFile()) snapshot[relative] = createHash('sha256').update(await readFile(filename)).digest('hex');
    else throw new Error(`unexpected native fixture type: ${relative}`);
  }
  return snapshot;
}
