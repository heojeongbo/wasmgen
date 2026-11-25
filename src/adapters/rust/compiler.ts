import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedInput } from '../../model/config.js';
import type { BuildContext, CompiledModule, LanguageAdapter } from '../../ports/language.js';
import { run } from '../../process.js';
import { validateInput } from './config.js';
import { rustBridge } from './bridge.js';
import { preparePackage } from './package.js';
import { workerSource } from './worker.js';

async function build(input: ResolvedInput, context: BuildContext): Promise<CompiledModule> {
  const { directory, scratch, tools, signal } = context;
  const cargo = tools.cargo ?? 'cargo';
  const bindgen = tools.wasmBindgen ?? 'wasm-bindgen';
  const versionOutput = await run(bindgen, ['--version'], { signal });
  const version = /^wasm-bindgen (\d+\.\d+\.\d+)$/.exec(versionOutput)?.[1];
  if (!version) throw new Error(`${input.name}: expected a stable wasm-bindgen CLI version, received ${versionOutput}`);
  const native = await preparePackage(input, context);
  const manifest = path.join(scratch, 'Cargo.toml');
  await writeFile(manifest, `[package]
name = "wasmgen-bridge"
version = "0.0.0"
edition = "2021"
publish = false
[lib]
path = "bridge.rs"
crate-type = ["cdylib"]
[workspace]
[dependencies]
wasm-bindgen = "=${version}"
wasmgen_native = { package = ${JSON.stringify(native.name)}, path = ${JSON.stringify(native.directory)} }
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
strip = "debuginfo"
`);
  await writeFile(path.join(scratch, 'bridge.rs'), rustBridge(input));
  const target = path.join(scratch, 'target');
  await run(cargo, [
    'build', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', manifest, '--target-dir', target,
  ], { cwd: input.package ?? scratch, signal });
  await run(bindgen, [
    path.join(target, 'wasm32-unknown-unknown/release/wasmgen_bridge.wasm'),
    '--target', 'web', '--out-dir', directory, '--out-name', 'native', '--no-typescript',
  ], { signal });
  const licenses = path.join(directory, 'licenses');
  await mkdir(licenses);
  for (const name of ['RUST-LICENSE-MIT', 'RUST-LICENSE-APACHE', 'RUST-COPYRIGHT', 'WASM-BINDGEN-LICENSE-MIT', 'WASM-BINDGEN-LICENSE-APACHE']) {
    await copyFile(new URL(`../../licenses/${name}`, import.meta.url), path.join(licenses, name));
  }
  return { workerSource: workerSource(input) };
}

export const rustAdapter: LanguageAdapter<'rust'> = { language: 'rust', validateInput, build };
