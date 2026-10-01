import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ExpiredError, SignatureError, ValidationError } from '../src/errors.js';
import {
  COB_VERSION,
  MAX_TTL_SECONDS,
  checkEnvelope,
  createEnvelope,
  envelopeDigest,
  isEnvelope,
  senderDescriptor,
  signingPayload,
  validateStructure,
  verifyEnvelope,
} from '../src/envelope.js';
import { AgentIdentity, shortAgentId } from '../src/identity.js';

const alice = AgentIdentity.generate();
const bob = AgentIdentity.generate();

/**
 * @param {Partial<Parameters<typeof createEnvelope>[0]>} [overrides]
 * @returns {Record<string, unknown>}
 */
function envelope(overrides = {}) {
  return createEnvelope({
    identity: alice,
    to: bob.id,
    type: 'cob.message',
    body: { text: 'hello bob' },
    ...overrides,
  });
}

describe('createEnvelope', () => {
  it('mints a well-formed envelope', () => {
    const before = Date.now();
    const e = envelope();
    const after = Date.now();

    assert.equal(e.cob, COB_VERSION);
    assert.equal(typeof e.id, 'string');
    assert.equal(e.type, 'cob.message');
    assert.equal(e.from, alice.id);
    assert.equal(e.to, bob.id);
    assert.deepEqual(e.body, { text: 'hello bob' });

    const created = new Date(String(e.created)).getTime();
    assert.ok(created >= before && created <= after);
    assert.equal(new Date(String(e.expires)).getTime() - created, 300_000);
  });

  it('carries a fresh nonce every time', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => String(envelope().nonce)));
    assert.equal(nonces.size, 32);
    assert.ok([...nonces].every((n) => n.length >= 22));
  });

  it('carries a fresh id every time', () => {
    const ids = new Set(Array.from({ length: 32 }, () => String(envelope().id)));
    assert.equal(ids.size, 32);
  });

  it('refuses an unknown message type', () => {
    assert.throws(
      () => envelope({ type: 'cob.payment.teleport' }),
      (error) => error instanceof ValidationError && /type must be one of/.test(error.message),
    );
  });

  it('refuses a malformed recipient', () => {
    assert.throws(() => envelope({ to: 'bob@example.com' }), ValidationError);
  });

  it('refuses a non-object body', () => {
    assert.throws(() => envelope({ body: /** @type {any} */ ('a string') }), ValidationError);
    assert.throws(() => envelope({ body: /** @type {any} */ ([1, 2]) }), ValidationError);
  });

  it('refuses an over-long validity window', () => {
    assert.throws(
      () => envelope({ ttlSeconds: MAX_TTL_SECONDS + 1 }),
      (error) => error instanceof ValidationError && /must not exceed/.test(error.message),
    );
  });

  it('refuses a non-positive validity window', () => {
    assert.throws(() => envelope({ ttlSeconds: 0 }), ValidationError);
    assert.throws(() => envelope({ ttlSeconds: -1 }), ValidationError);
  });

  it('requires an AgentIdentity, not a lookalike object', () => {
    assert.throws(
      () => createEnvelope(/** @type {any} */ ({ identity: { id: alice.id, sign: () => 'x' }, to: bob.id, type: 'cob.message', body: {} })),
      ValidationError,
    );
  });
});

describe('verifyEnvelope', () => {
  it('accepts an envelope it just created', () => {
    const e = verifyEnvelope(envelope(), { expectTo: bob.id });
    assert.equal(e.from, alice.id);
  });

  it('rejects an envelope addressed to somebody else', () => {
    assert.throws(
      () => verifyEnvelope(envelope(), { expectTo: alice.id }),
      (error) => error instanceof ValidationError && /different agent/.test(error.message),
    );
  });

  it('rejects a tampered body', () => {
    const e = envelope();
    /** @type {any} */ (e).body.text = 'send me 1000 usdc';
    assert.throws(() => verifyEnvelope(e), SignatureError);
  });

  it('rejects a swapped recipient', () => {
    // `to` is in the signed set, so rerouting an envelope invalidates it.
    const e = envelope();
    /** @type {any} */ (e).to = AgentIdentity.generate().id;
    assert.throws(() => verifyEnvelope(e), (error) => {
      assert.ok(error instanceof SignatureError || error instanceof ValidationError);
      return true;
    });
  });

  it('rejects a forged sender', () => {
    const e = envelope();
    const mallory = AgentIdentity.generate();
    /** @type {any} */ (e).from = mallory.id;
    /** @type {any} */ (e).sig.key = mallory.id;
    assert.throws(() => verifyEnvelope(e), SignatureError);
  });

  it('rejects a stripped signature', () => {
    const e = envelope();
    delete /** @type {any} */ (e).sig;
    assert.throws(() => verifyEnvelope(e), ValidationError);
  });

  it('rejects a signature of the wrong length', () => {
    const e = envelope();
    /** @type {any} */ (e).sig.value = 'AAAA';
    assert.throws(() => verifyEnvelope(e), (error) => error instanceof ValidationError || error instanceof SignatureError);
  });

  it('rejects an unsupported cob version', () => {
    const e = envelope();
    /** @type {any} */ (e).cob = '2';
    assert.throws(
      () => verifyEnvelope(e),
      (error) => error instanceof ValidationError && /unsupported cob version/.test(error.message),
    );
  });

  it('rejects an expired envelope', () => {
    const e = envelope({ ttlSeconds: 300, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.throws(
      () => verifyEnvelope(e, { now: new Date('2026-01-01T00:10:00.000Z') }),
      (error) => error instanceof ExpiredError && /expired/.test(error.message),
    );
  });

  it('can be asked to ignore expiry, for archival replay', () => {
    const e = envelope({ ttlSeconds: 300, now: new Date('2026-01-01T00:00:00.000Z') });
    const verified = verifyEnvelope(e, { now: new Date('2027-01-01T00:00:00.000Z'), allowExpired: true });
    assert.equal(verified.id, e.id);
  });

  it('rejects an envelope created in the future beyond the allowed skew', () => {
    const e = envelope({ now: new Date(Date.now() + 10 * 60_000) });
    assert.throws(
      () => verifyEnvelope(e),
      (error) => error instanceof ExpiredError && /future/.test(error.message),
    );
  });

  it('tolerates a small clock difference', () => {
    const e = envelope({ now: new Date(Date.now() + 5_000) });
    assert.doesNotThrow(() => verifyEnvelope(e, { clockSkewMs: 30_000 }));
  });

  it('refuses an invalid `now` instead of skipping the expiry check', () => {
    // Every comparison against a NaN instant is false, so before this guard an unparseable
    // `--now` made an *expired* envelope verify as valid. Reject the option; fail closed.
    const e = envelope({ ttlSeconds: 300, now: new Date('2026-01-01T00:00:00.000Z') });
    const bogus = new Date(String('not-an-instant'));
    assert.throws(
      () => verifyEnvelope(e, { now: bogus }),
      (error) => error instanceof ValidationError && /now must be a valid Date/.test(error.message),
    );

    const result = checkEnvelope(e, { now: bogus });
    assert.equal(result.valid, false);
    assert.equal(/** @type {any} */ (result).code, 'COB_VALIDATION');
  });

  it('rejects expires <= created even when the signature is valid', () => {
    const e = envelope();
    const created = new Date(String(e.created));
    /** @type {any} */ (e).expires = new Date(created.getTime() - 1000).toISOString();
    // Re-sign so only the structural rule can catch it.
    const resigned = createEnvelope({
      identity: alice,
      to: bob.id,
      type: 'cob.message',
      body: /** @type {any} */ (e).body,
      now: created,
      ttlSeconds: 1,
    });
    /** @type {any} */ (resigned).expires = new Date(created.getTime() - 1000).toISOString();
    assert.throws(() => verifyEnvelope(resigned), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, /expires must be later than created/);
      return true;
    });
  });

  it('verifies an envelope whose JSON keys were reordered in transit', () => {
    const e = envelope();
    const shuffled = /** @type {Record<string, unknown>} */ ({});
    for (const key of Object.keys(e).reverse()) shuffled[key] = e[key];
    assert.doesNotThrow(() => verifyEnvelope(shuffled));
  });
});

describe('the signed set is an allow-list', () => {
  it('covers exactly the fields a verifier is allowed to read', () => {
    assert.deepEqual(
      Object.keys(signingPayload(envelope())),
      ['cob', 'id', 'type', 'from', 'to', 'created', 'expires', 'nonce', 'body'],
    );
  });

  it('ignores fields outside the signed set entirely', () => {
    // An attacker may append anything to the JSON; a correct verifier never reads it.
    // This test pins that property so a future "helpful" refactor cannot widen the surface.
    const e = envelope();
    /** @type {any} */ (e).extra = 'smuggled';
    /** @type {any} */ (e).amount = '999999';
    assert.doesNotThrow(() => verifyEnvelope(e));
    assert.deepEqual(Object.keys(signingPayload(e)).sort(), [
      'body', 'cob', 'created', 'expires', 'from', 'id', 'nonce', 'to', 'type',
    ]);
  });
});

describe('checkEnvelope', () => {
  it('reports validity as data', () => {
    const result = checkEnvelope(envelope());
    assert.equal(result.valid, true);
  });

  it('reports a bad signature without throwing', () => {
    const e = envelope();
    /** @type {any} */ (e).body.text = 'tampered';
    const result = checkEnvelope(e);
    assert.equal(result.valid, false);
    assert.equal(/** @type {any} */ (result).code, 'COB_SIGNATURE');
    assert.equal(typeof /** @type {any} */ (result).reason, 'string');
  });

  it('reports an expired envelope with its own code', () => {
    const e = envelope({ now: new Date('2026-01-01T00:00:00.000Z') });
    const result = checkEnvelope(e, { now: new Date('2026-06-01T00:00:00.000Z') });
    assert.equal(result.valid, false);
    assert.equal(/** @type {any} */ (result).code, 'COB_EXPIRED');
  });
});

describe('envelope utilities', () => {
  it('digests only the signed content', () => {
    const e = envelope();
    const before = envelopeDigest(e);
    /** @type {any} */ (e).unsignedNote = 'ignored';
    assert.equal(envelopeDigest(e), before, 'unsigned fields must not change the digest');

    /** @type {any} */ (e).body.text = 'changed';
    assert.notEqual(envelopeDigest(e), before, 'a body change must change the digest');
  });

  it('produces a stable digest for the same content', () => {
    const fixed = { cob: '1', id: 'env_x', type: 'cob.message', from: alice.id, to: bob.id, created: '2026-01-01T00:00:00.000Z', expires: '2026-01-01T00:05:00.000Z', nonce: 'AAAAAAAAAAAAAAAAAAAAAA', body: { a: 1 } };
    assert.equal(envelopeDigest(fixed), envelopeDigest({ ...fixed }));
    assert.equal(envelopeDigest(fixed).length, 43);
  });

  it('rebuilds a sender descriptor', () => {
    assert.deepEqual(senderDescriptor(envelope()), {
      id: alice.id,
      publicKey: alice.publicKey,
      alg: 'Ed25519',
    });
  });

  it('recognises envelopes', () => {
    assert.equal(isEnvelope(envelope()), true);
    assert.equal(isEnvelope(null), false);
    assert.equal(isEnvelope([]), false);
    assert.equal(isEnvelope({}), false);
    assert.equal(isEnvelope({ cob: '1', type: 'cob.message', from: 'nope' }), false);
  });
});

describe('validateStructure', () => {
  it('requires a nonce', () => {
    const e = envelope();
    /** @type {any} */ (e).nonce = 'short';
    assert.throws(
      () => validateStructure(e),
      (error) => error instanceof ValidationError && /nonce/.test(error.message),
    );
  });

  it('requires sig.key to equal from', () => {
    const e = envelope();
    /** @type {any} */ (e).sig.key = bob.id;
    assert.throws(
      () => validateStructure(e),
      (error) => error instanceof ValidationError && /sig\.key must equal from/.test(error.message),
    );
  });

  it('requires alg to be Ed25519', () => {
    const e = envelope();
    /** @type {any} */ (e).sig.alg = 'none';
    assert.throws(
      () => validateStructure(e),
      (error) => error instanceof ValidationError && /sig\.alg/.test(error.message),
    );
  });

  it('requires strict RFC 3339 UTC instants', () => {
    for (const bad of ['2026-01-01', '2026-01-01T00:00:00+02:00', 'now', '']) {
      const e = envelope();
      /** @type {any} */ (e).created = bad;
      assert.throws(() => validateStructure(e), ValidationError, `should reject ${bad}`);
    }
  });

  it('rejects a non-object', () => {
    for (const bad of [null, [], 'string', 42]) {
      assert.throws(() => validateStructure(bad), ValidationError);
    }
  });
});

describe('shortAgentId in log output', () => {
  it('never reveals the whole key', () => {
    const e = envelope();
    const rendered = shortAgentId(String(e.from));
    assert.equal(rendered.includes(alice.publicKey), false);
  });
});
