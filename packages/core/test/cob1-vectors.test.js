import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ValidationError,
  compareAmounts,
  matchReceipt,
  parseAmountToBaseUnits,
} from '../src/index.js';

const SUITE_PATH = new URL('../../../spec/test-vectors/cob1/v1.json', import.meta.url);
const suite = JSON.parse(readFileSync(SUITE_PATH, 'utf8'));

/**
 * Every operation the runner knows. Kept explicit so a vector naming a typo fails instead of
 * silently doing nothing, and so a new operation cannot land without a runner branch.
 *
 * @type {readonly string[]}
 */
const OPERATIONS = Object.freeze(['validate-amount', 'compare-amounts', 'match-receipt']);

/**
 * The failure codes in COB/1 §8.4. A vector names one; the suite must exercise all of them.
 *
 * @type {readonly string[]}
 */
const PROBLEMS = Object.freeze([
  'INVOICE_MISMATCH',
  'CHAIN_MISMATCH',
  'ASSET_MISMATCH',
  'AMOUNT_MISMATCH',
  'PAYEE_MISMATCH',
  'TXHASH_INVALID',
]);

/**
 * A refusal label is a rule distinction, not a required message. These predicates map the
 * labels to the reference implementation's diagnostics, so a vector that refuses for the
 * wrong reason still fails.
 *
 * @type {Readonly<Record<string, (error: Error) => boolean>>}
 */
const REFUSALS = Object.freeze({
  format: (error) => /must be a non-negative decimal string/.test(error.message),
  precision: (error) => /has more precision than the asset supports/.test(error.message),
});

/**
 * @param {string} operation
 * @param {Record<string, unknown>} input
 * @returns {unknown}
 */
function call(operation, input) {
  switch (operation) {
    case 'validate-amount':
      parseAmountToBaseUnits(input.amount, input.decimals);
      return null;
    case 'compare-amounts':
      return compareAmounts(input.left, input.right, input.decimals) === 0;
    case 'match-receipt':
      return matchReceipt(input.request, input.receipt);
    default:
      throw new Error(`vector names an unknown operation: ${operation}`);
  }
}

/**
 * @param {{ name: string, operation: string, input: Record<string, unknown>, expected: Record<string, unknown> }} vector
 */
function check(vector) {
  const { operation, input, expected } = vector;

  if (expected.outcome === 'refused') {
    assert.throws(() => call(operation, input), (error) => {
      assert.ok(
        error instanceof ValidationError,
        `${vector.name}: expected a ValidationError, got ${error?.constructor?.name ?? typeof error}`,
      );
      const predicate = REFUSALS[expected.reason];
      assert.ok(predicate, `${vector.name}: unknown refusal reason ${String(expected.reason)}`);
      assert.ok(
        predicate(error),
        `${vector.name}: refused for a different reason: ${error.message}`,
      );
      return true;
    });
    return;
  }

  const result = call(operation, input);

  switch (expected.outcome) {
    case 'accepted':
      assert.equal(result, null);
      return;
    case 'decided':
      assert.equal(result, expected.equal);
      return;
    case 'settled':
      assert.deepEqual(result, { matches: true, problems: [] });
      return;
    case 'mismatched': {
      const { matches, problems } = /** @type {{ matches: boolean, problems: { code: string }[] }} */ (
        result
      );
      assert.equal(matches, false);
      assert.ok(
        problems.some((problem) => problem.code === expected.problem),
        `${vector.name}: expected ${String(expected.problem)}, got ${problems
          .map((problem) => problem.code)
          .join(', ') || 'none'}`,
      );
      return;
    }
    default:
      assert.fail(`${vector.name}: unknown expected outcome ${String(expected.outcome)}`);
  }
}

describe('COB/1 conformance vectors — amounts and receipt matching', () => {
  it('is a cob-conformance-vectors/1 suite for spec/COB-1.md', () => {
    assert.equal(suite.format, 'cob-conformance-vectors/1');
    assert.equal(suite.specification, 'spec/COB-1.md');
    assert.ok(Array.isArray(suite.vectors) && suite.vectors.length > 0);
  });

  it('names an operation the runner implements, in a well-formed vector', () => {
    for (const vector of suite.vectors) {
      assert.equal(typeof vector.name, 'string');
      assert.match(vector.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `bad vector name ${vector.name}`);
      assert.equal(typeof vector.rule, 'string');
      assert.ok(OPERATIONS.includes(vector.operation), `unknown operation in ${vector.name}`);
      assert.ok(vector.input !== null && typeof vector.input === 'object');
      assert.ok(vector.expected !== null && typeof vector.expected === 'object');
    }
  });

  it('uses every operation at least once', () => {
    const used = new Set(suite.vectors.map((vector) => vector.operation));
    assert.deepEqual([...used].sort(), [...OPERATIONS].sort());
  });

  it('uses only refusal reasons the runner can check', () => {
    for (const vector of suite.vectors) {
      if (vector.expected.outcome !== 'refused') continue;
      assert.ok(
        Object.hasOwn(REFUSALS, vector.expected.reason),
        `${vector.name}: unknown refusal reason ${String(vector.expected.reason)}`,
      );
    }
  });

  it('uses only §8.4 failure codes, and covers every one', () => {
    const used = new Set();
    for (const vector of suite.vectors) {
      if (vector.expected.outcome !== 'mismatched') continue;
      assert.ok(
        PROBLEMS.includes(vector.expected.problem),
        `${vector.name}: unknown failure code ${String(vector.expected.problem)}`,
      );
      used.add(vector.expected.problem);
    }
    assert.deepEqual([...used].sort(), [...PROBLEMS].sort());
  });

  it('uses unique vector names', () => {
    const names = suite.vectors.map((vector) => vector.name);
    assert.equal(new Set(names).size, names.length);
  });

  for (const vector of suite.vectors) {
    it(`${vector.rule} ${vector.name}`, () => check(vector));
  }
});
