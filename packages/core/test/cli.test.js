import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AgentIdentity } from '../src/index.js';

const CLI = fileURLToPath(new URL('../bin/cob.js', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'cob-cli-'));
let runCount = 0;

after(() => rmSync(work, { recursive: true, force: true }));

/**
 * Run the CLI with stdout and stderr written to files rather than pipes.
 *
 * The maintenance sandbox cannot create the pipes Node's default `stdio: 'pipe'` needs, so the
 * test would fail there for a reason that has nothing to do with the CLI. File descriptors keep
 * the assertions on the real output without requiring a pipe.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(args) {
  const id = ++runCount;
  const stdoutPath = join(work, `stdout-${id}.txt`);
  const stderrPath = join(work, `stderr-${id}.txt`);
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  let result;
  try {
    result = spawnSync(process.execPath, [CLI, ...args], {
      stdio: ['ignore', stdoutFd, stderrFd],
      encoding: 'utf8',
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  assert.equal(result.error, undefined, result.error?.message);
  return {
    status: result.status,
    stdout: readFileSync(stdoutPath, 'utf8'),
    stderr: readFileSync(stderrPath, 'utf8'),
  };
}

describe('cob keygen', () => {
  it('refuses to overwrite an existing key file and names the identity it would destroy', () => {
    const path = join(work, 'existing.cob-key.json');
    const first = runCli(['keygen', '--out', path]);
    assert.equal(first.status, 0, first.stderr);

    const before = readFileSync(path);
    const id = JSON.parse(before.toString('utf8')).id;

    const second = runCli(['keygen', '--out', path]);
    assert.notEqual(second.status, 0);
    assert.deepEqual(readFileSync(path), before, 'the existing key file must not change');
    assert.match(second.stderr, /refusing to overwrite/);
    assert.ok(second.stderr.includes(id), 'the refusal must name the existing agent id');
    assert.match(second.stderr, /--force/);
  });

  it('replaces the file only when --force is given', () => {
    const path = join(work, 'forced.cob-key.json');
    const first = runCli(['keygen', '--out', path]);
    assert.equal(first.status, 0, first.stderr);
    const before = JSON.parse(readFileSync(path, 'utf8'));

    const forced = runCli(['keygen', '--out', path, '--force']);
    assert.equal(forced.status, 0, forced.stderr);

    const after = JSON.parse(readFileSync(path, 'utf8'));
    assert.notEqual(after.id, before.id);
    assert.equal(AgentIdentity.fromSecret(after).id, after.id, 'the replacement must be a usable key');
  });

  it('refuses an existing file that is not a readable key and leaves it alone', () => {
    const path = join(work, 'not-a-key.json');
    writeFileSync(path, 'not a key\n');

    const result = runCli(['keygen', '--out', path]);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(path, 'utf8'), 'not a key\n');
    assert.match(result.stderr, /not a readable COB key file/);
    assert.match(result.stderr, /--force/);
  });
});
