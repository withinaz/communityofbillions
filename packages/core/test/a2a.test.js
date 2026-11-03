import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  A2A_ENVELOPE_KEY,
  A2A_EXTENSION_URI,
  AgentIdentity,
  SignatureError,
  ValidationError,
  attachCobEnvelope,
  createCobExtension,
  createEnvelope,
  readCobEnvelope,
  validateCobExtension,
} from '../src/index.js';
import { ExpiredError } from '../src/errors.js';

const alice = AgentIdentity.generate();
const bob = AgentIdentity.generate();

/**
 * @param {AgentIdentity} identity
 * @param {string} to
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function envelopeTo(identity, to, overrides = {}) {
  return createEnvelope({
    identity,
    to,
    type: 'cob.message',
    body: { text: 'hello' },
    ...overrides,
  });
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
function messageWith(envelope) {
  return attachCobEnvelope({ role: 'user', parts: [] }, envelope);
}

describe('createCobExtension', () => {
  it('builds the declaration from spec/COB-A2A.md §4', () => {
    const extension = createCobExtension(bob.id);
    assert.equal(extension.uri, A2A_EXTENSION_URI);
    assert.equal(extension.required, false);
    assert.equal(extension.params.agent, bob.id);
    assert.match(extension.description, /COB\/1 envelopes/);
  });

  it('refuses a params.agent that is not a COB agent id', () => {
    assert.throws(
      () => createCobExtension(alice.publicKey),
      (error) => error instanceof ValidationError && error.code === 'COB_VALIDATION',
    );
  });
});

describe('validateCobExtension', () => {
  it('accepts the declaration it builds', () => {
    assert.equal(validateCobExtension(createCobExtension(bob.id)), bob.id);
  });

  it('accepts an absent required, which A2A JSON may omit as the default false', () => {
    const extension = createCobExtension(bob.id);
    delete extension.required;
    assert.equal(validateCobExtension(extension), bob.id);
  });

  it('refuses required: true', () => {
    const extension = { ...createCobExtension(bob.id), required: true };
    assert.throws(
      () => validateCobExtension(extension),
      (error) => error instanceof ValidationError && /required/.test(error.message),
    );
  });

  it('refuses another extension URI', () => {
    const extension = { ...createCobExtension(bob.id), uri: 'https://example.test/other/v1' };
    assert.throws(() => validateCobExtension(extension), ValidationError);
  });

  it('refuses a params.agent that is not a COB agent id', () => {
    const extension = { ...createCobExtension(bob.id), params: { agent: 'nobody' } };
    assert.throws(() => validateCobExtension(extension), ValidationError);
  });

  it('ignores params keys it does not know, as a v1 receiver must', () => {
    const extension = {
      ...createCobExtension(bob.id),
      params: { agent: bob.id, future: 'ignored' },
    };
    assert.equal(validateCobExtension(extension), bob.id);
  });
});

describe('attachCobEnvelope', () => {
  it('places the envelope object in metadata and lists the URI in extensions', () => {
    const envelope = envelopeTo(alice, bob.id);
    const message = attachCobEnvelope(
      { role: 'user', parts: [], metadata: { trace: 'x' }, extensions: ['https://example.test/e'] },
      envelope,
    );

    assert.equal(message.metadata[A2A_ENVELOPE_KEY], envelope);
    assert.equal(message.metadata.trace, 'x');
    assert.deepEqual(message.extensions, ['https://example.test/e', A2A_EXTENSION_URI]);
  });

  it('does not duplicate the URI or mutate the input message', () => {
    const envelope = envelopeTo(alice, bob.id);
    const original = { role: 'user', parts: [] };
    const once = attachCobEnvelope(original, envelope);
    const twice = attachCobEnvelope(once, envelope);

    assert.equal(twice.extensions.filter((uri) => uri === A2A_EXTENSION_URI).length, 1);
    assert.equal(original.metadata, undefined);
    assert.equal(original.extensions, undefined);
  });

  it('refuses a value that is not a structurally valid envelope', () => {
    assert.throws(() => attachCobEnvelope({ role: 'user' }, { hello: 'world' }), ValidationError);
  });
});

describe('readCobEnvelope', () => {
  it('verifies and returns an envelope addressed to the reader', () => {
    const envelope = envelopeTo(alice, bob.id);
    const read = readCobEnvelope(messageWith(envelope), { agent: bob.id });
    assert.equal(read.id, envelope.id);
    assert.equal(read.to, bob.id);
  });

  it('refuses an envelope whose message does not list the extension URI', () => {
    const envelope = envelopeTo(alice, bob.id);
    const message = messageWith(envelope);
    message.extensions = [];

    assert.throws(
      () => readCobEnvelope(message, { agent: bob.id }),
      (error) => error instanceof ValidationError && /extension URI/.test(error.message),
    );
  });

  it('refuses a to mismatch even when the URI is listed', () => {
    const envelope = envelopeTo(alice, alice.id);
    assert.throws(
      () => readCobEnvelope(messageWith(envelope), { agent: bob.id }),
      (error) => error instanceof ValidationError && /addressed to a different agent/.test(error.message),
    );
  });

  it('refuses a tampered envelope', () => {
    const envelope = envelopeTo(alice, bob.id);
    const tampered = { ...envelope, body: { text: 'tampered' } };
    assert.throws(
      () => readCobEnvelope(messageWith(tampered), { agent: bob.id }),
      (error) => error instanceof SignatureError && error.code === 'COB_SIGNATURE',
    );
  });

  it('refuses an expired envelope', () => {
    const envelope = envelopeTo(alice, bob.id, {
      now: new Date(Date.now() - 3_600_000),
      ttlSeconds: 300,
    });
    assert.throws(
      () => readCobEnvelope(messageWith(envelope), { agent: bob.id }),
      (error) => error instanceof ExpiredError && error.code === 'COB_EXPIRED',
    );
  });

  it('does not turn the unsigned payment annotation into an envelope', () => {
    const message = {
      role: 'agent',
      extensions: [A2A_EXTENSION_URI],
      metadata: { 'cob.payment.status': 'settled' },
    };
    assert.throws(
      () => readCobEnvelope(message, { agent: bob.id }),
      (error) => error instanceof ValidationError && /COB\/1 envelope object/.test(error.message),
    );
  });

  it('still refuses a bad envelope that claims a settled annotation', () => {
    const envelope = envelopeTo(alice, bob.id);
    const tampered = { ...envelope, body: { text: 'tampered' } };
    const message = messageWith(tampered);
    message.metadata['cob.payment.status'] = 'settled';

    assert.throws(
      () => readCobEnvelope(message, { agent: bob.id }),
      (error) => error instanceof SignatureError,
    );
  });

  it('requires the receiver to name a COB agent id', () => {
    const envelope = envelopeTo(alice, bob.id);
    assert.throws(() => readCobEnvelope(messageWith(envelope), { agent: bob.publicKey }), ValidationError);
  });
});
