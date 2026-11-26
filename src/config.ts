import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { z } from 'zod';
import { configSchema, type ResolvedConfig, type ResolvedInput } from './model/config.js';
import type { InputValidators } from './ports/language.js';
import { errorMessage, hasCode } from './shared/errors.js';

function formatIssue(issue: z.ZodIssue): string {
  const at = issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('');
  const details = issue.code === 'invalid_key' ? ` (${issue.issues.map((nested) => nested.message).join('; ')})` : '';
  return `${at || 'config'}: ${issue.message}${details}`;
}

async function requirePath(file: string, kind: 'file' | 'directory', at: string): Promise<void> {
  let info;
  try { info = await stat(file); }
  catch (error) {
    const detail = hasCode(error, 'ENOENT') ? `${kind} not found: ${file}` : `cannot access ${file}: ${errorMessage(error)}`;
    throw new Error(`${at}: ${detail}`, { cause: error });
  }
  if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error(`${at}: input is not a ${kind}: ${file}`);
}

function inputPaths(configPath: string, input: ResolvedInput[]): string[] {
  return [path.resolve(configPath), ...input.flatMap((mod) => [...mod.files, ...mod.headers, ...mod.include, ...(mod.package ? [mod.package] : [])])];
}

function checkOutputPaths(output: string, inputs: string[]): void {
  for (const file of inputs) {
    const rel = path.relative(output, file);
    if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) throw new Error(`config.output: must not contain input ${file}`);
  }
}

// Output may not exist yet. Resolve its nearest existing ancestor so symlinked
// parents cannot disguise an input directory as a separate output location.
async function physicalPath(file: string): Promise<string> {
  try { return await realpath(file); }
  catch (error) {
    const parent = path.dirname(file);
    if (!hasCode(error, 'ENOENT') || parent === file) throw error;
    return path.join(await physicalPath(parent), path.basename(file));
  }
}

export function validateConfig(value: unknown, configPath: string, validators: InputValidators): ResolvedConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid config: ${parsed.error.issues.map(formatIssue).join('; ')}`, { cause: parsed.error });
  const raw = parsed.data;
  const root = path.dirname(path.resolve(configPath));
  const output = path.resolve(root, raw.output);
  const names = new Set<string>();
  const input = raw.input.map((entry): ResolvedInput => {
    const at = entry.name;
    if (names.has(at.toLowerCase())) throw new Error(`${at}: duplicate module (names must be unique ignoring case)`);
    names.add(at.toLowerCase());
    const resolve = (files: string[] = []) => files.map((file) => path.resolve(root, file));
    const files = resolve(entry.files);
    const headers = resolve(entry.headers);
    const include = resolve(entry.include);
    const pkg = entry.package ? path.resolve(root, entry.package) : undefined;
    // Adapter path rules must see the config directory as well as user entries.
    validators[entry.language].validateInput({ ...entry, files: entry.files && files, headers: entry.headers && headers, include: entry.include && include, package: pkg });
    const exports = Object.entries(entry.exports).map(([name, fn]) => {
      const symbol = fn.symbol ?? name;
      if (new Set(fn.params.map((param) => param.name)).size !== fn.params.length) throw new Error(`${at}.${name}: duplicate parameter`);
      return { name, symbol, params: fn.params, result: fn.result, error: fn.error ?? false };
    });
    return { name: at, language: entry.language, files, headers, include, package: pkg, exports };
  });
  checkOutputPaths(output, inputPaths(configPath, input));
  return { version: 1, input, output, root, tools: raw.tools };
}

export async function readConfig(configPath: string, validators: InputValidators): Promise<ResolvedConfig> {
  const absolute = path.resolve(configPath);
  try {
    const doc = parseDocument(await readFile(absolute, 'utf8'), { uniqueKeys: true });
    if (doc.errors[0]) throw new Error(`invalid config: ${doc.errors[0].message}`, { cause: doc.errors[0] });
    const config = validateConfig(doc.toJS({ maxAliasCount: 0 }) as unknown, absolute, validators);
    for (const mod of config.input) {
      for (const key of ['files', 'headers'] as const) {
        for (const [index, file] of mod[key].entries()) await requirePath(file, 'file', `${mod.name}.${key}[${index}]`);
      }
      for (const [index, dir] of mod.include.entries()) await requirePath(dir, 'directory', `${mod.name}.include[${index}]`);
      if (mod.package) await requirePath(mod.package, 'directory', `${mod.name}.package`);
    }
    checkOutputPaths(await physicalPath(config.output), await Promise.all(inputPaths(absolute, config.input).map((file) => realpath(file))));
    return config;
  } catch (error) {
    throw new Error(`${absolute}: ${errorMessage(error)}`, { cause: error });
  }
}
