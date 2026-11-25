import { execFileSync } from 'node:child_process';
import { chmod, cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });
await cp('src/licenses', 'dist/licenses', { recursive: true });
await chmod('dist/cli.js', 0o755);
