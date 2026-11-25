import type { ResolvedInput } from '../../model/config.js';
import type { BuildContext, CompilerAdapter } from '../compiler.js';
import { cppBridge } from './bridge.js';
import { workerSource } from './worker.js';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../../process.js';

async function build(mod: ResolvedInput, { directory, scratch, tools, signal }: BuildContext): Promise<void> {
  const bridge = path.join(scratch, 'bridge.cc');
  await writeFile(bridge, cppBridge(mod));
  const compiler = tools.cpp ?? 'em++';
  const objects = [];
  for (const [index, source] of [...mod.files, bridge].entries()) {
    const object = path.join(scratch, `unit-${index}.o`);
    await run(compiler, [
      '-c', source, '-o', object, '-std=c++17', '-O3', '-flto', '-fexceptions', '-Wall', '-Werror', '-sSTRICT',
      ...mod.include.flatMap((directory) => ['-I', directory]),
    ], { signal });
    objects.push(object);
  }
  await run(compiler, [
    ...objects, '-O3', '-flto', '-fexceptions', '-lembind', '--no-entry',
    '-sSTRICT', '-sEXPORT_ES6', '-sENVIRONMENT=worker',
    '-sINCOMING_MODULE_JS_API=locateFile',
    '-sALLOW_MEMORY_GROWTH', '-sFILESYSTEM=0',
    '-o', path.join(directory, 'native.js'),
  ], { signal });
  const licenses = path.join(directory, 'licenses');
  await mkdir(licenses);
  for (const name of ['EMSCRIPTEN-LICENSE', 'MUSL-COPYRIGHT', 'LIBCXX-LICENSE', 'LIBCXXABI-LICENSE', 'COMPILER-RT-LICENSE']) {
    await copyFile(new URL(`../../licenses/${name}`, import.meta.url), path.join(licenses, name));
  }
}

export const cppAdapter: CompilerAdapter = { language: 'cpp', build, workerSource };
