/**
 * Payment messages and their lifecycle.
 *
 * This module models the *conversation*, not the blockchain. Nothing here signs a
 * transaction or talks to an RPC endpoint — that is Phase 2. What it does do is make the
 * two mistakes that cost money impossible to make quietly:
 *
 * - paying an invoice twice (see {@link Payment} and its terminal states), and
 * - accepting a receipt that does not match the request it claims to settle
 *   (see {@link matchReceipt}).
 */

import { randomUUID } from 'node:crypto';

import {
  assertDecimalString,
  compareAmounts,
  decimalsFor,
  formatBaseUnits,
  parseAmountToBaseUnits,
} from './amount.js';
import { assertInstant, createEnvelope } from './envelope.js';
import { StateError, ValidationError } from './errors.js';
import { assertPaymentAllowed, explorerTxUrl, resolveChain } from './policy.js';

/** Every state a payment can be in. Terminal states have no outgoing transitions. */
export const PAYMENT_STATES = Object.freeze([
  /** Created locally, not yet sent. */
  'draft',
  /** `cob.payment.request` sent, awaiting the payer. */
  'requested',
  /** Payer acknowledged and is expected to send funds. */
  'authorized',
  /** A transaction hash exists but is not yet confirmed. */
  'submitted',
  /** Confirmed on chain and matched against the request. */
  'settled',
  /** Abandoned or rejected. Terminal. */
  'failed',
  /** Validity window passed with no settlement. Terminal. */
  'expired',
]);

/** Allowed transitions. Anything absent here is refused. */
export const PAYMENT_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['requested', 'failed']),
  requested: Object.freeze(['authorized', 'expired', 'failed']),
  authorized: Object.freeze(['submitted', 'expired', 'failed']),
  submitted: Object.freeze(['settled', 'failed']),
  settled: Object.freeze([]),
  failed: Object.freeze([]),
  expired: Object.freeze([]),
});

/** EVM address, checksum casing not enforced. */
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Transaction hash: 32 bytes, hex. */
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * @returns {string} a fresh invoice identifier
 */
export function createInvoiceId() {
  return `inv_${randomUUID()}`;
}

/**
 * Validate the body of a `cob.payment.request`.
 *
 * @param {Record<string, unknown>} body
 * @param {{ policy?: object, now?: Date }} [options]
 * @returns {{
 *   invoiceId: string, chain: string, asset: string, amount: string, decimals: number,
 *   payTo: string, memo: string | null, validUntil: string, network: string, chainId: number,
 *   explorer: string,
 * }}
 * @throws {ValidationError | PolicyError}
 */
export function validatePaymentRequest(body, options = {}) {
  const { policy = undefined, now = new Date() } = options;

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('payment request body must be a plain object');
  }

  const invoiceId = requireString(body.invoiceId, 'invoiceId', 128);
  const chain = requireString(body.chain, 'chain', 64);
  const asset = requireString(body.asset, 'asset', 16);
  assertDecimalString(body.amount, 'amount');
  const amount = /** @type {string} */ (body.amount);

  const allowed = assertPaymentAllowed({ chain, asset, amount }, /** @type {any} */ (policy));

  const payTo = requireString(body.payTo, 'payTo', 128);
  const resolved = resolveChain(chain);
  if (resolved.kind === 'evm' && !EVM_ADDRESS_PATTERN.test(payTo)) {
    throw new ValidationError('payTo must be a 20-byte EVM address for an EVM chain', { payTo });
  }

  const memo = body.memo === undefined || body.memo === null
    ? null
    : requireString(body.memo, 'memo', 512);

  // §8.2: validUntil bounds how long the payer should treat the invoice as live, and a
  // receiver applies it to a value the sender chose. Parsing it here means `new Date(...)`
  // in a receiver can never be handed an arbitrary string.
  const validUntil = body.validUntil === undefined
    ? new Date(now.getTime() + 900_000).toISOString()
    : /** @type {string} */ (body.validUntil);
  assertInstant(validUntil, 'validUntil');

  return {
    invoiceId,
    chain,
    asset,
    amount,
    decimals: allowed.decimals,
    payTo,
    memo,
    validUntil,
    network: allowed.network,
    chainId: allowed.chainId,
    explorer: resolved.explorer,
  };
}

/**
 * Build (but do not sign) a payment request body.
 *
 * @param {{
 *   chain: string,
 *   asset: string,
 *   amount: string,
 *   payTo: string,
 *   invoiceId?: string,
 *   memo?: string,
 *   validForSeconds?: number,
 *   now?: Date,
 *   policy?: object,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function createPaymentRequestBody(options) {
  const {
    chain,
    asset,
    amount,
    payTo,
    invoiceId = createInvoiceId(),
    memo = undefined,
    validForSeconds = 900,
    now = new Date(),
    policy = undefined,
  } = options;

  if (!Number.isInteger(validForSeconds) || validForSeconds <= 0) {
    throw new ValidationError('validForSeconds must be a positive integer', { validForSeconds });
  }

  validatePaymentRequest(
    { invoiceId, chain, asset, amount, payTo, memo },
    { policy, now },
  );

  return {
    invoiceId,
    chain,
    asset,
    amount,
    payTo,
    ...(memo === undefined ? {} : { memo }),
    validUntil: new Date(now.getTime() + validForSeconds * 1000).toISOString(),
  };
}

/**
 * Mint a signed `cob.payment.request` envelope.
 *
 * @param {Parameters<typeof createPaymentRequestBody>[0] & { identity: import('./identity.js').AgentIdentity, to: string, ttlSeconds?: number }} options
 * @returns {Record<string, unknown>}
 */
export function createPaymentRequest(options) {
  const { identity, to, ttlSeconds = undefined, ...rest } = options;
  if (identity === undefined) {
    throw new ValidationError('identity is required to sign a payment request');
  }
  const body = createPaymentRequestBody(rest);
  return createEnvelope({ identity, to, type: 'cob.payment.request', body, ttlSeconds });
}

/**
 * Validate the body of a `cob.payment.receipt`.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ invoiceId: string, chain: string, txHash: string, payer: string, payee: string, settledAt: string, blockNumber: number | null }}
 * @throws {ValidationError}
 */
export function validatePaymentReceipt(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('payment receipt body must be a plain object');
  }

  const invoiceId = requireString(body.invoiceId, 'invoiceId', 128);
  const chain = requireString(body.chain, 'chain', 64);
  const txHash = requireString(body.txHash, 'txHash', 66);
  resolveChain(chain);

  if (!TX_HASH_PATTERN.test(txHash)) {
    throw new ValidationError('txHash must be a 32-byte hex string prefixed with 0x', { txHash });
  }

  const payer = requireString(body.payer, 'payer', 128);
  const payee = requireString(body.payee, 'payee', 128);
  const settledAt = requireString(body.settledAt, 'settledAt', 64);
  // §8.3: settledAt is a required instant, not free text. A receipt is a claim (§8.3), but
  // a malformed claim should not reach a consumer that assumes the field parses.
  assertInstant(settledAt, 'settledAt');

  const blockNumber = body.blockNumber === undefined || body.blockNumber === null
    ? null
    : body.blockNumber;
  if (blockNumber !== null && (!Number.isInteger(blockNumber) || blockNumber < 0)) {
    throw new ValidationError('blockNumber must be a non-negative integer when present', { blockNumber });
  }

  return { invoiceId, chain, txHash, payer, payee, settledAt, blockNumber };
}

/**
 * @param {{ invoiceId: string, chain: string, txHash: string, payer: string, payee: string, settledAt?: string, blockNumber?: number | null }} options
 * @returns {Record<string, unknown>}
 */
export function createPaymentReceiptBody(options) {
  const { settledAt = new Date().toISOString(), blockNumber = null, ...rest } = options;
  const body = { ...rest, settledAt, blockNumber };
  validatePaymentReceipt(body);
  return body;
}

/**
 * Mint a signed `cob.payment.receipt` envelope.
 *
 * @param {{ identity: import('./identity.js').AgentIdentity, to: string, invoiceId: string, chain: string, txHash: string, payer: string, payee: string, settledAt?: string, blockNumber?: number | null, ttlSeconds?: number }} options
 * @returns {Record<string, unknown>}
 */
export function createPaymentReceipt(options) {
  const { identity, to, ttlSeconds = undefined, ...rest } = options;
  if (identity === undefined) {
    throw new ValidationError('identity is required to sign a payment receipt');
  }
  const body = createPaymentReceiptBody(rest);
  return createEnvelope({ identity, to, type: 'cob.payment.receipt', body, ttlSeconds });
}

/**
 * Compare a receipt against the request it claims to settle.
 *
 * Returns every problem found rather than the first one: a payer debugging a rejected
 * receipt should learn all the ways it is wrong in one round trip.
 *
 * @param {Record<string, unknown>} requestBody a `cob.payment.request` body
 * @param {Record<string, unknown>} receiptBody a `cob.payment.receipt` body
 * @returns {{ matches: boolean, problems: Array<{ code: string, message: string, expected?: unknown, actual?: unknown }> }}
 */
export function matchReceipt(requestBody, receiptBody) {
  /** @type {Array<{ code: string, message: string, expected?: unknown, actual?: unknown }>} */
  const problems = [];

  if (requestBody?.invoiceId !== receiptBody?.invoiceId) {
    problems.push({
      code: 'INVOICE_MISMATCH',
      message: 'receipt does not reference the request invoice',
      expected: requestBody?.invoiceId,
      actual: receiptBody?.invoiceId,
    });
  }

  if (requestBody?.chain !== receiptBody?.chain) {
    problems.push({
      code: 'CHAIN_MISMATCH',
      message: 'receipt is for a different chain',
      expected: requestBody?.chain,
      actual: receiptBody?.chain,
    });
  }

  if (requestBody?.asset !== receiptBody?.asset) {
    problems.push({
      code: 'ASSET_MISMATCH',
      message: 'receipt is for a different asset',
      expected: requestBody?.asset,
      actual: receiptBody?.asset,
    });
  }

  // Amounts are compared by value. "2.5" settling "2.50" is a correct payment,
  // and reporting it as a mismatch would be a bug with real consequences.
  if (typeof requestBody?.amount === 'string' && typeof receiptBody?.amount === 'string') {
    let equal = false;
    try {
      const decimals = decimalsFor(
        String(requestBody.asset),
        typeof requestBody.decimals === 'number' ? requestBody.decimals : undefined,
      );
      equal = compareAmounts(requestBody.amount, receiptBody.amount, decimals) === 0;
      if (!equal) {
        problems.push({
          code: 'AMOUNT_MISMATCH',
          message: 'receipt amount differs from the requested amount',
          expected: `${requestBody.amount} ${requestBody.asset}`,
          actual: `${receiptBody.amount} ${receiptBody.asset}`,
        });
      }
    } catch {
      problems.push({
        code: 'AMOUNT_UNCOMPARABLE',
        message: 'amounts could not be compared by value',
        expected: requestBody.amount,
        actual: receiptBody.amount,
      });
    }
  } else {
    problems.push({
      code: 'AMOUNT_MISSING',
      message: 'both the request and the receipt must carry a decimal-string amount',
      expected: requestBody?.amount,
      actual: receiptBody?.amount,
    });
  }

  if (requestBody?.payTo !== receiptBody?.payee) {
    problems.push({
      code: 'PAYEE_MISMATCH',
      message: 'funds were not sent to the address named in the request',
      expected: requestBody?.payTo,
      actual: receiptBody?.payee,
    });
  }

  if (typeof receiptBody?.txHash !== 'string' || !TX_HASH_PATTERN.test(receiptBody.txHash)) {
    problems.push({
      code: 'TXHASH_INVALID',
      message: 'receipt does not carry a well-formed transaction hash',
      actual: receiptBody?.txHash,
    });
  }

  return { matches: problems.length === 0, problems };
}

/**
 * A single payment's local state, with a history. Prevents double settlement by construction:
 * `settled`, `failed`, and `expired` have no outgoing transitions.
 */
export class Payment {
  /**
   * @param {Record<string, unknown>} requestBody a validated `cob.payment.request` body
   */
  constructor(requestBody) {
    if (requestBody === null || typeof requestBody !== 'object') {
      throw new ValidationError('Payment requires a payment request body');
    }
    this.request = { ...requestBody };
    this.invoiceId = String(requestBody.invoiceId);
    /** @type {string} */
    this.state = 'draft';
    /** @type {Array<{ from: string, to: string, at: string, note: string | null }>} */
    this.history = [];
  }

  /** @returns {boolean} */
  get isTerminal() {
    return PAYMENT_TRANSITIONS[/** @type {keyof typeof PAYMENT_TRANSITIONS} */ (this.state)].length === 0;
  }

  /** @returns {string[]} states reachable from the current one */
  get nextStates() {
    return [...PAYMENT_TRANSITIONS[/** @type {keyof typeof PAYMENT_TRANSITIONS} */ (this.state)]];
  }

  /**
   * Move to a new state.
   *
   * @param {string} to
   * @param {{ at?: Date, note?: string }} [options]
   * @returns {this}
   * @throws {StateError}
   */
  transition(to, options = {}) {
    const { at = new Date(), note = null } = options;
    const from = this.state;

    if (!PAYMENT_STATES.includes(to)) {
      throw new StateError(`unknown payment state "${to}"`, { to, known: [...PAYMENT_STATES] });
    }
    const allowed = PAYMENT_TRANSITIONS[/** @type {keyof typeof PAYMENT_TRANSITIONS} */ (from)];
    if (!allowed.includes(to)) {
      throw new StateError(`cannot move a payment from "${from}" to "${to}"`, {
        from,
        to,
        allowed: [...allowed],
      });
    }

    this.state = to;
    this.history.push({ from, to, at: at.toISOString(), note });
    return this;
  }

  /**
   * Apply a receipt: check it against the request and, if it matches, settle.
   *
   * @param {Record<string, unknown>} receiptBody
   * @param {{ at?: Date, requireState?: string }} [options]
   * @returns {{ settled: boolean, problems: Array<{ code: string, message: string }> }}
   */
  applyReceipt(receiptBody, options = {}) {
    const { at = new Date(), requireState = 'submitted' } = options;
    const { matches, problems } = matchReceipt(this.request, receiptBody);
    if (!matches) return { settled: false, problems };

    if (this.state !== requireState) {
      // A matching receipt for a payment that is not awaiting one is either a replay or a
      // duplicate. Both must be refused; neither is a reason to move money.
      return {
        settled: false,
        problems: [{
          code: 'UNEXPECTED_RECEIPT',
          message: `a matching receipt arrived while the payment was in state "${this.state}"`,
        }],
      };
    }

    this.transition('settled', { at, note: String(receiptBody.txHash) });
    return { settled: true, problems: [] };
  }

  /**
   * Human-readable summary, including an explorer link when the chain is known.
   *
   * @returns {Record<string, unknown>}
   */
  summary() {
    const chain = String(this.request.chain ?? '');
    const last = this.history.at(-1);
    const txHash = typeof last?.note === 'string' ? last.note : null;
    return {
      invoiceId: this.invoiceId,
      state: this.state,
      amount: `${this.request.amount} ${this.request.asset}`,
      chain,
      payTo: this.request.payTo,
      explorerUrl: txHash === null ? null : explorerTxUrl(chain, txHash),
      history: this.history.map((h) => ({ ...h })),
    };
  }
}

/**
 * Format an amount for display, given its base units. Exposed for callers that only have
 * the integer form (an RPC response, for example).
 *
 * @param {bigint} baseUnits
 * @param {string} asset
 * @returns {string}
 */
export function displayAmount(baseUnits, asset) {
  return formatBaseUnits(baseUnits, decimalsFor(asset));
}

/**
 * Re-export so callers do not have to reach into `amount.js` for the common case.
 *
 * @param {string} amount
 * @param {string} asset
 * @returns {bigint}
 */
export function toBaseUnits(amount, asset) {
  return parseAmountToBaseUnits(amount, decimalsFor(asset));
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 * @throws {ValidationError}
 */
function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`, { field, value });
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters`, {
      field,
      length: value.length,
    });
  }
  return value;
}
