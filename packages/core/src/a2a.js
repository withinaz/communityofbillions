/**
 * `cob.a2a` — the seam between a COB/1 envelope and an A2A message.
 *
 * The draft in `spec/COB-A2A.md` fixes two directions:
 *
 * 1. **Outbound.** An A2A `Message` carries the envelope as the object at
 *    `metadata["cob.envelope"]` and lists the extension URI in `Message.extensions`.
 *    {@link attachCobEnvelope} does both without touching the envelope.
 *
 * 2. **Inbound.** {@link readCobEnvelope} refuses a message that has the envelope but not
 *    the URI, verifies the envelope with COB/1 §4.3, and checks its `to` against the
 *    receiver's declared `params.agent`.
 *
 * 3. **Activation.** A2A extensions are inactive by default, so a server may process an
 *    envelope only when its own Agent Card declares this extension and the request names
 *    it in `A2A-Extensions` (draft §6). {@link isCobExtensionActive} decides that, and
 *    {@link assertCobExtensionEchoed} is the client's only evidence that a server
 *    processed the envelope at all.
 *
 * 4. **Payment substate.** `cob.payment.status` is an unsigned annotation (draft §7).
 *    {@link readCobPaymentStatus} returns a known COB/1 state and ignores anything else;
 *    {@link checkCobPaymentStatus} reports an annotation that contradicts the envelope while
 *    leaving the envelope itself untouched. Nothing here treats the annotation as evidence.
 *
 * What this module deliberately does not do: it never settles from `cob.payment.status`.
 * Settlement is the envelope and the local {@link Payment} state machine. It also does not
 * open an HTTP connection: the header helpers take header values, and attaching them to a
 * request belongs to a transport binding (issue #3).
 */

import { validateStructure, verifyEnvelope } from './envelope.js';
import { ValidationError } from './errors.js';
import { assertAgentId } from './identity.js';

/** The URI that identifies this extension version. An identifier, not an endpoint. */
export const A2A_EXTENSION_URI = 'https://github.com/withinaz/communityofbillions/a2a/cob/v1';

/** The declaration text from `spec/COB-A2A.md` §4. */
export const A2A_EXTENSION_DESCRIPTION =
  'Carries signed COB/1 envelopes for payment requests and receipts.';

/** The metadata key that holds the envelope object. */
export const A2A_ENVELOPE_KEY = 'cob.envelope';

/** The unsigned annotation key. Present so a reader can name it; never read as evidence. */
export const A2A_PAYMENT_STATUS_KEY = 'cob.payment.status';

/**
 * The COB/1 states draft §7 allows as an annotation. `draft` is excluded: it is a local
 * state that has no wire representation (COB/1 §8.5), so annotating a message with it is
 * indistinguishable from an unknown value.
 */
const A2A_PAYMENT_STATES = Object.freeze([
  'requested',
  'authorized',
  'submitted',
  'settled',
  'failed',
  'expired',
]);

/** The A2A request and response header that activates extensions. */
export const A2A_EXTENSIONS_HEADER = 'A2A-Extensions';

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Build the `AgentExtension` declaration an agent puts in its Agent Card.
 *
 * `required` is always `false`: an A2A peer that does not understand COB/1 must still be
 * able to send ordinary messages. `params.agent` is the COB identity this endpoint claims;
 * it is the address an incoming envelope's `to` is checked against.
 *
 * @param {string} agent a COB agent id, `cob:agent:<43 base64url chars>`
 * @returns {{ uri: string, description: string, required: false, params: { agent: string } }}
 * @throws {ValidationError}
 */
export function createCobExtension(agent) {
  assertAgentId(agent, 'params.agent');
  return {
    uri: A2A_EXTENSION_URI,
    description: A2A_EXTENSION_DESCRIPTION,
    required: false,
    params: { agent },
  };
}

/**
 * Validate an `AgentExtension` received in someone else's Agent Card.
 *
 * The declaration is a claim, not proof: a well-formed declaration says the endpoint
 * *claims* that COB identity. `required: true` is refused because it would make every
 * ordinary A2A message a negotiation failure. An absent `required` is accepted: A2A's
 * proto3 JSON omits a default-`false` boolean, so absence means the same thing as `false`
 * (draft §4).
 *
 * @param {unknown} extension
 * @returns {string} the declared COB agent id
 * @throws {ValidationError}
 */
export function validateCobExtension(extension) {
  if (!isPlainObject(extension)) {
    throw new ValidationError('extension must be an AgentExtension object');
  }

  const e = /** @type {Record<string, unknown>} */ (extension);
  if (e.uri !== A2A_EXTENSION_URI) {
    throw new ValidationError(`extension.uri must be ${A2A_EXTENSION_URI}`, { uri: e.uri });
  }
  if (e.required !== undefined && e.required !== false) {
    throw new ValidationError('extension.required must be false for cob.a2a', {
      required: e.required,
    });
  }
  if (!isPlainObject(e.params)) {
    throw new ValidationError('extension.params must be an object with an agent field');
  }

  const params = /** @type {Record<string, unknown>} */ (e.params);
  return assertAgentId(params.agent, 'params.agent');
}

/**
 * Return a copy of `message` carrying `envelope` under `metadata["cob.envelope"]` and the
 * extension URI in `extensions`.
 *
 * The envelope is structurally checked but **not** signature-checked: this is the
 * producer's builder, and a receiver is the party that must call {@link readCobEnvelope}.
 * Existing metadata and extensions are preserved, and the URI is not duplicated.
 *
 * @param {Record<string, unknown>} message an A2A `Message` object
 * @param {Record<string, unknown>} envelope a COB/1 envelope
 * @returns {Record<string, unknown>} a new message; `message` is not mutated
 * @throws {ValidationError}
 */
export function attachCobEnvelope(message, envelope) {
  if (!isPlainObject(message)) {
    throw new ValidationError('message must be a plain object');
  }
  validateStructure(envelope);

  const extensions = message.extensions === undefined ? [] : message.extensions;
  if (!Array.isArray(extensions) || extensions.some((uri) => typeof uri !== 'string')) {
    throw new ValidationError('message.extensions must be an array of URI strings', {
      extensions,
    });
  }

  const metadata = message.metadata === undefined ? {} : message.metadata;
  if (!isPlainObject(metadata)) {
    throw new ValidationError('message.metadata must be an object');
  }

  return {
    ...message,
    extensions: extensions.includes(A2A_EXTENSION_URI)
      ? extensions
      : [...extensions, A2A_EXTENSION_URI],
    metadata: { ...metadata, [A2A_ENVELOPE_KEY]: envelope },
  };
}

/**
 * Read and verify the envelope carried by an A2A message.
 *
 * Three refusals, in the order the draft requires:
 *
 * 1. the message must list the extension URI in `extensions` — the envelope alone is not
 *    the message-level claim (draft §5);
 * 2. the envelope must be structurally valid and its signature must verify (COB/1 §4.3);
 * 3. the envelope's `to` must be `agent`, the receiver's own declared `params.agent`
 *    (draft §3).
 *
 * `cob.payment.status` is ignored. It is unsigned and cannot make an envelope valid,
 * payable, or settled; a message carrying only the annotation has no envelope at all.
 *
 * @param {Record<string, unknown>} message an A2A `Message` object
 * @param {{
 *   agent: string,
 *   now?: Date,
 *   clockSkewMs?: number,
 *   allowExpired?: boolean,
 * }} options `agent` is the receiver's declared COB identity
 * @returns {Record<string, unknown>} the verified envelope
 * @throws {ValidationError | import('./errors.js').SignatureError | import('./errors.js').ExpiredError}
 */
export function readCobEnvelope(message, options) {
  if (!isPlainObject(message)) {
    throw new ValidationError('message must be a plain object');
  }
  if (!isPlainObject(options)) {
    throw new ValidationError('options must include the receiver agent id');
  }

  const { agent, ...verifyOptions } = /** @type {{ agent: string } & Record<string, unknown>} */ (
    options
  );
  assertAgentId(agent, 'agent');

  const extensions = message.extensions;
  if (!Array.isArray(extensions) || !extensions.includes(A2A_EXTENSION_URI)) {
    throw new ValidationError(
      `message does not list the cob.a2a extension URI in extensions; refusing to read ${A2A_ENVELOPE_KEY}`,
      { extension: A2A_EXTENSION_URI },
    );
  }

  const metadata = message.metadata;
  if (!isPlainObject(metadata)) {
    throw new ValidationError('message.metadata must be an object');
  }

  const envelope = /** @type {Record<string, unknown>} */ (metadata)[A2A_ENVELOPE_KEY];
  if (!isPlainObject(envelope)) {
    throw new ValidationError(`message.metadata["${A2A_ENVELOPE_KEY}"] must be a COB/1 envelope object`, {
      type: typeof envelope,
    });
  }

  return verifyEnvelope(envelope, { ...verifyOptions, expectTo: agent });
}

/**
 * Read the unsigned `cob.payment.status` annotation from an A2A message.
 *
 * Draft §7 makes the value advisory: a receiver **MUST** ignore an unknown value rather than
 * guess at it. This function therefore returns `null` for an absent key, a non-string, or a
 * string outside the six COB/1 wire states — including `draft`, which never reaches a
 * message. It never throws for the *value*; a malformed annotation is ignored, not fatal.
 *
 * The result is for routing and display only. It is not signed, proves nothing, and cannot
 * settle a payment; read the envelope with {@link readCobEnvelope} for anything that matters.
 *
 * @param {Record<string, unknown>} message an A2A `Message` object
 * @returns {string | null} a known COB/1 payment state, or `null`
 * @throws {ValidationError} when `message` is not a plain object
 */
export function readCobPaymentStatus(message) {
  if (!isPlainObject(message)) {
    throw new ValidationError('message must be a plain object');
  }

  const metadata = message.metadata;
  if (!isPlainObject(metadata)) return null;

  const value = /** @type {Record<string, unknown>} */ (metadata)[A2A_PAYMENT_STATUS_KEY];
  return typeof value === 'string' && A2A_PAYMENT_STATES.includes(value) ? value : null;
}

/**
 * Check the annotation against the envelope it accompanies.
 *
 * Draft §7 says the substate **MUST NOT** contradict the envelope, and that a receiver
 * **SHOULD** trust the envelope and report the annotation as malformed. This returns data
 * rather than throwing, so a caller can keep processing the verified envelope while
 * reporting the bad annotation.
 *
 * Only a receipt constrains the state. A receipt is a claim of settlement, which implies the
 * payment reached `submitted`, so annotating one `requested`, `authorized`, `failed`, or
 * `expired` is a contradiction. A payment request does not constrain it: a message may
 * re-carry an old request while the payment has since moved on, and draft §7 gives no upper
 * bound for that.
 *
 * The envelope is not re-verified here. Pass an envelope that {@link readCobEnvelope}
 * returned; this function only reads its `type` and must not be used as a validity check.
 *
 * @param {Record<string, unknown>} message an A2A `Message` object
 * @param {Record<string, unknown>} envelope a verified COB/1 envelope
 * @returns {{
 *   status: string | null,
 *   problem: null | { code: string, message: string, expected: string, actual: string },
 * }}
 * @throws {ValidationError} when `message` or `envelope` is not a plain object
 */
export function checkCobPaymentStatus(message, envelope) {
  const status = readCobPaymentStatus(message);

  if (!isPlainObject(envelope)) {
    throw new ValidationError('envelope must be a COB/1 envelope object');
  }

  const allowed = status === 'submitted' || status === 'settled';
  if (status === null || envelope.type !== 'cob.payment.receipt' || allowed) {
    return { status, problem: null };
  }

  return {
    status,
    problem: {
      code: 'SUBSTATE_CONTRADICTS_ENVELOPE',
      message: `a cob.payment.receipt cannot be annotated "${status}": a receipt means the payment reached submitted`,
      expected: 'submitted or settled',
      actual: status,
    },
  };
}

/**
 * Parse an `A2A-Extensions` header value into the extension URIs it names.
 *
 * The header is a comma-separated list; empty items and surrounding whitespace are not
 * meaningful (an absent header names nothing). `Message.extensions` is a different field:
 * it records provenance per message and activates nothing (draft §5–§6).
 *
 * @param {string | null | undefined} value
 * @returns {string[]}
 * @throws {ValidationError}
 */
export function parseA2AExtensions(value) {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') {
    throw new ValidationError(`${A2A_EXTENSIONS_HEADER} header must be a string`, {
      type: typeof value,
    });
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Return a request header value that activates `cob.a2a`, preserving any other extensions.
 *
 * This is the client half of draft §6.1. It only writes the header: activation is a
 * request for COB/1 semantics, not a promise that the server agreed to them.
 *
 * @param {string | null | undefined} headerValue
 * @returns {string}
 * @throws {ValidationError}
 */
export function withCobActivation(headerValue) {
  const extensions = parseA2AExtensions(headerValue);
  return extensions.includes(A2A_EXTENSION_URI)
    ? extensions.join(', ')
    : [...extensions, A2A_EXTENSION_URI].join(', ');
}

/**
 * Decide whether a server may process a `cob.envelope` for one request.
 *
 * Both halves of draft §6.2 are required, and neither is enough alone: the server's own
 * Agent Card must declare the extension (`declared: true`), and the request must name the
 * URI in `A2A-Extensions`. When this returns `false`, the server processes the A2A message
 * as ordinary traffic and **must not** read `metadata["cob.envelope"]` as a payment
 * request or receipt. An unknown extension being ignored is correct A2A behaviour, which
 * is why activation cannot be inferred from the message.
 *
 * @param {string | null | undefined} requestHeader value of the `A2A-Extensions` request header
 * @param {{ declared?: boolean }} [options] `declared` says whether this server's own Agent
 *   Card lists the extension; anything other than `true` means no.
 * @returns {boolean}
 * @throws {ValidationError}
 */
export function isCobExtensionActive(requestHeader, options = {}) {
  if (!isPlainObject(options)) {
    throw new ValidationError('options must be an object with an optional declared boolean');
  }
  if (options.declared !== true) return false;
  return parseA2AExtensions(requestHeader).includes(A2A_EXTENSION_URI);
}

/**
 * Assert that a response echoed the extension URI, which is the only evidence a server
 * processed the envelope.
 *
 * A2A servers ignore extensions they were not asked about, and may ignore this one even
 * when asked (draft §6.3–§6.4). Silence is not a rejection, so a client **must not** treat
 * a `cob.payment.request` as delivered — or any envelope as processed — without this echo.
 *
 * @param {string | null | undefined} responseHeader value of the `A2A-Extensions` response header
 * @returns {void}
 * @throws {ValidationError}
 */
export function assertCobExtensionEchoed(responseHeader) {
  if (parseA2AExtensions(responseHeader).includes(A2A_EXTENSION_URI)) return;
  throw new ValidationError(
    `response did not echo ${A2A_EXTENSION_URI} in ${A2A_EXTENSIONS_HEADER}; refusing to treat the request as delivered`,
    { extension: A2A_EXTENSION_URI },
  );
}
