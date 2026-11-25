import { parseArgs } from 'node:util';

export type Command = { kind: 'help' } | { kind: 'version' } | { kind: 'gen' | 'check'; config: string };

export function parseArguments(args: string[]): Command {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const command = positionals[0];
  if (command !== undefined && command !== 'gen' && command !== 'check') throw new Error(`unknown command ${command}; expected gen or check`);
  if (positionals.length > 1) throw new Error('unexpected positional arguments; use --config <file>');
  if (values.help && values.version) throw new Error('use either --help or --version');
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  if (!command) {
    if (values.config !== undefined) throw new Error('--config requires a gen or check command');
    return { kind: 'help' };
  }
  if (values.config !== undefined && !values.config.trim()) throw new Error('--config requires a nonempty file path');
  return { kind: command, config: values.config ?? 'wasmgen.yaml' };
}

export const help = `Usage: wasmgen <gen|check> [--config <file>]

Commands:
  gen      Compile native sources and generate typed browser clients.
  check    Validate configuration and paths without compiling.

Options:
  -c, --config <file>  Config path (default: wasmgen.yaml).
  -h, --help           Show usage.
  -v, --version        Show the installed package version.

Examples:
  wasmgen check --config wasmgen.yaml
  wasmgen gen -c ./tools/wasmgen.yaml
`;
