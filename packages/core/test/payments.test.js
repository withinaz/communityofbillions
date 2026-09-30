import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Payment, StateError, ValidationError } from '../src/index.js';
import { PolicyError } from '../src/errors.js';
import { AgentIdentity } from '../src/identity.js';
import {
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
  createInvoiceId,
  createPaymentReceipt,
  createPaymentRequest,
  createPaymentRequestBody,
  createPaymentReceiptBody,
  displayAmount,
  matchReceipt,
  toBaseUnits,
  validatePaymentReceipt,
  validatePaymentRequest,
} from '../src/payments.js';
import { verifyEnvelope } from '../src/envelope.js';

const alice = AgentIdentity.generate();
const bob = AgentIdentity.generate();

const PAY_TO = '0x1111111111111111111111111111111111111111';
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'ab'.repeat(32)}`;

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function requestBody(overrides = {}) {
  return createPaymentRequestBody({
    chain: 'base-sepolia',
    asset: 'USDC',
    amount: '2.50',
    payTo: PAY_TO,
    memo: 'one summarisation task',
    ...overrides,
  });
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function receiptBody(overrides = {}) {
  return {
    invoiceId: 'inv_fixed',
    chain: 'base-sepolia',
    asset: 'USDC',
    amount: '2.5',
    payer: OTHER_ADDRESS,
    payee: PAY_TO,
    txHash: TX_HASH,
    settledAt: '2026-09-28T12:00:00.000Z',
    blockNumber: 12345678,
    ...overrides,
  };
}

describe('createInvoiceId', () => {
  it('is unique and prefixed', () => {
    const ids = new Set(Array.from({ length: 64 }, () => createInvoiceId()));
    assert.equal(ids.size, 64);
    assert.ok([...ids].every((id) => id.startsWith('inv_')));
  });
});

describe('payment requests', () => {
  it('builds a request on a testnet', () => {
    const body = requestBody();
    assert.equal(body.chain, 'base-sepolia');
    assert.equal(body.asset, 'USDC');
    assert.equal(body.amount, '2.50');
    assert.equal(body.payTo, PAY_TO);
    assert.equal(typeof body.invoiceId, 'string');
    assert.equal(typeof body.validUntil, 'string');
  });

  it('refuses a mainnet request under the default policy', () => {
    assert.throws(
      () => requestBody({ chain: 'base' }),
      (error) => error instanceof PolicyError && /allowMainnet/.test(error.message),
    );
  });

  it('refuses a mainnet request even when the policy asks for the opt-in', () => {
    // The opt-in is locked (issue #7), so this is refused at policy normalisation, before the
    // chain is ever considered.
    assert.throws(() => requestBody({ chain: 'base', policy: { allowMainnet: true } }), PolicyError);
  });

  it('refuses a non-EVM-looking payTo address', () => {
    assert.throws(
      () => requestBody({ payTo: 'bob.eth' }),
      (error) => error instanceof ValidationError && /EVM address/.test(error.message),
    );
    assert.throws(() => requestBody({ payTo: '0x1234' }), ValidationError);
  });

  it('refuses a numeric amount', () => {
    // The single most important input check in the package.
    assert.throws(() => requestBody({ amount: /** @type {any} */ (2.5) }), ValidationError);
  });

  it('refuses an amount with more precision than USDC supports', () => {
    assert.throws(() => requestBody({ amount: '2.5000001' }), ValidationError);
  });

  it('applies a policy ceiling', () => {
    assert.throws(
      () => requestBody({ amount: '500', policy: { maxAmount: { USDC: '100' } } }),
      PolicyError,
    );
  });

  it('refuses a missing invoice id', () => {
    assert.throws(() => requestBody({ invoiceId: '' }), ValidationError);
  });

  it('reports the resolved decimals, network, and chain id', () => {
    const validated = validatePaymentRequest(requestBody());
    assert.equal(validated.decimals, 6);
    assert.equal(validated.network, 'testnet');
    assert.equal(validated.chainId, 84532);
    assert.equal(validated.explorer, 'https://sepolia.basescan.org');
  });
});

describe('signed payment envelopes', () => {
  it('mints a payment request that verifies', () => {
    const envelope = createPaymentRequest({
      identity: alice,
      to: bob.id,
      chain: 'base-sepolia',
      asset: 'USDC',
      amount: '2.50',
      payTo: PAY_TO,
    });
    assert.equal(envelope.type, 'cob.payment.request');
    assert.doesNotThrow(() => verifyEnvelope(envelope, { expectTo: bob.id }));
  });

  it('mints a payment receipt that verifies', () => {
    const envelope = createPaymentReceipt({
      identity: bob,
      to: alice.id,
      invoiceId: 'inv_fixed',
      chain: 'base-sepolia',
      txHash: TX_HASH,
      payer: OTHER_ADDRESS,
      payee: PAY_TO,
    });
    assert.equal(envelope.type, 'cob.payment.receipt');
    assert.doesNotThrow(() => verifyEnvelope(envelope, { expectTo: alice.id }));
  });

  it('requires an identity to sign', () => {
    assert.throws(
      () => createPaymentRequest(/** @type {any} */ ({ to: bob.id, chain: 'base-sepolia', asset: 'USDC', amount: '1', payTo: PAY_TO })),
      ValidationError,
    );
  });
});

describe('validatePaymentReceipt', () => {
  it('accepts a well-formed receipt', () => {
    const validated = validatePaymentReceipt(receiptBody());
    assert.equal(validated.txHash, TX_HASH);
    assert.equal(validated.blockNumber, 12345678);
  });

  it('rejects a malformed transaction hash', () => {
    for (const bad of ['0x1234', 'ab'.repeat(32), `${TX_HASH}00`]) {
      assert.throws(() => validatePaymentReceipt(receiptBody({ txHash: bad })), ValidationError, bad);
    }
  });

  it('rejects an unknown chain', () => {
    assert.throws(() => validatePaymentReceipt(receiptBody({ chain: 'dogechain' })), PolicyError);
  });

  it('accepts a receipt with no block number yet', () => {
    const validated = validatePaymentReceipt(receiptBody({ blockNumber: null }));
    assert.equal(validated.blockNumber, null);
  });

  it('rejects a negative block number', () => {
    assert.throws(() => validatePaymentReceipt(receiptBody({ blockNumber: -1 })), ValidationError);
  });
});

describe('matchReceipt', () => {
  /** @type {Record<string, unknown>} */
  let request;
  /** @type {Record<string, unknown>} */
  let receipt;

  // A request and a matching receipt that share an invoice id.
  const init = () => {
    request = requestBody({ invoiceId: 'inv_fixed' });
    receipt = receiptBody();
  };
  init();

  it('accepts a receipt that settles the request', () => {
    const result = matchReceipt(request, receipt);
    assert.equal(result.matches, true, JSON.stringify(result.problems));
    assert.deepEqual(result.problems, []);
  });

  it('accepts "2.5" as settling "2.50"', () => {
    // Same amount, different spelling. Rejecting this would reject a correct payment.
    const result = matchReceipt(requestBody({ invoiceId: 'inv_fixed', amount: '2.50' }), receiptBody({ amount: '2.5' }));
    assert.equal(result.matches, true);
  });

  it('accepts "2.500000" as settling "2.5"', () => {
    const result = matchReceipt(requestBody({ invoiceId: 'inv_fixed', amount: '2.5' }), receiptBody({ amount: '2.500000' }));
    assert.equal(result.matches, true);
  });

  it('reports an underpayment', () => {
    const result = matchReceipt(request, receiptBody({ amount: '2.49' }));
    assert.equal(result.matches, false);
    assert.ok(result.problems.some((p) => p.code === 'AMOUNT_MISMATCH'));
  });

  it('reports an overpayment as a mismatch too', () => {
    // Overpayment is also a mismatch: it needs a human decision, not silent acceptance.
    const result = matchReceipt(request, receiptBody({ amount: '3' }));
    assert.ok(result.problems.some((p) => p.code === 'AMOUNT_MISMATCH'));
  });

  it('reports a different invoice', () => {
    const result = matchReceipt(request, receiptBody({ invoiceId: 'inv_other' }));
    assert.ok(result.problems.some((p) => p.code === 'INVOICE_MISMATCH'));
  });

  it('reports a different chain', () => {
    const result = matchReceipt(request, receiptBody({ chain: 'ethereum-sepolia' }));
    assert.ok(result.problems.some((p) => p.code === 'CHAIN_MISMATCH'));
  });

  it('reports a different asset', () => {
    const result = matchReceipt(request, receiptBody({ asset: 'ETH' }));
    assert.ok(result.problems.some((p) => p.code === 'ASSET_MISMATCH'));
  });

  it('reports funds sent to the wrong address', () => {
    const result = matchReceipt(request, receiptBody({ payee: OTHER_ADDRESS }));
    assert.ok(result.problems.some((p) => p.code === 'PAYEE_MISMATCH'));
  });

  it('reports a malformed transaction hash', () => {
    const result = matchReceipt(request, receiptBody({ txHash: 'not-a-hash' }));
    assert.ok(result.problems.some((p) => p.code === 'TXHASH_INVALID'));
  });

  it('reports every problem at once, not just the first', () => {
    const result = matchReceipt(request, receiptBody({
      invoiceId: 'inv_other',
      chain: 'ethereum-sepolia',
      asset: 'ETH',
      amount: '99',
      payee: OTHER_ADDRESS,
    }));
    const codes = result.problems.map((p) => p.code).sort();
    assert.deepEqual(codes, ['AMOUNT_MISMATCH', 'ASSET_MISMATCH', 'CHAIN_MISMATCH', 'INVOICE_MISMATCH', 'PAYEE_MISMATCH']);
  });

  it('never reports success when an amount is missing', () => {
    const result = matchReceipt(request, receiptBody({ amount: undefined }));
    assert.equal(result.matches, false);
    assert.ok(result.problems.some((p) => p.code === 'AMOUNT_MISSING'));
  });
});

describe('Payment state machine', () => {
  it('walks the happy path', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    assert.equal(payment.state, 'draft');
    payment.transition('requested');
    payment.transition('authorized');
    payment.transition('submitted');
    payment.transition('settled');
    assert.equal(payment.state, 'settled');
    assert.equal(payment.isTerminal, true);
    assert.equal(payment.history.length, 4);
  });

  it('refuses a jump straight to settled', () => {
    const payment = new Payment(requestBody());
    assert.throws(
      () => payment.transition('settled'),
      (error) => error instanceof StateError && /cannot move/.test(error.message),
    );
    assert.equal(payment.state, 'draft', 'a refused transition must not change state');
  });

  it('refuses to leave a terminal state', () => {
    const payment = new Payment(requestBody());
    payment.transition('requested');
    payment.transition('failed');
    assert.throws(() => payment.transition('authorized'), StateError);
  });

  it('refuses an unknown state', () => {
    const payment = new Payment(requestBody());
    assert.throws(() => payment.transition('refunded'), StateError);
  });

  it('allows expiry from requested and authorized', () => {
    const a = new Payment(requestBody());
    a.transition('requested');
    assert.doesNotThrow(() => a.transition('expired'));

    const b = new Payment(requestBody());
    b.transition('requested');
    b.transition('authorized');
    assert.doesNotThrow(() => b.transition('expired'));
  });

  it('declares every state and keeps transitions in range', () => {
    for (const [from, targets] of Object.entries(PAYMENT_TRANSITIONS)) {
      assert.ok(PAYMENT_STATES.includes(from), `${from} must be a declared state`);
      for (const to of targets) {
        assert.ok(PAYMENT_STATES.includes(to), `${from} -> ${to} targets a declared state`);
      }
    }
  });

  it('has no transitions out of the terminal states', () => {
    for (const terminal of ['settled', 'failed', 'expired']) {
      assert.deepEqual([...PAYMENT_TRANSITIONS[terminal]], []);
    }
  });

  it('reports its reachable next states', () => {
    const payment = new Payment(requestBody());
    assert.deepEqual(payment.nextStates, ['requested', 'failed']);
  });
});

describe('Payment.applyReceipt', () => {
  it('settles a submitted payment whose receipt matches', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    payment.transition('requested');
    payment.transition('authorized');
    payment.transition('submitted');

    const result = payment.applyReceipt(receiptBody());
    assert.equal(result.settled, true);
    assert.equal(payment.state, 'settled');
  });

  it('refuses a receipt that does not match, and stays put', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    payment.transition('requested');
    payment.transition('authorized');
    payment.transition('submitted');

    const result = payment.applyReceipt(receiptBody({ amount: '0.01' }));
    assert.equal(result.settled, false);
    assert.equal(payment.state, 'submitted');
    assert.ok(result.problems.length > 0);
  });

  it('refuses a second, identical receipt — this is the double-spend guard', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    payment.transition('requested');
    payment.transition('authorized');
    payment.transition('submitted');
    payment.applyReceipt(receiptBody());

    const replay = payment.applyReceipt(receiptBody());
    assert.equal(replay.settled, false);
    assert.equal(replay.problems[0].code, 'UNEXPECTED_RECEIPT');
    assert.equal(payment.state, 'settled');
    assert.equal(payment.history.filter((h) => h.to === 'settled').length, 1);
  });

  it('refuses a receipt that arrives before anything was submitted', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    payment.transition('requested');
    const result = payment.applyReceipt(receiptBody());
    assert.equal(result.settled, false);
    assert.equal(result.problems[0].code, 'UNEXPECTED_RECEIPT');
  });

  it('summarises itself with an explorer link', () => {
    const payment = new Payment(requestBody({ invoiceId: 'inv_fixed' }));
    payment.transition('requested');
    payment.transition('authorized');
    payment.transition('submitted');
    payment.applyReceipt(receiptBody());

    const summary = payment.summary();
    assert.equal(summary.state, 'settled');
    assert.equal(summary.amount, '2.50 USDC');
    assert.equal(summary.explorerUrl, `https://sepolia.basescan.org/tx/${TX_HASH}`);
  });

  it('has no explorer link before settlement', () => {
    const payment = new Payment(requestBody());
    payment.transition('requested');
    assert.equal(payment.summary().explorerUrl, null);
  });
});

describe('amount display helpers', () => {
  it('converts and formats through base units', () => {
    assert.equal(toBaseUnits('2.50', 'USDC'), 2_500_000n);
    assert.equal(displayAmount(2_500_000n, 'USDC'), '2.5');
    assert.equal(displayAmount(1n, 'USDC'), '0.000001');
  });

  it('refuses an unknown asset', () => {
    assert.throws(() => displayAmount(1n, 'DOGE'), ValidationError);
  });
});

describe('createPaymentReceiptBody', () => {
  it('stamps a settlement time by default', () => {
    const body = createPaymentReceiptBody({
      invoiceId: 'inv_x',
      chain: 'base-sepolia',
      txHash: TX_HASH,
      payer: OTHER_ADDRESS,
      payee: PAY_TO,
    });
    assert.match(String(body.settledAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(body.blockNumber, null);
  });
});
