#!/usr/bin/env node
// Minimal executable fixture for CLI orchestration tests. Browser E2E uses real
// native compilers; this fixture lets cancellation be tested deterministically.
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args[0] === 'env') console.log(process.env['WASMGEN_TEST_GOROOT']);
else if (args[0] === 'build') {
  const marker = process.env['WASMGEN_TEST_READY_FILE'];
  if (marker) {
    await writeFile(marker, 'ready');
    setInterval(() => {}, 1000);
  } else {
    const output = args[args.indexOf('-o') + 1];
    if (!output) throw new Error('missing -o argument');
    await writeFile(output, Buffer.from([0,97,115,109,1,0,0,0]));
  }
} else throw new Error('unexpected compiler fixture command');
