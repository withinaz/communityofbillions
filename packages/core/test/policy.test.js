import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PolicyError, ValidationError } from '../src/errors.js';
import {
  CHAIN_REGISTRY,
  DEFAULT_POLICY,
  assertAmountAllowed,
  assertAssetAllowed,
  assertChainAllowed,
  assertMainnetAllowed,
  assertPaymentAllowed,
  explorerTxUrl,
  isKnownChain,
  normalizePolicy,
  resolveChain,
} from '../src/policy.js';

describe('chain registry', () => {
  it('knows testnets and mainnets', () => {
    assert.equal(isKnownChain('base-sepolia'), true);
    assert.equal(isKnownChain('ethereum-sepolia'), true);
    assert.equal(isKnownChain('base'), true);
    assert.equal(isKnownChain('ethereum'), true);
    assert.equal(isKnownChain('solana'), false);
    assert.equal(isKnownChain(''), false);
    assert.equal(isKnownChain(undefined), false);
  });

  it('carries CAIP-2 identifiers so non-EVM chains can join later', () => {
    assert.equal(CHAIN_REGISTRY['base-sepolia'].caip2, 'eip155:84532');
    assert.equal(CHAIN_REGISTRY.base.caip2, 'eip155:8453');
  });

  it('labels each chain as testnet or mainnet', () => {
    assert.equal(CHAIN_REGISTRY['base-sepolia'].network, 'testnet');
    assert.equal(CHAIN_REGISTRY.base.network, 'mainnet');
  });

  it('refuses to resolve an unknown chain', () => {
    assert.throws(
      () => resolveChain('dogechain'),
      (error) => error instanceof PolicyError && /unknown chain/.test(error.message),
    );
  });
});

describe('the mainnet gate', () => {
  it('is off by default', () => {
    assert.equal(DEFAULT_POLICY.allowMainnet, false);
  });

  it('allows testnets out of the box', () => {
    assert.doesNotThrow(() => assertChainAllowed('base-sepolia', DEFAULT_POLICY));
    assert.doesNotThrow(() => assertChainAllowed('ethereum-sepolia', DEFAULT_POLICY));
  });

  it('refuses mainnet out of the box', () => {
    assert.throws(
      () => assertChainAllowed('base', DEFAULT_POLICY),
      (error) => error instanceof PolicyError && /allowMainnet=false/.test(error.message),
    );
    assert.throws(() => assertChainAllowed('ethereum', DEFAULT_POLICY), PolicyError);
  });

  it('refuses the opt-in itself, deliberately, and says why', () => {
    // The lock is the opt-in, not the chain. The message must read as a decision, and it must
    // name the issue so that a caller who trips it can find the reasoning instead of a bug report.
    assert.throws(
      () => normalizePolicy({ allowMainnet: true }),
      (error) =>
        error instanceof PolicyError
        && /deliberately refused/.test(error.message)
        && /issue #7/.test(error.message),
    );
    assert.throws(() => assertChainAllowed('base', { allowMainnet: true }), PolicyError);
  });

  it('keeps the mainnet check correct behind the lock', () => {
    // normalizePolicy can no longer produce a policy that permits mainnet, so the "allowed"
    // side of the check is exercised directly. It is the check that will guard mainnet the day
    // the operator unlocks it; it must not rot while it waits.
    const base = resolveChain('base');
    const sepolia = resolveChain('base-sepolia');
    assert.throws(() => assertMainnetAllowed('base', base, false), PolicyError);
    assert.doesNotThrow(() => assertMainnetAllowed('base', base, true));
    assert.doesNotThrow(() => assertMainnetAllowed('base-sepolia', sepolia, false));
  });

  it('honours an allow-list', () => {
    assert.doesNotThrow(() => assertChainAllowed('base-sepolia', { allowedChains: ['base-sepolia'] }));
    assert.throws(
      () => assertChainAllowed('ethereum-sepolia', { allowedChains: ['base-sepolia'] }),
      (error) => error instanceof PolicyError && /allow-list/.test(error.message),
    );
  });

  it('still refuses mainnet when the allow-list names it but allowMainnet is false', () => {
    // Two independent gates. Naming a chain in the allow-list must not silently unlock mainnet.
    assert.throws(
      () => assertChainAllowed('base', { allowedChains: ['base'], allowMainnet: false }),
      PolicyError,
    );
  });
});

describe('asset policy', () => {
  it('accepts assets the chain carries', () => {
    assert.equal(assertAssetAllowed('base-sepolia', 'USDC'), 'USDC');
    assert.equal(assertAssetAllowed('base-sepolia', 'ETH'), 'ETH');
  });

  it('refuses an asset the chain does not carry', () => {
    assert.throws(
      () => assertAssetAllowed('base-sepolia', 'DOGE'),
      (error) => error instanceof PolicyError && /not supported/.test(error.message),
    );
  });

  it('honours an asset allow-list', () => {
    assert.doesNotThrow(() => assertAssetAllowed('base-sepolia', 'USDC', { allowedAssets: ['USDC'] }));
    assert.throws(
      () => assertAssetAllowed('base-sepolia', 'ETH', { allowedAssets: ['USDC'] }),
      PolicyError,
    );
  });

  it('applies the chain gate first', () => {
    // Asking about an asset on a forbidden chain must fail on the chain, not the asset.
    assert.throws(
      () => assertAssetAllowed('base', 'USDC', DEFAULT_POLICY),
      (error) => error instanceof PolicyError && /allowMainnet/.test(error.message),
    );
  });
});

describe('amount ceilings', () => {
  it('does nothing when no ceiling is configured', () => {
    assert.equal(assertAmountAllowed('USDC', '1000000', DEFAULT_POLICY), '1000000');
  });

  it('allows an amount exactly at the ceiling', () => {
    assert.doesNotThrow(() => assertAmountAllowed('USDC', '100', { maxAmount: { USDC: '100' } }));
    assert.doesNotThrow(() => assertAmountAllowed('USDC', '100.00', { maxAmount: { USDC: '100' } }));
  });

  it('rejects an amount above the ceiling, including by one base unit', () => {
    // "100.000001" > "100" numerically but not lexicographically. A string comparison
    // would let this through, which is exactly the kind of bug this test exists for.
    assert.throws(
      () => assertAmountAllowed('USDC', '100.000001', { maxAmount: { USDC: '100' } }),
      (error) => error instanceof PolicyError && /exceeds the policy ceiling/.test(error.message),
    );
  });

  it('is not fooled by lexicographic ordering', () => {
    // As strings, "9" > "10". As amounts, 9 < 10, so this must pass. A ceiling check
    // implemented with a string comparison would wrongly reject it.
    assert.doesNotThrow(() => assertAmountAllowed('USDC', '9', { maxAmount: { USDC: '10' } }));
  });

  it('applies ceilings per asset', () => {
    const policy = { maxAmount: { USDC: '10', ETH: '1' } };
    assert.doesNotThrow(() => assertAmountAllowed('ETH', '1', policy));
    assert.throws(() => assertAmountAllowed('USDC', '11', policy), PolicyError);
  });

  it('rejects a malformed amount before consulting the ceiling', () => {
    assert.throws(() => assertAmountAllowed('USDC', '1e5', { maxAmount: { USDC: '10' } }), ValidationError);
  });
});

describe('assertPaymentAllowed', () => {
  it('returns the resolved payment facts on success', () => {
    const result = assertPaymentAllowed({ chain: 'base-sepolia', asset: 'USDC', amount: '2.50' });
    assert.deepEqual(result, {
      chain: 'base-sepolia',
      asset: 'USDC',
      amount: '2.50',
      decimals: 6,
      network: 'testnet',
      chainId: 84532,
    });
  });

  it('refuses a mainnet payment under the default policy', () => {
    assert.throws(
      () => assertPaymentAllowed({ chain: 'base', asset: 'USDC', amount: '1' }),
      PolicyError,
    );
  });

  it('refuses a malformed payment object', () => {
    assert.throws(() => assertPaymentAllowed(/** @type {any} */ (null)), ValidationError);
  });
});

describe('normalizePolicy', () => {
  it('fills in the defaults', () => {
    assert.deepEqual(normalizePolicy(), {
      allowMainnet: false,
      allowUnlimited: true,
      allowedChains: null,
      allowedAssets: null,
      maxAmount: {},
    });
  });

  it('names the absence of a spending ceiling', () => {
    // The flag describes today's behaviour exactly: no maxAmount means no ceiling. It is
    // carried now so that the configuration permitting unbounded spend is visible later.
    assert.equal(DEFAULT_POLICY.allowUnlimited, true);
    assert.equal(normalizePolicy().allowUnlimited, true);
    assert.equal(normalizePolicy({ allowUnlimited: false }).allowUnlimited, false);
  });

  it('copies arrays rather than aliasing the caller’s', () => {
    const allowedChains = ['base-sepolia'];
    const normalized = normalizePolicy({ allowedChains });
    allowedChains.push('base');
    assert.deepEqual(normalized.allowedChains, ['base-sepolia']);
  });

  it('rejects nonsense', () => {
    assert.throws(() => normalizePolicy({ allowMainnet: 'yes' }), ValidationError);
    assert.throws(() => normalizePolicy({ allowUnlimited: 'yes' }), ValidationError);
    assert.throws(() => normalizePolicy({ allowedChains: 'base-sepolia' }), ValidationError);
    assert.throws(() => normalizePolicy({ allowedChains: ['nope'] }), PolicyError);
    assert.throws(() => normalizePolicy({ maxAmount: { USDC: 10 } }), ValidationError);
    assert.throws(() => normalizePolicy({ maxAmount: [] }), ValidationError);
  });
});

describe('explorerTxUrl', () => {
  it('links testnet transactions', () => {
    const hash = `0x${'a'.repeat(64)}`;
    assert.equal(explorerTxUrl('base-sepolia', hash), `https://sepolia.basescan.org/tx/${hash}`);
  });

  it('returns null for an unknown chain instead of inventing a URL', () => {
    assert.equal(explorerTxUrl('dogechain', `0x${'a'.repeat(64)}`), null);
  });
});
