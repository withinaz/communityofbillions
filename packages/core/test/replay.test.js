import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AgentIdentity,
  DEFAULT_REPLAY_MAX_ENTRIES,
  DEFAULT_REPLAY_TTL_MS,
  ReplayCache,
  ValidationError,
  createEnvelope,
  verifyEnvelope,
} from '../src/index.js';

/**
 * A deterministic clock, because "wait five minutes" is not a test.
 */
function controllableClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    set(next) {
      current = next;
    },
  };
}

/**
 * @param {ReturnType<typeof controllableClock>} clock
 * @param {Record<string, unknown>} [options]
 */
function newCache(clock, options = {}) {
  return new ReplayCache({ now: clock.now, ...options });
}

describe('ReplayCache defaults', () => {
  it('retains for five minutes and bounds itself at ten thousand pairs', () => {
    assert.equal(DEFAULT_REPLAY_TTL_MS, 300_000);
    assert.equal(DEFAULT_REPLAY_MAX_ENTRIES, 10_000);
  });
});

describe('ReplayCache.observe', () => {
  it('returns fresh the first time and replay while the pair is retained', () => {
    const clock = controllableClock();
    const cache = newCache(clock);

    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'fresh');
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'replay');
    assert.equal(cache.size, 1);
  });

  it('keys the pair on both from and nonce', () => {
    const clock = controllableClock();
    const cache = newCache(clock);

    assert.equal(cache.observe('cob:agent:a', 'shared-nonce', 1_000), 'fresh');
    assert.equal(cache.observe('cob:agent:b', 'shared-nonce', 1_000), 'fresh');
    assert.equal(cache.observe('cob:agent:a', 'another-nonce', 1_000), 'fresh');
    assert.equal(cache.size, 3);
  });

  it('retains a pair until the envelope expires, even with no extra TTL', () => {
    const clock = controllableClock();
    const cache = newCache(clock, { ttlMs: 0 });

    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 10_000), 'fresh');

    clock.set(9_999);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 10_000), 'replay');

    clock.set(10_000);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 10_000), 'fresh');
  });

  it('retains a pair for the TTL after a short-lived envelope expires', () => {
    const clock = controllableClock();
    const cache = newCache(clock, { ttlMs: 5_000 });

    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'fresh');

    clock.set(4_999);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'replay');

    clock.set(5_000);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'fresh');
  });

  it('does not extend retention when a replay is observed', () => {
    const clock = controllableClock();
    const cache = newCache(clock, { ttlMs: 10_000 });

    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'fresh');
    clock.set(9_000);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'replay');

    // A replay must not buy the pair another ten seconds. Without this, an attacker
    // could keep a captured envelope protected for as long as they kept resending it.
    clock.set(10_000);
    assert.equal(cache.observe('cob:agent:a', 'nonce-1', 1_000), 'fresh');
  });

  it('accepts a Date and epoch milliseconds for the expiry', () => {
    const clock = controllableClock();
    const cache = newCache(clock, { ttlMs: 0 });

    assert.equal(cache.observe('cob:agent:a', 'date-nonce', new Date(1_000)), 'fresh');
    assert.equal(cache.observe('cob:agent:a', 'date-nonce', 1_000), 'replay');
  });

  it('refuses malformed keys instead of letting two pairs collide', () => {
    const clock = controllableClock();
    const cache = newCache(clock);

    assert.throws(() => cache.observe('', 'nonce', 1_000), ValidationError);
    assert.throws(() => cache.observe('cob:agent:a', '', 1_000), ValidationError);
    assert.throws(() => cache.observe(/** @type {any} */ (1), 'nonce', 1_000), ValidationError);
    assert.throws(() => cache.observe('cob:agent:a', 'nonce', /** @type {any} */ (null)), ValidationError);
    assert.throws(() => cache.observe('cob:agent:a', 'nonce', Number.NaN), ValidationError);
    assert.throws(() => cache.observe('cob:agent:a', 'nonce', /** @type {any} */ ('tomorrow')), ValidationError);
    assert.throws(() => cache.observe('cob:agent\u0000x', 'nonce', 1_000), ValidationError);
    assert.throws(() => cache.observe('cob:agent:a', 'nonce\u0000x', 1_000), ValidationError);
  });

  it('refuses a clock that is not a finite epoch-millisecond value', () => {
    const cache = new ReplayCache({ now: () => Number.NaN });

    assert.throws(() => cache.observe('cob:agent:a', 'nonce', 1_000), ValidationError);
  });
});

describe('ReplayCache bounds and premature eviction', () => {
  it('evicts the least-recently-expiring pair first and reports it', () => {
    const clock = controllableClock();
    /** @type {Array<{ from: string, nonce: string, deadline: number }>} */
    const evictions = [];
    const cache = newCache(clock, {
      ttlMs: 0,
      maxEntries: 2,
      onUnsafeEviction: (eviction) => evictions.push(eviction),
    });

    assert.equal(cache.observe('cob:agent:a', 'a', 1_000), 'fresh');
    assert.equal(cache.observe('cob:agent:b', 'b', 2_000), 'fresh');
    assert.equal(cache.observe('cob:agent:c', 'c', 3_000), 'fresh');

    assert.deepEqual(evictions, [{ from: 'cob:agent:a', nonce: 'a', deadline: 1_000 }]);
    assert.equal(cache.unsafeEvictions, 1);
    assert.equal(cache.size, 2);

    // The evicted pair is no longer protected; that is the downgrade the callback names.
    assert.equal(cache.observe('cob:agent:a', 'a', 1_000), 'fresh');
    assert.equal(cache.unsafeEvictions, 2);
    assert.equal(cache.size, 2);
  });

  it('never reports an eviction whose deadline has already passed', () => {
    const clock = controllableClock();
    let reports = 0;
    const cache = newCache(clock, {
      ttlMs: 0,
      maxEntries: 1,
      onUnsafeEviction: () => {
        reports += 1;
      },
    });

    assert.equal(cache.observe('cob:agent:a', 'a', 1_000), 'fresh');

    clock.set(1_001);
    assert.equal(cache.observe('cob:agent:b', 'b', 2_000), 'fresh');

    assert.equal(reports, 0);
    assert.equal(cache.unsafeEvictions, 0);
    assert.equal(cache.size, 1);
  });

  it('stays bounded while a flood of future-dated pairs is observed', () => {
    const clock = controllableClock();
    const cache = newCache(clock, { ttlMs: 0, maxEntries: 3 });

    for (let index = 0; index < 100; index += 1) {
      assert.equal(cache.observe('cob:agent:a', `nonce-${index}`, 1_000 + index), 'fresh');
      assert.ok(cache.size <= 3);
    }

    assert.equal(cache.size, 3);
    assert.equal(cache.unsafeEvictions, 97);
  });
});

describe('ReplayCache constructor', () => {
  it('accepts no options and the documented defaults', () => {
    const cache = new ReplayCache();
    assert.equal(cache.size, 0);
    assert.equal(cache.unsafeEvictions, 0);
  });

  it('refuses options that would make the bound meaningless', () => {
    assert.throws(() => new ReplayCache(/** @type {any} */ (null)), ValidationError);
    assert.throws(() => new ReplayCache({ ttlMs: -1 }), ValidationError);
    assert.throws(() => new ReplayCache({ ttlMs: Number.POSITIVE_INFINITY }), ValidationError);
    assert.throws(() => new ReplayCache({ ttlMs: /** @type {any} */ ('5m') }), ValidationError);
    assert.throws(() => new ReplayCache({ maxEntries: 0 }), ValidationError);
    assert.throws(() => new ReplayCache({ maxEntries: 1.5 }), ValidationError);
    assert.throws(() => new ReplayCache({ maxEntries: Number.POSITIVE_INFINITY }), ValidationError);
    assert.throws(() => new ReplayCache({ now: /** @type {any} */ (1) }), ValidationError);
    assert.throws(() => new ReplayCache({ onUnsafeEviction: /** @type {any} */ (true) }), ValidationError);
  });
});

describe('ReplayCache in the verification path', () => {
  it('refuses a captured, valid envelope on its second arrival', () => {
    const clock = controllableClock(0);
    const cache = newCache(clock);
    const alice = AgentIdentity.generate();
    const bob = AgentIdentity.generate();

    const envelope = createEnvelope({
      identity: alice,
      to: bob.id,
      type: 'cob.message',
      body: { text: 'the same request twice' },
    });

    verifyEnvelope(envelope, { expectTo: bob.id });
    assert.equal(
      cache.observe(/** @type {string} */ (envelope.from), /** @type {string} */ (envelope.nonce), new Date(/** @type {string} */ (envelope.expires))),
      'fresh',
    );
    assert.equal(
      cache.observe(/** @type {string} */ (envelope.from), /** @type {string} */ (envelope.nonce), new Date(/** @type {string} */ (envelope.expires))),
      'replay',
    );
  });
});
