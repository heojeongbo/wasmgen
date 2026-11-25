import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify, type TomlTable, type TomlValue } from 'smol-toml';

function table(value: TomlValue, at: string): TomlTable {
  if (typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    throw new Error(`${at}: expected a TOML table`);
  }
  return value;
}

function rebaseDependencies(value: TomlValue, root: string, at: string): TomlTable {
  return Object.fromEntries(Object.entries(table(value, at)).map(([name, dependency]) => {
    if (typeof dependency === 'string') return [name, dependency];
    const spec = table(dependency, `${at}.${name}`);
    if (spec['path'] === undefined) return [name, spec];
    if (typeof spec['path'] !== 'string') throw new Error(`${at}.${name}.path: expected a string`);
    return [name, { ...spec, path: path.resolve(root, spec['path']) }];
  }));
}

/** Cargo reads overrides only at the root of the dependency graph being built. */
export async function readWorkspaceOverrides(root: string): Promise<string> {
  const manifest = parse(await readFile(path.join(root, 'Cargo.toml'), 'utf8'));
  const overrides: TomlTable = {};
  if (manifest['patch'] !== undefined) {
    overrides['patch'] = Object.fromEntries(Object.entries(table(manifest['patch'], 'patch')).map(
      ([source, dependencies]) => [source, rebaseDependencies(dependencies, root, `patch.${source}`)],
    ));
  }
  if (manifest['replace'] !== undefined) overrides['replace'] = rebaseDependencies(manifest['replace'], root, 'replace');
  return stringify(overrides);
}
