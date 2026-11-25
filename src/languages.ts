import { cppAdapter } from './adapters/cpp/compiler.js';
import { goAdapter } from './adapters/go/compiler.js';
import { rustAdapter } from './adapters/rust/compiler.js';
import type { LanguageAdapters } from './ports/language.js';

// The only registration point for concrete language integrations.
export const languages = { cpp: cppAdapter, go: goAdapter, rust: rustAdapter } satisfies LanguageAdapters;
