import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : Promise.resolve([path.join(directory, entry.name)])));
  return nested.flat();
}

const failures: string[] = [];
const rank: Record<string, number> = { app: 4, pages: 3, features: 2, shared: 1 };
const web = path.resolve('examples/web/src');
const maintained = [...await files('src'), ...await files('examples/web/src'), ...await files('scripts'), ...await files('test'), ...await files('benchmarks')];
for (const filename of maintained) {
  if (/\.(?:c|m)?js$/.test(filename)) failures.push(`${filename}: maintained JavaScript must be TypeScript; generated JavaScript belongs in output directories`);
}
const sources = maintained.filter((file) => file.endsWith('.ts'));
for (const filename of sources) {
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  if (/@ts-(?:ignore|nocheck)\b/.test(source)) failures.push(`${filename}: type checking must not be disabled`);
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) failures.push(`${filename}: explicit any is not allowed`);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (filename.startsWith('src/application/') || filename.startsWith('src/codegen/') || filename === 'src/config.ts') {
        if (/adapters\//.test(specifier) || /languages\.js$/.test(specifier)) failures.push(`${filename}: concrete language integrations belong in the composition root`);
      }
      if (filename.startsWith('src/codegen/') && /ports\//.test(specifier)) failures.push(`${filename}: web codegen must not depend on a compiler port`);
      if (filename.startsWith('src/ports/') && !specifier.startsWith('../model/')) failures.push(`${filename}: ports must depend only on the model`);
      if (filename.startsWith('src/adapters/') && specifier.startsWith('.')) {
        const owner = filename.split('/')[2];
        const target = path.relative(path.resolve('src/adapters'), path.resolve(path.dirname(filename), specifier));
        if (!target.startsWith('..') && target.split(path.sep)[0] !== owner) failures.push(`${filename}: language adapters must not depend on each other`);
      }
      if (filename.startsWith('src/runtime/') && !specifier.startsWith('./') && specifier !== '../model/value-types.js') failures.push(`${filename}: browser runtime depends on build-time code`);
      if (filename.startsWith('src/model/') && specifier.startsWith('.') && !specifier.startsWith('./')) failures.push(`${filename}: model depends on an outer layer`);
      if (filename.startsWith('examples/web/src/') && specifier.startsWith('.')) {
        const from = path.relative(web, path.resolve(filename)).split(path.sep);
        const target = path.resolve(path.dirname(filename), specifier);
        if (target.startsWith(web + path.sep)) {
          const to = path.relative(web, target).split(path.sep);
          const fromLayer = from[0] ?? '';
          const toLayer = to[0] ?? '';
          if ((rank[toLayer] ?? Infinity) > (rank[fromLayer] ?? -1)) failures.push(`${filename}: upward FSD import ${specifier}`);
          if (fromLayer === toLayer && from[1] !== to[1] && !['app', 'shared'].includes(fromLayer)) failures.push(`${filename}: cross-slice import ${specifier}`);
          if (fromLayer !== toLayer && path.basename(target) !== 'index.js') failures.push(`${filename}: cross-layer import must use a public index`);
        } else if (!filename.startsWith('examples/web/src/shared/api/')) failures.push(`${filename}: generated bindings must enter through the shared API adapter`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
if (failures.length) throw new Error(failures.join('\n'));
process.stdout.write(`Architecture checks passed (${sources.length} TypeScript files): compiler ports, runtime isolation, FSD direction/public APIs, no any.\n`);
