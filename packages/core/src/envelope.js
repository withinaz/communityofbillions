/**
 * The COB/1 envelope.
 *
 * An envelope is a signed, self-contained message. It is the only primitive the protocol
 * requires: if you can produce one and verify one, you speak COB/1.
 *
 * Two decisions worth understanding before reading the code:
 *
 * 1. **The signed set is an explicit allow-list.** {@link SIGNED_FIELDS} names every field the
 *    signature covers. Signing "everything except `sig`" is the obvious implementation and it
 *    is wrong: it lets an attacker append a field the verifier later reads but the signer
 *    never saw.
 *
 * 2. **Verification never throws on a hostile input it can describe.** Structure problems
 *    throw, because they are programmer errors. A bad signature on a syntactically valid
 *    envelope is a normal event, and {@link checkEnvelope} reports it as data.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { canonicalBytes } from './canonical.js';
import { ExpiredError, SignatureError, ValidationError } from './errors.js';
import {
  AgentIdentity,
  assertAgentId,
  isAgentId,
  publicKeyFromAgentId,
  verifySignature,
} from './identity.js';

/** Protocol version carried by every envelope. */
export const COB_VERSION = '1';

/**
 * Message types this implementation understands.
 *
 * Anything outside this list is refused. A verifier that accepts unknown types is a verifier
 * that can be made to act on a type it was never written to handle.
 */
export const MESSAGE_TYPES = Object.freeze([
  /** Generic signed payload; the body is application-defined. */
  'cob.message',
  /** "I am here, and these are my endpoints." */
  'cob.presence',
  /** "Pay me this much, on this chain, to this address, for this invoice." */
  'cob.payment.request',
  /** "I paid invoice X; here is the transaction." */
  'cob.payment.receipt',
  /** "Something went wrong with the envelope you sent." */
  'cob.error',
]);

/** Fields covered by the signature, in the order a reader should think about them. */
export const SIGNED_FIELDS = Object.freeze([
  'cob',
  'id',
  'type',
  'from',
  'to',
  'created',
  'expires',
  'nonce',
  'body',
]);

/** Longest validity window we will mint, in seconds. Prevents accidental immortal messages. */
export const MAX_TTL_SECONDS = 86_400;

/** Default validity window, in seconds. Short by design: envelopes are not documents. */
export const DEFAULT_TTL_SECONDS = 300;

/** Strict RFC 3339 UTC instant, millisecond precision optional. */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Date}
 * @throws {ValidationError}
 */
export function assertInstant(value, label = 'timestamp') {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    throw new ValidationError(
      `${label} must be an RFC 3339 UTC instant such as "2026-09-28T12:00:00.000Z"`,
      { field: label, value },
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${label} is not a real date`, { field: label, value });
  }
  return date;
}

/**
 * Build the exact object that gets signed: the allow-listed fields, nothing else.
 *
 * @param {Record<string, unknown>} envelope
 * @returns {Record<string, unknown>}
 */
export function signingPayload(envelope) {
  /** @type {Record<string, unknown>} */
  const payload = {};
  for (const field of SIGNED_FIELDS) {
    if (envelope[field] !== undefined) payload[field] = envelope[field];
  }
  return payload;
}

/**
 * A stable digest of an envelope's signed content, for logs and receipts.
 *
 * @param {Record<string, unknown>} envelope
 * @returns {string} base64url-encoded SHA-256
 */
export function envelopeDigest(envelope) {
  return createHash('sha256').update(canonicalBytes(signingPayload(envelope))).digest('base64url');
}

/**
 * Mint a signed envelope.
 *
 * @param {{
 *   identity: AgentIdentity,
 *   to: string,
 *   type: string,
 *   body: Record<string, unknown>,
 *   ttlSeconds?: number,
 *   now?: Date,
 *   id?: string,
 * }} options
 * @returns {Record<string, unknown>} a signed envelope, ready to serialise
 * @throws {ValidationError}
 */
export function createEnvelope({
  identity,
  to,
  type,
  body,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = new Date(),
  id = undefined,
}) {
  if (!(identity instanceof AgentIdentity)) {
    throw new ValidationError('identity must be an AgentIdentity instance');
  }
  assertAgentId(to, 'to');
  assertMessageType(type);
  assertPlainBody(body);
  assertTtl(ttlSeconds);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ValidationError('now must be a valid Date');
  }

  const payload = {
    cob: COB_VERSION,
    id: id ?? `env_${randomUUID()}`,
    type,
    from: identity.id,
    to,
    created: now.toISOString(),
    expires: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    nonce: randomBytes(16).toString('base64url'),
    body,
  };

  const value = identity.sign(canonicalBytes(payload)).toString('base64url');

  return {
    ...payload,
    sig: { alg: 'Ed25519', key: payload.from, value },
  };
}

/**
 * @param {unknown} type
 * @returns {string}
 * @throws {ValidationError}
 */
export function assertMessageType(type) {
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(type)) {
    throw new ValidationError(
      `type must be one of: ${MESSAGE_TYPES.join(', ')}`,
      { type, known: [...MESSAGE_TYPES] },
    );
  }
  return type;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 * @throws {ValidationError}
 */
function assertPlainBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('body must be a plain object', { type: typeof body });
  }
  return /** @type {Record<string, unknown>} */ (body);
}

/**
 * @param {unknown} ttlSeconds
 * @throws {ValidationError}
 */
function assertTtl(ttlSeconds) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new ValidationError('ttlSeconds must be a positive integer', { ttlSeconds });
  }
  if (ttlSeconds > MAX_TTL_SECONDS) {
    throw new ValidationError(
      `ttlSeconds must not exceed ${MAX_TTL_SECONDS} (24 hours)`,
      { ttlSeconds, max: MAX_TTL_SECONDS },
    );
  }
}

/**
 * Structural validation. Throws on anything a signer could not have produced deliberately.
 *
 * This is stage one of two. {@link verifyEnvelope} calls it, then checks the signature and
 * the clock.
 *
 * @param {unknown} envelope
 * @returns {Record<string, unknown>} the validated envelope, typed
 * @throws {ValidationError}
 */
export function validateStructure(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new ValidationError('envelope must be a plain object');
  }
  const e = /** @type {Record<string, unknown>} */ (envelope);

  if (e.cob !== COB_VERSION) {
    throw new ValidationError(
      `unsupported cob version ${JSON.stringify(e.cob)}; this implementation speaks "${COB_VERSION}"`,
      { cob: e.cob, supported: COB_VERSION },
    );
  }

  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 128) {
    throw new ValidationError('id must be a non-empty string of at most 128 characters', { id: e.id });
  }

  assertMessageType(e.type);
  assertAgentId(e.from, 'from');
  assertAgentId(e.to, 'to');

  const created = assertInstant(e.created, 'created');
  const expires = assertInstant(e.expires, 'expires');
  if (expires.getTime() <= created.getTime()) {
    throw new ValidationError('expires must be later than created', {
      created: e.created,
      expires: e.expires,
    });
  }

  if (typeof e.nonce !== 'string' || e.nonce.length < 22) {
    throw new ValidationError(
      'nonce must be at least 16 bytes of entropy, base64url encoded',
      { nonce: e.nonce },
    );
  }

  assertPlainBody(e.body);

  const sig = e.sig;
  if (sig === null || typeof sig !== 'object' || Array.isArray(sig)) {
    throw new ValidationError('sig must be an object with alg, key, and value');
  }
  const s = /** @type {Record<string, unknown>} */ (sig);
  if (s.alg !== 'Ed25519') {
    throw new ValidationError('sig.alg must be "Ed25519"', { alg: s.alg });
  }
  if (s.key !== e.from) {
    throw new ValidationError('sig.key must equal from', { key: s.key, from: e.from });
  }
  if (typeof s.value !== 'string' || s.value.length !== 86) {
    // 64 bytes -> 86 unpadded base64url characters.
    throw new ValidationError('sig.value must be a 64-byte base64url signature', {
      length: typeof s.value === 'string' ? s.value.length : null,
    });
  }

  return e;
}

/**
 * Verify an envelope completely: structure, signature, clock, and addressee.
 *
 * @param {unknown} envelope
 * @param {{
 *   now?: Date,
 *   expectTo?: string,
 *   clockSkewMs?: number,
 *   allowExpired?: boolean,
 * }} [options]
 * @returns {Record<string, unknown>} the verified envelope
 * @throws {ValidationError | SignatureError | ExpiredError}
 */
export function verifyEnvelope(envelope, options = {}) {
  const { now = new Date(), expectTo = undefined, clockSkewMs = 30_000, allowExpired = false } = options;

  // An unparseable instant is not a clock. `x > NaN` and `x <= NaN` are both false, so a bad
  // `now` would skip both checks below and let an expired envelope verify as valid — a silent
  // downgrade, and one the CLI's `--now` flag can produce from a typo. Fail closed on the option.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ValidationError('now must be a valid Date', { now: String(now) });
  }

  const e = validateStructure(envelope);

  const payload = signingPayload(e);
  const sig = /** @type {{ value: string, key: string }} */ (e.sig);
  if (!verifySignature(canonicalBytes(payload), sig.value, sig.key)) {
    throw new SignatureError('signature does not verify against the claimed key', {
      from: e.from,
      id: e.id,
    });
  }

  if (expectTo !== undefined) {
    assertAgentId(expectTo, 'expectTo');
    if (e.to !== expectTo) {
      throw new ValidationError('envelope is addressed to a different agent', {
        to: e.to,
        expected: expectTo,
      });
    }
  }

  if (!allowExpired) {
    const created = assertInstant(e.created, 'created');
    const expires = assertInstant(e.expires, 'expires');

    if (created.getTime() > now.getTime() + clockSkewMs) {
      throw new ExpiredError('envelope was created in the future beyond the allowed clock skew', {
        created: e.created,
        now: now.toISOString(),
        clockSkewMs,
      });
    }
    if (expires.getTime() <= now.getTime()) {
      throw new ExpiredError('envelope has expired', {
        expires: e.expires,
        now: now.toISOString(),
      });
    }
  }

  return e;
}

/**
 * Non-throwing verification, for receivers that want to log and drop rather than crash.
 *
 * @param {unknown} envelope
 * @param {Parameters<typeof verifyEnvelope>[1]} [options]
 * @returns {{ valid: true, envelope: Record<string, unknown> } | { valid: false, code: string, reason: string }}
 */
export function checkEnvelope(envelope, options = {}) {
  try {
    return { valid: true, envelope: verifyEnvelope(envelope, options) };
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return {
        valid: false,
        code: /** @type {{ code: string }} */ (error).code,
        reason: error.message,
      };
    }
    throw error;
  }
}

/**
 * Convenience: rebuild the public descriptor of the sending agent from a verified envelope.
 *
 * @param {Record<string, unknown>} envelope
 * @returns {{ id: string, publicKey: string, alg: string }}
 */
export function senderDescriptor(envelope) {
  const id = assertAgentId(envelope.from, 'from');
  return { id, publicKey: publicKeyFromAgentId(id), alg: 'Ed25519' };
}

/**
 * @param {unknown} value
 * @returns {boolean} true if `value` looks like an envelope at all
 */
export function isEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = /** @type {Record<string, unknown>} */ (value);
  return e.cob === COB_VERSION && typeof e.type === 'string' && isAgentId(e.from);
}
