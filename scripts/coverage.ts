import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const command = (file: string, args: string[]) => {
  const result = spawnSync(file, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
command('pnpm', ['run', 'build']);
command('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--sourceMap', '--inlineSources']);
await rm('.test-build', { recursive: true, force: true });
command('pnpm', ['exec', 'tsc', '-p', 'test/tsconfig.json', '--sourceMap', '--inlineSources']);
await cp('src/licenses', '.test-build/src/licenses', { recursive: true });
await cp('LICENSE', '.test-build/LICENSE');
const reports = '.artifacts/coverage';
await mkdir(reports, { recursive: true });
// Type-only modules emit an empty ESM marker. They contain no executable code;
// derive this list from compiler output so new runtime code cannot stay excluded.
async function modules(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await modules(file));
    else if (entry.name.endsWith('.js')) files.push(file);
  }
  return files;
}
const compiled = await modules('dist');
const empty: string[] = [];
for (const file of compiled) {
  const emitted = (await readFile(file, 'utf8')).replace(/\/\/# sourceMappingURL=.*$/m, '').trim();
  if (emitted === 'export {};') empty.push(file);
}
const sourcePath = (file: string) => file.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
await writeFile(path.join(reports, 'scope.json'), JSON.stringify({
  sourceRoot: 'src', runtimeFiles: compiled.filter(file => !empty.includes(file)).map(sourcePath).sort(),
  typeOnlyFiles: empty.map(sourcePath), thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
}, null, 2) + '\n');
const exclusions = empty.flatMap(file => ['--exclude', file, '--exclude', file.replace(/^dist\//, '.test-build/src/')]);
const tests = (await readdir('.test-build/test')).filter(file => file.endsWith('.test.js')).sort().map(file => `.test-build/test/${file}`);
command('pnpm', ['exec', 'c8', '--all', '--src', 'dist', '--include', 'dist/**/*.js', '--include', '.test-build/src/**/*.js',
  '--extension', '.js', ...exclusions, '--100', '--per-file',
  '--reporter', 'text', '--reporter', 'html', '--reporter', 'json', '--reporter', 'json-summary',
  '--reports-dir', reports, process.execPath, '--experimental-test-module-mocks', '--test', ...tests]);
const coverage: Record<string, unknown> = JSON.parse(await readFile(path.join(reports, 'coverage-final.json'), 'utf8')) as Record<string, unknown>;
const measured = Object.keys(coverage).map(file => path.relative(process.cwd(), file)).sort();
assert.deepEqual(measured, compiled.filter(file => !empty.includes(file)).map(sourcePath).sort(), 'coverage must include every executable production module');
