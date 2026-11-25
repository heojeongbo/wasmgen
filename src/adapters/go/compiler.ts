import type { ResolvedInput } from '../../model/config.js';
import type { BuildContext, CompiledModule, LanguageAdapter } from '../../ports/language.js';
import { validateInput } from './config.js';
import { goBridge } from './bridge.js';
import { workerSource } from './worker.js';
import { z } from 'zod';
import { hasCode } from '../../shared/errors.js';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../../process.js';

async function build(mod: ResolvedInput, { directory, scratch, tools, signal }: BuildContext): Promise<CompiledModule> {
  const go = tools.go ?? 'go';
  const env = { ...process.env, GOOS: 'js', GOARCH: 'wasm', CGO_ENABLED: '0', ...(mod.package ? {} : { GOWORK: 'off' }) };
  let buildRoot = scratch;
  let externalBuild: string | undefined;
  let importPath = 'wasmgen.local/generated/native';
  try {
    if (mod.package) {
      const metadata = z.object({ Name: z.string(), Dir: z.string(), ImportPath: z.string(), Module: z.object({ Dir: z.string() }).optional() }).parse(JSON.parse(await run(go, ['list', '-json', '.'], { cwd: mod.package, env, signal })) as unknown);
      if (metadata.Name === 'main' || !metadata.Module?.Dir) throw new Error(`${mod.name}: package must be an importable Go module package`);
      importPath = metadata.ImportPath;
      // Keep the wrapper beneath the target package so the original module
      // settings and even nested internal-package visibility are preserved.
      externalBuild = await mkdtemp(path.join(metadata.Dir, '.wasmgen-'));
      buildRoot = externalBuild;
    } else {
      await mkdir(path.join(scratch, 'native'));
      await writeFile(path.join(scratch, 'go.mod'), 'module wasmgen.local/generated\n\ngo 1.22\n');
      for (const file of mod.files) await copyFile(file, path.join(scratch, 'native', path.basename(file)));
    }
    await writeFile(path.join(buildRoot, 'main.go'), goBridge(mod, importPath));
    await run(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(directory, 'native.wasm'), '.'], { cwd: buildRoot, env, signal });
    // Resolve GOROOT in the same module: Go's auto-selected toolchain may differ.
    const goroot = await run(go, ['env', 'GOROOT'], { cwd: buildRoot, env, signal });
    let runtime;
    for (const relative of ['lib/wasm/wasm_exec.js', 'misc/wasm/wasm_exec.js']) {
      try { runtime = await readFile(path.join(goroot, relative)); break; }
      catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
    }
    if (!runtime) throw new Error(`Go JavaScript runtime not found in ${goroot}`);
    await writeFile(path.join(directory, 'go-runtime.js'), runtime);
    try { await copyFile(path.join(goroot, 'LICENSE'), path.join(directory, 'GO-LICENSE')); }
    catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
      // Some OS distributions move GOROOT/LICENSE into their package documentation.
      await copyFile(new URL('../../licenses/GO-LICENSE', import.meta.url), path.join(directory, 'GO-LICENSE'));
    }
  } finally {
    if (externalBuild) await rm(externalBuild, { recursive: true, force: true });
  }
  return { workerSource: workerSource() };
}

export const goAdapter: LanguageAdapter<'go'> = { language: 'go', validateInput, build };
