import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../src/canonical.js';

// The corpus in ./vectors/rfc8785 is copied verbatim from the RFC 8785 reference implementation,
// `cyberphone/json-canonicalization`. Every earlier canonicalisation test was written from our own
// reading of the RFC; these are the RFC's own vectors, so a disagreement shows up here instead of
// staying invisible. Provenance, licence and the one thing not vendored are in that directory's
// README. The tests read from disk and never fetch anything.
const vectorsDir = fileURLToPath(new URL('./vectors/rfc8785/', import.meta.url));

describe('canonicalize — RFC 8785 reference vectors', () => {
  for (const name of readdirSync(join(vectorsDir, 'input')).sort()) {
    it(`reproduces ${name}`, () => {
      const input = JSON.parse(readFileSync(join(vectorsDir, 'input', name), 'utf8'));
      const expected = readFileSync(join(vectorsDir, 'output', name), 'utf8');

      // The corpus is JSON text and `canonicalize` takes a value, so `JSON.parse` sits between
      // them. None of the six vectors relies on something `JSON.parse` cannot carry — no integer
      // past 2^53, no duplicate key — so the expected bytes describe the whole document.
      assert.equal(canonicalize(input), expected);
    });
  }

  it('serialises the ES6 number samples the corpus README documents', () => {
    const lines = readFileSync(join(vectorsDir, 'es6-samples.txt'), 'utf8')
      .split('\n')
      .filter((line) => line !== '');

    for (const line of lines) {
      const [hex, expected] = line.split(',');
      // The sample format is the IEEE-754 bit pattern, big-endian, left-padded to eight bytes.
      const value = Buffer.from(hex.padStart(16, '0'), 'hex').readDoubleBE(0);
      assert.equal(canonicalize(value), expected, `0x${hex}`);
    }
  });
});
