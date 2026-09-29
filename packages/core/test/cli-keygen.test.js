import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const cob = fileURLToPath(new URL('../bin/cob.js', import.meta.url));

function run(args, extra = {}) {
  return spawnSync(process.execPath, [cob, ...args], {
    encoding: 'utf8',
    ...extra,
  });
}

describe('cob keygen overwrite protection', () => {
  it('refuses to overwrite an existing key file and leaves it unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cob-keygen-'));
    const out = join(dir, 'agent.json');
    const first = run(['keygen', '--out', out]);
    assert.equal(first.status, 0, first.stderr);
    const before = readFileSync(out);

    const second = run(['keygen', '--out', out]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /refusing to overwrite/);
    assert.match(second.stderr, /existing agent id cob:agent:/);
    assert.match(second.stderr, /--force/);
    assert.deepEqual(readFileSync(out), before);
  });

  it('overwrites when --force is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cob-keygen-'));
    const out = join(dir, 'agent.json');
    const first = run(['keygen', '--out', out]);
    assert.equal(first.status, 0, first.stderr);
    const before = readFileSync(out, 'utf8');

    const forced = run(['keygen', '--out', out, '--force']);
    assert.equal(forced.status, 0, forced.stderr);
    const after = readFileSync(out, 'utf8');
    assert.notEqual(after, before);
    assert.match(after, /"type": "cob.agent.key"/);
  });

  it('refuses to overwrite a non-key file without --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cob-keygen-'));
    const out = join(dir, 'notes.txt');
    writeFileSync(out, 'do not destroy me\n');
    const result = run(['keygen', '--out', out]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to overwrite/);
    assert.equal(readFileSync(out, 'utf8'), 'do not destroy me\n');
  });
});
