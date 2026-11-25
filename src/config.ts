import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { configSchema, type ResolvedConfig, type ResolvedInput } from './model/config.js';
import type { InputValidators } from './ports/language.js';

export function validateConfig(value: unknown, configPath: string, validators: InputValidators): ResolvedConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid config: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const raw = parsed.data;
  const root = path.dirname(path.resolve(configPath));
  const output = path.resolve(root, raw.output);
  const names = new Set<string>();
  const input = raw.input.map((entry): ResolvedInput => {
    const at = entry.name;
    if (names.has(at)) throw new Error(`${at}: duplicate module`);
    names.add(at);
    validators[entry.language].validateInput(entry);
    const resolve = (files: string[] = []) => files.map((file) => path.resolve(root, file));
    const files = resolve(entry.files);
    const headers = resolve(entry.headers);
    const include = resolve(entry.include);
    const pkg = entry.package ? path.resolve(root, entry.package) : undefined;
    const exports = Object.entries(entry.exports).map(([name, fn]) => {
      const symbol = fn.symbol ?? name;
      if (new Set(fn.params.map((param) => param.name)).size !== fn.params.length) throw new Error(`${at}.${name}: duplicate parameter`);
      return { name, symbol, params: fn.params, result: fn.result, error: fn.error ?? false };
    });
    return { name: at, language: entry.language, files, headers, include, package: pkg, exports };
  });
  for (const file of [path.resolve(configPath), ...input.flatMap((mod) => [...mod.files, ...mod.headers, ...mod.include, ...(mod.package ? [mod.package] : [])])]) {
    const rel = path.relative(output, file);
    if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) throw new Error(`config.output: must not contain input ${file}`);
  }
  return { version: 1, input, output, root, tools: raw.tools };
}

export async function readConfig(configPath: string, validators: InputValidators): Promise<ResolvedConfig> {
  const absolute = path.resolve(configPath);
  const doc = parseDocument(await readFile(absolute, 'utf8'), { uniqueKeys: true });
  if (doc.errors[0]) throw new Error(`invalid config: ${doc.errors[0].message}`);
  const config = validateConfig(doc.toJS({ maxAliasCount: 0 }) as unknown, absolute, validators);
  for (const mod of config.input) {
    for (const file of [...mod.files, ...mod.headers]) if (!(await stat(file)).isFile()) throw new Error(`input is not a file: ${file}`);
    for (const dir of [...mod.include, ...(mod.package ? [mod.package] : [])]) if (!(await stat(dir)).isDirectory()) throw new Error(`input is not a directory: ${dir}`);
  }
  return config;
}
