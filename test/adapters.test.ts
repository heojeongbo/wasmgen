import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as processes from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { run } from '../src/process.js';
import type { ResolvedInput } from '../src/model/config.js';
import type { BuildContext } from '../src/ports/language.js';

let execute: typeof run;
let remove: typeof fs.rm = fs.rm;
mock.module('node:fs/promises', { namedExports: { ...fs, rm: (...args: Parameters<typeof fs.rm>) => remove(...args) } });
// Mock only the OS boundary. Keeping the real process wrapper also avoids
// attributing a synthetic module's V8 ranges to production source coverage.
mock.module('node:child_process', { namedExports: { ...processes, spawn: (tool: string, args: string[], options: processes.SpawnOptions) => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  queueMicrotask(() => {
    void execute(tool, args, { env: options.env, cwd: options.cwd?.toString(), signal: options.signal }).then(
      result => { child.stdout.end(result); child.emit('close', 0, null); },
      (error: unknown) => { child.stderr.end(String(error)); child.emit('close', 1, null); },
    );
  });
  return child;
} } });
const { goAdapter } = await import('../src/adapters/go/compiler.js');
const { cppAdapter } = await import('../src/adapters/cpp/compiler.js');
const { rustAdapter } = await import('../src/adapters/rust/compiler.js');
const { preparePackage } = await import('../src/adapters/rust/package.js');

async function fixture(t: TestContext, language: ResolvedInput['language']) {
  remove = fs.rm;
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'output');
  const scratch = path.join(root, 'scratch');
  const native = path.join(root, 'native');
  const goroot = path.join(root, 'goroot');
  for (const dir of [directory, scratch, native, goroot]) await mkdir(dir);
  const source = path.join(native, language === 'go' ? 'source.go' : language === 'rust' ? 'lib.rs' : 'source.cc');
  await writeFile(source, '// native fixture');
  const mod: ResolvedInput = { name: 'sample', language, files: [source], headers: [path.join(native, 'api.h')], include: [native], exports: [
    { name: 'scalar', symbol: 'Scalar', params: [{ name: 'value', type: 'f64' }], result: 'f64', error: false },
    { name: 'array', symbol: 'Array', params: [{ name: 'values', type: 'f64[]' }], result: 'f64[]', error: true },
    { name: 'notify', symbol: 'Notify', params: [], result: 'void', error: false },
    { name: 'notifyError', symbol: 'NotifyError', params: [], result: 'void', error: true },
  ] };
  const context: BuildContext = { directory, scratch, tools: {}, signal: new AbortController().signal };
  const calls: Array<{ tool: string; args: string[]; options: Parameters<typeof run>[2] }> = [];
  let metadata: unknown = { Name: 'sample', Dir: native, ImportPath: 'module/internal/sample', Module: { Dir: native } };
  execute = async (tool, args, options) => {
    calls.push({ tool, args, options });
    if (args[0] === 'list' || args[0] === 'metadata') return JSON.stringify(metadata);
    if (args[0] === 'env') return goroot;
    if (args[0] === '--version') return 'wasm-bindgen 0.2.130';
    return '';
  };
  return { root, native, goroot, mod, context, calls, metadata: (value: unknown) => { metadata = value; } };
}

test('Go compiles isolated sources and selects either supported runtime layout', async (t) => {
  for (const modern of [true, false]) {
    const f = await fixture(t, 'go');
    const relative = modern ? 'lib/wasm' : 'misc/wasm';
    await mkdir(path.join(f.goroot, relative), { recursive: true });
    await writeFile(path.join(f.goroot, relative, 'wasm_exec.js'), 'runtime');
    if (modern) await writeFile(path.join(f.goroot, 'LICENSE'), 'toolchain license');
    else f.context.tools.go = '/tools/custom-go';
    const compiled = await goAdapter.build(f.mod, f.context);
    assert.match(compiled.workerSource, /new globalThis.Go/);
    assert.equal(await readFile(path.join(f.context.directory, 'go-runtime.js'), 'utf8'), 'runtime');
    assert((await readFile(path.join(f.context.directory, 'GO-LICENSE'), 'utf8')).length > 0);
    const build = f.calls[0]!;
    assert.equal(build.tool, modern ? 'go' : '/tools/custom-go');
    assert.deepEqual(build.options?.env && [build.options.env['GOOS'], build.options.env['GOARCH'], build.options.env['CGO_ENABLED'], build.options.env['GOWORK']], ['js', 'wasm', '0', 'off']);
    assert.equal(build.options?.signal, f.context.signal);
    assert(build.args.includes('-trimpath'));
    assert.match(await readFile(path.join(f.context.scratch, 'main.go'), 'utf8'), /return nil, native.NotifyError/);
  }
});

test('Go package wrappers preserve internal visibility and are removed on failure', async (t) => {
  const f = await fixture(t, 'go');
  f.mod.package = f.native;
  f.mod.files = [];
  await assert.rejects(goAdapter.build(f.mod, f.context), /runtime not found/);
  const build = f.calls.find(call => call.args[0] === 'build')!;
  assert(build.options?.cwd?.startsWith(f.native + '/.wasmgen-'));
  assert.deepEqual(await readdir(f.native), ['source.go']);
  assert.equal(build.options?.env?.['GOWORK'], process.env['GOWORK']);
  for (const metadata of [
    { Name: 'main', Dir: f.native, ImportPath: 'main', Module: { Dir: f.native } },
    { Name: 'sample', Dir: f.native, ImportPath: 'module/sample' },
  ]) {
    f.metadata(metadata);
    await assert.rejects(goAdapter.build(f.mod, f.context), /importable Go module/);
  }
});

test('Go file staging cannot silently overwrite an earlier source', async (t) => {
  const f = await fixture(t, 'go');
  await mkdir(path.join(f.native, 'second'));
  const second = path.join(f.native, 'second/source.go');
  await writeFile(second, '// must not replace the first input');
  f.mod.files.push(second);
  await assert.rejects(goAdapter.build(f.mod, f.context), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST');
  assert.equal(await readFile(path.join(f.context.scratch, 'native/source.go'), 'utf8'), '// native fixture');
  assert.equal(f.calls.length, 0, 'must stop before compiling a partial source set');
});

test('Go propagates runtime and license IO failures instead of hiding them as missing files', async (t) => {
  for (const failure of ['runtime', 'license']) {
    const f = await fixture(t, 'go');
    await mkdir(path.join(f.goroot, 'lib/wasm'), { recursive: true });
    if (failure === 'runtime') await mkdir(path.join(f.goroot, 'lib/wasm/wasm_exec.js'));
    else { await writeFile(path.join(f.goroot, 'lib/wasm/wasm_exec.js'), 'runtime'); await mkdir(path.join(f.goroot, 'LICENSE')); }
    await assert.rejects(goAdapter.build(f.mod, f.context), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EISDIR');
  }
});

test('Go wrapper cleanup preserves compilation errors and reports cleanup-only failures', async (t) => {
  for (const failBuild of [true, false]) {
    const f = await fixture(t, 'go');
    f.mod.package = f.native;
    f.mod.files = [];
    await mkdir(path.join(f.goroot, 'lib/wasm'), { recursive: true });
    await writeFile(path.join(f.goroot, 'lib/wasm/wasm_exec.js'), 'runtime');
    const compile = execute;
    execute = async (tool, args, options) => {
      if (failBuild && args[0] === 'build') throw new Error('native compilation failed');
      return compile(tool, args, options);
    };
    const cleanup = new Error('cannot remove temporary Go wrapper');
    const attempts: string[] = [];
    remove = async file => { attempts.push(String(file)); throw cleanup; };
    await assert.rejects(goAdapter.build(f.mod, f.context), failure => {
      if (!failBuild) return failure === cleanup;
      assert(failure instanceof AggregateError);
      assert.equal(failure.errors.length, 2);
      assert.equal(failure.errors[1], cleanup);
      assert.equal(failure.cause, failure.errors[0]);
      assert.match(failure.message, /native compilation failed/);
      assert.match(failure.message, /cannot remove temporary Go wrapper/);
      return true;
    });
    assert.equal(attempts.length, 1);
    assert(attempts[0]?.startsWith(f.native + '/.wasmgen-'));
    assert((await readdir(f.native)).some(entry => entry.startsWith('.wasmgen-')));
  }
});

test('C++ compilation passes includes as arguments and links without dynamic JS execution', async (t) => {
  for (const custom of [false, true]) {
    const f = await fixture(t, 'cpp');
    f.mod.headers.push(path.join(f.native, 'with "quotes" and \\backslash.h'));
    f.mod.headers.push(path.join(f.native, 'with >bracket.h'));
    if (custom) f.context.tools.cpp = '/tools/custom-em++';
    const compiled = await cppAdapter.build(f.mod, f.context);
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[0]?.tool, custom ? '/tools/custom-em++' : 'em++');
    assert.deepEqual(f.calls[0]?.args.slice(-2), ['-I', f.native]);
    assert(f.calls[0]?.args.includes('-std=c++17'));
    assert(f.calls[2]?.args.includes('-sDYNAMIC_EXECUTION=0'));
    assert(f.calls.every(call => call.options?.signal === f.context.signal));
    assert.match(compiled.workerSource, /"scalar": native.wasmgen_call_0/);
    const bridge = await readFile(path.join(f.context.scratch, 'bridge.cc'), 'utf8');
    assert(bridge.includes(`#include <${f.mod.headers[1]}>`));
    assert(bridge.includes(`#include "${f.mod.headers[2]}"`));
    assert.match(bridge, /std::vector<double>/);
    assert.match(bridge, /val::undefined/);
    assert.equal((await readdir(path.join(f.context.directory, 'licenses'))).length, 5);
  }
});

test('Rust compiles an isolated crate with matching bindgen version and owned vector conversions', async (t) => {
  for (const custom of [false, true]) {
    const f = await fixture(t, 'rust');
    if (custom) f.context.tools = { cargo: '/tools/cargo', wasmBindgen: '/tools/bindgen' };
    const compiled = await rustAdapter.build(f.mod, f.context);
    assert.match(await readFile(path.join(f.context.scratch, 'Cargo.toml'), 'utf8'), /wasm-bindgen = "=0.2.130"/);
    const bridge = await readFile(path.join(f.context.scratch, 'bridge.rs'), 'utf8');
    assert.match(bridge, /arg0.into_vec\(\)/);
    assert.match(bridge, /Ok\(value.into_boxed_slice\(\)\)/);
    assert.match(compiled.workerSource, /Array.from\(value\)/);
    assert.equal(f.calls[0]?.tool, custom ? '/tools/bindgen' : 'wasm-bindgen');
    assert.equal(f.calls[1]?.tool, custom ? '/tools/cargo' : 'cargo');
    assert(f.calls[1]?.args.includes('wasm32-unknown-unknown'));
    assert(f.calls.every(call => call.options?.signal === f.context.signal));
    assert.equal((await readdir(path.join(f.context.directory, 'licenses'))).length, 5);
  }
});

test('Rust rejects unstable bindgen versions and missing source roots before compilation', async (t) => {
  const f = await fixture(t, 'rust');
  execute = async () => 'wasm-bindgen 0.2.130-beta';
  await assert.rejects(rustAdapter.build(f.mod, f.context), /expected a stable/);
  f.mod.files = [];
  await assert.rejects(preparePackage(f.mod, f.context), /crate root is missing/);
});

test('Rust package metadata selects libraries and seeds only the temporary lockfile', async (t) => {
  const f = await fixture(t, 'rust');
  f.mod.package = f.native;
  await writeFile(path.join(f.native, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.1.0"\n');
  const entry = { name: 'fixture', manifest_path: path.join(f.native, 'Cargo.toml'), targets: [{ kind: ['lib'] }] };
  const metadata = (packages: unknown[]) => f.metadata({ workspace_root: f.native, packages });
  metadata([entry]);
  const prepared = await preparePackage(f.mod, f.context);
  assert.equal(prepared.name, 'fixture');
  assert.equal(prepared.directory, f.native);
  assert.equal(prepared.overrides.trim(), '');
  await writeFile(path.join(f.native, 'Cargo.lock'), 'original lock');
  await preparePackage(f.mod, f.context);
  assert.equal(await readFile(path.join(f.context.scratch, 'Cargo.lock'), 'utf8'), 'original lock');
  assert.equal(await readFile(path.join(f.native, 'Cargo.lock'), 'utf8'), 'original lock');
  f.context.tools.cargo = '/tools/cargo';
  metadata([{ ...entry, targets: [{ kind: ['rlib'] }] }]);
  await preparePackage(f.mod, f.context);
  assert.equal(f.calls.at(-1)?.tool, '/tools/cargo');
  for (const packages of [[], [{ ...entry, manifest_path: '/different/Cargo.toml' }], [{ ...entry, targets: [{ kind: ['bin'] }] }]]) {
    metadata(packages);
    await assert.rejects(preparePackage(f.mod, f.context), /must select a library crate/);
  }
  metadata([entry]);
  await rm(path.join(f.native, 'Cargo.lock'));
  await mkdir(path.join(f.native, 'Cargo.lock'));
  await assert.rejects(preparePackage(f.mod, f.context), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EISDIR');
});
