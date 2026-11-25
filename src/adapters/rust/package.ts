import { copyFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ResolvedInput } from '../../model/config.js';
import type { BuildContext } from '../../ports/language.js';
import { run } from '../../process.js';
import { hasCode } from '../../shared/errors.js';

const metadataSchema = z.object({
  workspace_root: z.string(),
  packages: z.array(z.object({
    name: z.string(), manifest_path: z.string(),
    targets: z.array(z.object({ kind: z.array(z.string()) })),
  })),
});

export async function preparePackage(input: ResolvedInput, context: BuildContext): Promise<{ name: string; directory: string }> {
  if (input.package) {
    const manifest = await realpath(path.join(input.package, 'Cargo.toml'));
    const metadata = metadataSchema.parse(JSON.parse(await run(context.tools.cargo ?? 'cargo', [
      'metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifest,
    ], { cwd: input.package, signal: context.signal })) as unknown);
    const entry = metadata.packages.find((pkg) => path.resolve(pkg.manifest_path) === manifest);
    if (!entry || !entry.targets.some((target) => target.kind.some((kind) => ['lib', 'rlib'].includes(kind)))) {
      throw new Error(`${input.name}: Rust package must select a library crate, not a virtual workspace or binary-only package`);
    }
    // Seed dependency resolution without modifying the original workspace lockfile.
    try { await copyFile(path.join(metadata.workspace_root, 'Cargo.lock'), path.join(context.scratch, 'Cargo.lock')); }
    catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
    return { name: entry.name, directory: input.package };
  }

  const source = input.files[0];
  if (!source) throw new Error(`${input.name}: Rust crate root is missing`);
  const directory = path.join(context.scratch, 'native');
  await mkdir(directory);
  // A separate crate preserves crate:: paths and relative mod declarations.
  await writeFile(path.join(directory, 'Cargo.toml'), `[package]
name = "wasmgen-native"
version = "0.0.0"
edition = "2021"
publish = false
[lib]
path = ${JSON.stringify(source)}
`);
  return { name: 'wasmgen-native', directory };
}
