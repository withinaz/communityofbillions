/**
 * `@communityofbillions/core` — public entry point.
 *
 * Everything a peer implementation needs to speak COB/1:
 *
 * ```js
 * import { AgentIdentity, createEnvelope, verifyEnvelope, Payment } from '@communityofbillions/core';
 *
 * const alice = AgentIdentity.generate();
 * const bob = AgentIdentity.generate();
 *
 * const envelope = createEnvelope({
 *   identity: alice,
 *   to: bob.id,
 *   type: 'cob.message',
 *   body: { text: 'hello' },
 * });
 *
 * verifyEnvelope(envelope, { expectTo: bob.id }); // throws if anything is wrong
 * ```
 */

export { canonicalize, canonicalBytes } from './canonical.js';

export {
  CobError,
  CanonicalizationError,
  ValidationError,
  SignatureError,
  ExpiredError,
  PolicyError,
  StateError,
} from './errors.js';

export {
  ASSET_DECIMALS,
  isDecimalString,
  assertDecimalString,
  decimalsFor,
  parseAmountToBaseUnits,
  formatBaseUnits,
  compareAmounts,
} from './amount.js';

export {
  AGENT_ID_PREFIX,
  SECRET_FILE_TYPE,
  AgentIdentity,
  agentIdFromPublicKey,
  publicKeyFromAgentId,
  isAgentId,
  assertAgentId,
  shortAgentId,
  verifySignature,
  verifyValueSignature,
} from './identity.js';

export {
  COB_VERSION,
  MESSAGE_TYPES,
  SIGNED_FIELDS,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  assertInstant,
  assertMessageType,
  signingPayload,
  envelopeDigest,
  createEnvelope,
  validateStructure,
  verifyEnvelope,
  checkEnvelope,
  senderDescriptor,
  isEnvelope,
} from './envelope.js';

export {
  CHAIN_REGISTRY,
  DEFAULT_POLICY,
  isKnownChain,
  resolveChain,
  normalizePolicy,
  assertMainnetAllowed,
  assertChainAllowed,
  assertAssetAllowed,
  assertAmountAllowed,
  assertPaymentAllowed,
  explorerTxUrl,
} from './policy.js';

export {
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
  Payment,
  createInvoiceId,
  validatePaymentRequest,
  createPaymentRequestBody,
  createPaymentRequest,
  validatePaymentReceipt,
  createPaymentReceiptBody,
  createPaymentReceipt,
  matchReceipt,
  displayAmount,
  toBaseUnits,
} from './payments.js';

/**
 * Version of the reference implementation.
 *
 * This is the *software* version. It is deliberately separate from {@link COB_VERSION},
 * which is the wire format: the implementation will move much faster than the protocol,
 * and a reader of a captured envelope should never have to guess which of the two they
 * are looking at.
 */
export const IMPLEMENTATION_VERSION = '0.1.0';
