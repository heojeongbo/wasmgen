import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

switch (process.argv[2]) {
  case 'unicode-stdout':
  case 'unicode-stderr': {
    const stream = process.argv[2] === 'unicode-stdout' ? process.stdout : process.stderr;
    const bytes = Buffer.from('경로 🦀');
    // Force the parent to receive incomplete UTF-8 sequences across data events.
    for (const byte of bytes) {
      stream.write(Buffer.from([byte]));
      await setTimeout(15);
    }
    process.exitCode = stream === process.stderr ? 2 : 0;
    break;
  }
  case 'large-json':
    process.stdout.write(JSON.stringify({ metadata: 'x'.repeat(3_000_000) }));
    break;
  case 'path-with-space':
    process.stdout.write('/tmp/toolchain directory \n');
    break;
  case 'overflow': {
    const chunk = Buffer.alloc(4 * 1024 * 1024, 'x');
    for (let i = 0; i < 9; i++) {
      if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
    }
    break;
  }
  case 'spawn-descendant':
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'descendant', ...process.argv.slice(3)], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
    break;
  case 'descendant':
  case 'ignore-termination': {
    const marker = process.argv[3];
    const ready = process.argv[4];
    if (!marker || !ready) throw new Error('process fixture paths are required');
    process.on('SIGTERM', () => {});
    await writeFile(ready, String(process.pid));
    if (process.argv[2] === 'descendant') {
      await setTimeout(400);
      await writeFile(marker, 'orphan kept running');
    } else {
      setInterval(() => {}, 1000);
    }
    break;
  }
  default:
    throw new Error('unknown process test scenario');
}
