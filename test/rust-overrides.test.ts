import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { readWorkspaceOverrides } from '../src/adapters/rust/overrides.js';

async function fixture(t: TestContext, contents: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wasmgen-cargo-overrides-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'Cargo.toml'), contents);
  return root;
}

test('workspace patch aliases preserve options and resolve paths against the original root', async (t) => {
  const source = `[workspace]\nmembers = ["nested/member"]\n
[patch.crates-io]
renamed = { package = "some-crate", path = "../vendor/with spaces/한글", version = "=1.2.3", features = ["enabled"], default-features = false }
[profile.release]
opt-level = 1
`;
  const root = await fixture(t, source);
  assert.deepEqual(structuredClone(parse(await readWorkspaceOverrides(root))), { patch: { 'crates-io': {
    renamed: { package: 'some-crate', path: path.resolve(root, '../vendor/with spaces/한글'), version: '=1.2.3', features: ['enabled'], 'default-features': false },
  } } });
  assert.equal(await readFile(path.join(root, 'Cargo.toml'), 'utf8'), source);
});

test('Git source selectors, revisions, registry names, and version strings survive TOML serialization', async (t) => {
  const root = await fixture(t, `
[patch.'https://example.com/upstream.git']
upstream = { git = "https://example.com/fork.git", rev = "abc123", package = "actual-name" }
[patch.private-registry]
another = { git = "https://example.com/another.git", branch = "fix/one" }
versioned = "1.2.3"
`);
  assert.deepEqual(structuredClone(parse(await readWorkspaceOverrides(root))), { patch: {
    'https://example.com/upstream.git': { upstream: { git: 'https://example.com/fork.git', rev: 'abc123', package: 'actual-name' } },
    'private-registry': { another: { git: 'https://example.com/another.git', branch: 'fix/one' }, versioned: '1.2.3' },
  } });
});

test('replace retains exact package IDs and rebases local paths', async (t) => {
  const root = await fixture(t, `
[replace]
"itoa:1.0.15" = { path = "vendor/itoa" }
"https://example.com/source#other:2.0.0" = { git = "https://example.com/fork", tag = "v2" }
`);
  assert.deepEqual(structuredClone(parse(await readWorkspaceOverrides(root))), { replace: {
    'itoa:1.0.15': { path: path.join(root, 'vendor/itoa') },
    'https://example.com/source#other:2.0.0': { git: 'https://example.com/fork', tag: 'v2' },
  } });
});

test('absolute override paths keep their meaning', async (t) => {
  const absolute = path.resolve(os.tmpdir(), 'wasmgen-already-absolute');
  const root = await fixture(t, `[patch.crates-io]\nexample = { path = ${JSON.stringify(absolute)} }\n`);
  assert.deepEqual(structuredClone(parse(await readWorkspaceOverrides(root))), { patch: { 'crates-io': { example: { path: absolute } } } });
});

test('a manifest without overrides contributes no unrelated configuration', async (t) => {
  const root = await fixture(t, '[package]\nname = "example"\nversion = "0.1.0"\n[workspace]\n');
  assert.deepEqual(structuredClone(parse(await readWorkspaceOverrides(root))), {});
});

for (const [name, source, expected] of [
  ['an invalid table', 'patch = []', /expected a TOML table/],
  ['a non-string path', '[patch.crates-io]\nexample = { path = 12 }', /path: expected a string/],
  ['duplicate keys', '[patch.crates-io]\nexample = "1"\nexample = "2"', /already defined/i],
] as const) {
  test(`invalid Cargo overrides fail explicitly: ${name}`, async (t) => {
    const root = await fixture(t, source);
    await assert.rejects(readWorkspaceOverrides(root), expected);
  });
}
