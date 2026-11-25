import { spawn } from 'node:child_process';
import { hasCode } from './shared/errors.js';

interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }
const maxStdoutBytes = 32 * 1024 * 1024;

// No shell: paths and compiler arguments are passed as distinct values.
export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    options.signal?.throwIfAborted();
    const processGroup = process.platform !== 'win32';
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal, detached: processGroup });
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';
    let failure: Error | undefined;
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const sendSignal = (signal: NodeJS.Signals) => {
      if (processGroup && child.pid) {
        try { process.kill(-child.pid, signal); }
        catch (error) { if (!hasCode(error, 'ESRCH')) child.kill(signal); }
      } else child.kill(signal);
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      sendSignal('SIGTERM');
      killTimer = setTimeout(() => sendSignal('SIGKILL'), 1000);
    };
    const abort = () => {
      failure ??= new Error(`cannot run ${command}: compilation aborted`, { cause: options.signal?.reason });
      stop();
    };
    // Streaming decoders retain partial UTF-8 characters between data events.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (failure) return;
      stdoutBytes += Buffer.byteLength(data, 'utf8');
      if (stdoutBytes > maxStdoutBytes) {
        failure = new Error(`${command}: stdout exceeded 32 MiB; refusing to return incomplete compiler output`);
        stop();
        return;
      }
      // stdout may be machine-readable metadata; never silently truncate it.
      stdout += data;
    });
    child.stderr.on('data', (data: string) => { stderr = (stderr + data).slice(-2_000_000); });
    // An abort emits error before close. Wait for close before callers remove
    // scratch directories that the compiler may still be using.
    child.on('error', (error) => { failure ??= new Error(`cannot run ${command}: ${error.message}`, { cause: error }); });
    child.on('close', (code, signal) => {
      // A compiler driver can exit before descendants with separate stdio.
      // Stop survivors in our own process group before scratch cleanup begins.
      if (stopping) sendSignal('SIGKILL');
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code === 0) resolve(stdout.replace(/\r?\n$/, ''));
      else reject(new Error(`${command} exited with ${signal ?? code}\n${stderr || stdout}`));
    });
    options.signal?.addEventListener('abort', abort, { once: true });
  });
}
