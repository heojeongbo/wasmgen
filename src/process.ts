import { spawn } from 'node:child_process';

interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }

// No shell: paths and compiler arguments are passed as distinct values.
export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-2_000_000); });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2_000_000); });
    // An abort emits error before close. Wait for close before callers remove
    // scratch directories that the compiler may still be using.
    child.on('error', (error) => { failure = new Error(`cannot run ${command}: ${error.message}`, { cause: error }); });
    child.on('close', (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited with ${code}\n${stderr || stdout}`));
    });
  });
}
