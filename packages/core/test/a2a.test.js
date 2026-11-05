import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  A2A_ENVELOPE_KEY,
  A2A_EXTENSIONS_HEADER,
  A2A_EXTENSION_URI,
  AgentIdentity,
  SignatureError,
  ValidationError,
  assertCobExtensionEchoed,
  attachCobEnvelope,
  createCobExtension,
  createEnvelope,
  createPaymentRequest,
  isCobExtensionActive,
  parseA2AExtensions,
  readCobEnvelope,
  validateCobExtension,
  withCobActivation,
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

describe('parseA2AExtensions', () => {
  it('splits on commas, trims whitespace, and drops empty entries', () => {
    assert.deepEqual(
      parseA2AExtensions(' https://example.test/a/v1 , , https://example.test/b/v1 '),
      ['https://example.test/a/v1', 'https://example.test/b/v1'],
    );
  });

  it('treats an absent or empty header as naming no extensions', () => {
    assert.deepEqual(parseA2AExtensions(undefined), []);
    assert.deepEqual(parseA2AExtensions(null), []);
    assert.deepEqual(parseA2AExtensions(''), []);
  });

  it('refuses a header value that is not a string', () => {
    assert.throws(
      () => parseA2AExtensions(42),
      (error) => error instanceof ValidationError && /header must be a string/.test(error.message),
    );
  });
});

describe('withCobActivation', () => {
  it('starts an absent header from the extension URI', () => {
    assert.equal(withCobActivation(undefined), A2A_EXTENSION_URI);
  });

  it('preserves the other extensions the client wants', () => {
    assert.equal(
      withCobActivation('https://example.test/a/v1'),
      `https://example.test/a/v1, ${A2A_EXTENSION_URI}`,
    );
  });

  it('does not add the URI twice', () => {
    const once = withCobActivation('https://example.test/a/v1');
    assert.equal(withCobActivation(once), once);
  });
});

describe('isCobExtensionActive', () => {
  it('is active only when the server declares the extension and the request names it', () => {
    const header = `https://example.test/a/v1, ${A2A_EXTENSION_URI}`;
    assert.equal(isCobExtensionActive(header, { declared: true }), true);
    assert.equal(isCobExtensionActive(header), false);
    assert.equal(isCobExtensionActive(header, { declared: false }), false);
  });

  it('is inactive when the request names only another extension', () => {
    assert.equal(isCobExtensionActive('https://example.test/a/v1', { declared: true }), false);
    assert.equal(isCobExtensionActive(undefined, { declared: true }), false);
  });

  it('is inactive when the URI is only in Message.extensions, which activates nothing', () => {
    const envelope = envelopeTo(alice, bob.id);
    const message = messageWith(envelope);
    assert.deepEqual(message.extensions, [A2A_EXTENSION_URI]);
    assert.equal(isCobExtensionActive(undefined, { declared: true }), false);
  });

  it('refuses options that are not an object', () => {
    assert.throws(() => isCobExtensionActive(undefined, null), ValidationError);
  });
});

describe('assertCobExtensionEchoed', () => {
  it('accepts an echo among other extensions', () => {
    assert.equal(
      assertCobExtensionEchoed(`${A2A_EXTENSION_URI}, https://example.test/a/v1`),
      undefined,
    );
  });

  it('refuses a response that did not echo the URI', () => {
    assert.throws(
      () => assertCobExtensionEchoed(undefined),
      (error) => error instanceof ValidationError && /did not echo/.test(error.message),
    );
    assert.throws(() => assertCobExtensionEchoed('https://example.test/a/v1'), ValidationError);
  });
});

describe('A2A activation at the transport boundary', () => {
  const payTo = '0x1111111111111111111111111111111111111111';

  /** Stand-in for a server that honours draft §6.2 before reading the envelope. */
  function serverRead(message, requestHeader, { declared = true } = {}) {
    if (!isCobExtensionActive(requestHeader, { declared })) return null;
    return readCobEnvelope(message, { agent: bob.id });
  }

  /** Stand-in for a client that honours draft §6.4 before believing a request landed. */
  function clientDelivers(responseHeader) {
    assertCobExtensionEchoed(responseHeader);
    return true;
  }

  const paymentRequest = createPaymentRequest({
    identity: alice,
    to: bob.id,
    chain: 'base-sepolia',
    asset: 'USDC',
    amount: '1.00',
    payTo,
  });

  it('does not treat an envelope as a payment request when it was not activated', () => {
    const message = messageWith(paymentRequest);
    assert.equal(serverRead(message, undefined), null);
    assert.equal(serverRead(message, 'https://example.test/a/v1'), null);
  });

  it('does not process the envelope when the server did not declare the extension', () => {
    const message = messageWith(paymentRequest);
    assert.equal(serverRead(message, A2A_EXTENSION_URI, { declared: false }), null);
  });

  it('processes the envelope once the request activates the extension', () => {
    const message = messageWith(paymentRequest);
    const read = serverRead(message, withCobActivation(undefined));
    assert.equal(read.id, paymentRequest.id);
  });

  it('does not treat a payment request as delivered without the response echo', () => {
    assert.throws(() => clientDelivers(undefined), ValidationError);
    assert.throws(() => clientDelivers('https://example.test/a/v1'), ValidationError);
  });

  it('treats the payment request as delivered when the response echoes the URI', () => {
    assert.equal(clientDelivers(A2A_EXTENSION_URI), true);
  });
});
