import type { Language, ResolvedInput, Tools } from '../model/config.js';

export interface BuildContext { directory: string; scratch: string; tools: Tools; signal?: AbortSignal }
export interface CompilerAdapter {
  readonly language: Language;
  build(mod: ResolvedInput, context: BuildContext): Promise<void>;
  workerSource(): string;
}
export type CompilerAdapters = Readonly<Record<Language, CompilerAdapter>>;
