import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareAmounts,
  decimalsFor,
  formatBaseUnits,
  isDecimalString,
  parseAmountToBaseUnits,
} from '../src/amount.js';
import { ValidationError } from '../src/errors.js';

describe('isDecimalString', () => {
  it('accepts plain decimals', () => {
    for (const value of ['0', '1', '12', '0.5', '2.50', '1000000', '0.000001']) {
      assert.equal(isDecimalString(value), true, `${value} should be accepted`);
    }
  });

  it('rejects floats, exponent notation, signs, and padding', () => {
    for (const value of ['', '.5', '5.', '1e5', '-1', '+1', ' 1', '1 ', '01', '1,5', 'abc', 'Infinity']) {
      assert.equal(isDecimalString(value), false, `${value} should be rejected`);
    }
  });

  it('rejects non-strings, including numbers', () => {
    // The whole point: a JSON number must never reach the amount path.
    for (const value of [1, 2.5, null, undefined, {}, [], true]) {
      assert.equal(isDecimalString(value), false);
    }
  });
});

describe('parseAmountToBaseUnits', () => {
  it('converts human units to integer base units', () => {
    assert.equal(parseAmountToBaseUnits('2.50', 6), 2_500_000n);
    assert.equal(parseAmountToBaseUnits('1', 6), 1_000_000n);
    assert.equal(parseAmountToBaseUnits('0', 6), 0n);
    assert.equal(parseAmountToBaseUnits('1', 18), 10n ** 18n);
    assert.equal(parseAmountToBaseUnits('0.000001', 6), 1n);
  });

  it('pads a short fraction correctly', () => {
    assert.equal(parseAmountToBaseUnits('1.5', 6), 1_500_000n);
    assert.equal(parseAmountToBaseUnits('1.0000001', 8), 100_000_010n);
  });

  it('refuses more precision than the asset supports', () => {
    // Silently truncating here would lose someone's money.
    assert.throws(
      () => parseAmountToBaseUnits('1.0000001', 6),
      (error) => error instanceof ValidationError && /more precision/.test(error.message),
    );
  });

  it('refuses malformed input', () => {
    assert.throws(() => parseAmountToBaseUnits('1e5', 6), ValidationError);
    assert.throws(() => parseAmountToBaseUnits(-1, 6), ValidationError);
  });
});

describe('formatBaseUnits', () => {
  it('round-trips through base units', () => {
    for (const amount of ['0', '1', '2.5', '2.50', '0.000001', '123456.789']) {
      const decimals = 6;
      assert.equal(formatBaseUnits(parseAmountToBaseUnits(amount, decimals), decimals), trimZeros(amount));
    }
  });

  it('round-trips generated valid amounts across decimal counts', () => {
    const seed = 0xC0B10001;
    const random = createSeededRandom(seed);
    const cases = [
      { amount: '0', decimals: 0 },
      { amount: '1', decimals: 0 },
      { amount: '42', decimals: 0 },
    ];

    for (let index = 0; index < 500; index += 1) {
      const decimals = index < 19 ? index : random.integer(19);
      cases.push({ amount: randomAmount(random, decimals), decimals });
    }

    for (const { amount, decimals } of cases) {
      let baseUnits;
      assert.doesNotThrow(() => {
        baseUnits = parseAmountToBaseUnits(amount, decimals);
      }, `seed ${seed}: parseAmountToBaseUnits(${amount}, ${decimals}) should not throw`);

      const formatted = formatBaseUnits(baseUnits, decimals);
      assert.equal(
        compareAmounts(formatted, amount, decimals),
        0,
        `seed ${seed}: ${formatted} should be numerically equal to ${amount} with ${decimals} decimals`,
      );
    }
  });

  it('trims trailing zeros', () => {
    assert.equal(formatBaseUnits(2_500_000n, 6), '2.5');
    assert.equal(formatBaseUnits(1_000_000n, 6), '1');
  });

  it('pads small fractions', () => {
    assert.equal(formatBaseUnits(1n, 6), '0.000001');
    assert.equal(formatBaseUnits(10n, 6), '0.00001');
  });

  it('handles zero and negatives', () => {
    assert.equal(formatBaseUnits(0n, 6), '0');
    assert.equal(formatBaseUnits(-2_500_000n, 6), '-2.5');
  });

  it('requires a bigint', () => {
    assert.throws(() => formatBaseUnits(1, 6), ValidationError);
  });
});

describe('compareAmounts', () => {
  it('compares by value, not by string', () => {
    assert.equal(compareAmounts('2.50', '2.5', 6), 0);
    assert.equal(compareAmounts('1', '1.000000', 6), 0);
  });

  it('orders correctly', () => {
    assert.equal(compareAmounts('1', '2', 6), -1);
    assert.equal(compareAmounts('2', '1', 6), 1);
    assert.equal(compareAmounts('0.000001', '0.000000', 6), 1);
  });

  it('is not fooled by lexicographic ordering', () => {
    // "9" > "10" as strings; as amounts it is the other way round.
    assert.equal(compareAmounts('9', '10', 6), -1);
  });
});

describe('decimalsFor', () => {
  it('knows the stablecoins we care about', () => {
    assert.equal(decimalsFor('USDC'), 6);
    assert.equal(decimalsFor('USDT'), 6);
    assert.equal(decimalsFor('DAI'), 18);
    assert.equal(decimalsFor('ETH'), 18);
  });

  it('refuses to guess for an unknown asset', () => {
    assert.throws(
      () => decimalsFor('DOGE'),
      (error) => error instanceof ValidationError && /unknown asset/.test(error.message),
    );
  });

  it('accepts an explicit override', () => {
    assert.equal(decimalsFor('WBTC', 8), 8);
  });

  it('rejects a nonsensical override', () => {
    assert.throws(() => decimalsFor('WBTC', -1), ValidationError);
    assert.throws(() => decimalsFor('WBTC', 40), ValidationError);
  });
});

/**
 * @param {string} amount
 * @returns {string}
 */
function trimZeros(amount) {
  if (!amount.includes('.')) return amount;
  return amount.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * @param {number} seed
 * @returns {{ integer(limit: number): number }}
 */
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return {
    integer(limit) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % limit;
    },
  };
}

/**
 * @param {{ integer(limit: number): number }} random
 * @param {number} decimals
 * @returns {string}
 */
function randomAmount(random, decimals) {
  const whole = String(random.integer(1_000_000));
  const fractionLength = decimals === 0 ? 0 : random.integer(decimals + 1);

  if (fractionLength === 0) return whole;

  let fraction = '';
  for (let index = 0; index < fractionLength; index += 1) {
    fraction += String(random.integer(10));
  }

  return `${whole}.${fraction}`;
}
