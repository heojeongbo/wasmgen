import type { Language, ParsedInput, ResolvedConfig, ResolvedInput, Tools } from '../model/config.js';

export interface BuildContext {
  directory: string;
  scratch: string;
  tools: Tools;
  signal?: AbortSignal;
}

/** The adapter writes its native assets into directory and supplies their initializer. */
export interface CompiledModule { workerSource: string }

export interface InputValidator { validateInput(input: ParsedInput): void }
export type InputValidators = Readonly<Record<Language, InputValidator>>;

export interface LanguageCompiler<L extends Language = Language> {
  readonly language: L;
  build(input: ResolvedInput, context: BuildContext): Promise<CompiledModule>;
}

/** One language integration; consumers depend on only the capabilities they use. */
export interface LanguageAdapter<L extends Language = Language> extends LanguageCompiler<L>, InputValidator {}

export type LanguageCompilers = { readonly [L in Language]: LanguageCompiler<L> };
export type LanguageAdapters = { readonly [L in Language]: LanguageAdapter<L> };
export type ConfigReader = (configPath: string) => Promise<ResolvedConfig>;
