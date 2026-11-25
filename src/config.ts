import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { configSchema, type ResolvedConfig, type ResolvedInput } from './model/config.js';

export function validateConfig(value: unknown, configPath: string): ResolvedConfig {
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
    const resolve = (files: string[] = []) => files.map((file) => path.resolve(root, file));
    const files = resolve(entry.files);
    const headers = resolve(entry.headers);
    const include = resolve(entry.include);
    let pkg: string | undefined;
    if (entry.language === 'go') {
      if (headers.length || include.length) throw new Error(`${at}: headers/include are only for C++`);
      if (Boolean(entry.package) === Boolean(files.length)) throw new Error(`${at}: Go requires exactly one of files or package`);
      if (entry.package) pkg = path.resolve(root, entry.package);
      if (files.some((file) => !file.endsWith('.go') || file.endsWith('_test.go'))) throw new Error(`${at}: expected non-test .go files`);
      if (new Set(files.map((file) => path.basename(file))).size !== files.length) throw new Error(`${at}: duplicate Go basenames`);
    } else {
      if (entry.package) throw new Error(`${at}: package is only valid for Go`);
      if (!headers.length) throw new Error(`${at}: C++ requires declarations in at least one header`);
    }
    const exports = Object.entries(entry.exports).map(([name, fn]) => {
      const symbol = fn.symbol ?? name;
      const pattern = entry.language === 'go' ? /^[A-Z][A-Za-z0-9_]*$/ : /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/;
      if (!pattern.test(symbol)) throw new Error(`${at}.${name}: invalid ${entry.language} symbol ${symbol}`);
      if (entry.language !== 'go' && fn.error !== undefined) throw new Error(`${at}.${name}: error is only valid for Go`);
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

export async function readConfig(configPath: string): Promise<ResolvedConfig> {
  const absolute = path.resolve(configPath);
  const doc = parseDocument(await readFile(absolute, 'utf8'), { uniqueKeys: true });
  if (doc.errors[0]) throw new Error(`invalid config: ${doc.errors[0].message}`);
  const config = validateConfig(doc.toJS({ maxAliasCount: 0 }) as unknown, absolute);
  for (const mod of config.input) {
    for (const file of [...mod.files, ...mod.headers]) if (!(await stat(file)).isFile()) throw new Error(`input is not a file: ${file}`);
    for (const dir of [...mod.include, ...(mod.package ? [mod.package] : [])]) if (!(await stat(dir)).isDirectory()) throw new Error(`input is not a directory: ${dir}`);
  }
  return config;
}
