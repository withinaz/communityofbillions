import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ValidationError,
  assertCobExtensionEchoed,
  isCobExtensionActive,
  parseA2AExtensions,
  readCobEnvelope,
  validateCobExtension,
  withCobActivation,
} from '../src/index.js';

const SUITE_PATH = new URL('../../../spec/test-vectors/a2a/v1.json', import.meta.url);
const suite = JSON.parse(readFileSync(SUITE_PATH, 'utf8'));

/**
 * Every operation the runner knows. Kept explicit so a vector naming a typo fails instead of
 * silently doing nothing, and so a new operation cannot land without a runner branch.
 *
 * @type {readonly string[]}
 */
const OPERATIONS = Object.freeze([
  'assert-echo',
  'is-active',
  'parse-extensions',
  'read-envelope',
  'validate-declaration',
  'with-activation',
]);

/**
 * A refusal label is a rule distinction, not a required message. These predicates map the
 * labels to the reference implementation's diagnostics, so a vector that refuses for the
 * wrong reason still fails.
 *
 * @type {Readonly<Record<string, (error: Error) => boolean>>}
 */
const REFUSALS = Object.freeze({
  'extension-not-object': (error) => error.message === 'extension must be an AgentExtension object',
  required: (error) => /extension\.required must be false/.test(error.message),
  uri: (error) => /extension\.uri must be/.test(error.message),
  params: (error) => /extension\.params must be an object/.test(error.message),
  agent: (error) => /must look like "cob:agent:/.test(error.message),
  'header-not-string': (error) => /header must be a string/.test(error.message),
  'options-not-object': (error) => /options must (be an object|include the receiver agent id)/.test(error.message),
  'extension-uri-missing': (error) => /does not list the cob\.a2a extension URI/.test(error.message),
  'metadata-not-object': (error) => /message\.metadata must be an object/.test(error.message),
  'envelope-not-object': (error) => /must be a COB\/1 envelope object/.test(error.message),
  'not-echoed': (error) => /did not echo/.test(error.message),
});

/**
 * @param {string} operation
 * @param {Record<string, unknown>} input
 * @returns {unknown}
 */
function call(operation, input) {
  switch (operation) {
    case 'parse-extensions':
      return parseA2AExtensions(input.header);
    case 'with-activation':
      return withCobActivation(input.header);
    case 'is-active':
      return isCobExtensionActive(input.header, input.options);
    case 'assert-echo':
      return assertCobExtensionEchoed(input.header);
    case 'validate-declaration':
      return validateCobExtension(input.extension);
    case 'read-envelope':
      return readCobEnvelope(input.message, input.options);
    default:
      throw new Error(`vector names an unknown operation: ${operation}`);
  }
}

/**
 * Compare name lists as unordered multisets: header order and spacing are not normative, but a
 * dropped or duplicated extension is.
 *
 * @param {string[]} actual
 * @param {string[]} expected
 */
function assertSameNames(actual, expected) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
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
      if ('agent' in expected) assert.equal(result, expected.agent);
      return;
    case 'parsed':
      assertSameNames(/** @type {string[]} */ (result), /** @type {string[]} */ (expected.names));
      return;
    case 'header':
      assertSameNames(
        parseA2AExtensions(/** @type {string} */ (result)),
        /** @type {string[]} */ (expected.names),
      );
      return;
    case 'decided':
      assert.equal(result, expected.active);
      return;
    default:
      assert.fail(`${vector.name}: unknown expected outcome ${String(expected.outcome)}`);
  }
}

describe('cob.a2a conformance vectors', () => {
  it('is a cob-conformance-vectors/1 suite for spec/COB-A2A.md', () => {
    assert.equal(suite.format, 'cob-conformance-vectors/1');
    assert.equal(suite.specification, 'spec/COB-A2A.md');
    assert.equal(suite.extension, 'https://github.com/withinaz/communityofbillions/a2a/cob/v1');
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

  it('uses unique vector names', () => {
    const names = suite.vectors.map((vector) => vector.name);
    assert.equal(new Set(names).size, names.length);
  });

  for (const vector of suite.vectors) {
    it(`${vector.rule} ${vector.name}`, () => check(vector));
  }
});
