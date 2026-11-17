/**
 * A bounded, memory-only replay cache for COB/1 envelopes.
 *
 * `spec/COB-1.md` §7 requires a receiver to treat `(from, nonce)` as the replay key, to
 * retain a pair at least until the envelope expires, and to bound the state. Those three
 * requirements pull against one another: a bound means some pair must eventually be
 * discarded, and discarding a pair before its window closes reopens the replay it was
 * meant to stop. This cache resolves that by never discarding silently.
 *
 * Two decisions are deliberate:
 *
 * 1. **Record only after verification.** The caller adds a pair after the signature
 *    verifies. Recording an unverified pair would let an attacker fill the cache with
 *    envelopes they cannot sign.
 * 2. **Report premature eviction.** When the entry bound forces a pair out before its
 *    window closes, `onUnsafeEviction` fires and {@link ReplayCache#unsafeEvictions}
 *    increments. A silent drop would turn a bounded cache into an unbounded lie.
 *
 * This cache is process-local. It does not survive a restart, and it does not persist to
 * disk; the specification says a receiver that loses its state cannot claim replay
 * protection for envelopes accepted before the loss.
 */

import { ValidationError } from './errors.js';

/** Default extra retention beyond the envelope's own expiry. Five minutes, as §7 suggests. */
export const DEFAULT_REPLAY_TTL_MS = 300_000;

/** Default maximum number of retained pairs. */
export const DEFAULT_REPLAY_MAX_ENTRIES = 10_000;

/**
 * @typedef {{
 *   key: string,
 *   from: string,
 *   nonce: string,
 *   deadline: number,
 * }} ReplayEntry
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 * @throws {ValidationError}
 */
function assertKeyPart(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${label} must be a non-empty string`, { [label]: value });
  }
  // The pair is stored under one string key. A NUL in either half would make two distinct
  // pairs collide, which is the one thing a replay key must never do.
  if (value.includes('\u0000')) {
    throw new ValidationError(`${label} must not contain a NUL character`, { [label]: value });
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {number} epoch milliseconds
 * @throws {ValidationError}
 */
function toEpochMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isNaN(ms)) return ms;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new ValidationError(
    'expiresAt must be a valid Date or a finite epoch-millisecond number',
    { expiresAt: String(value) },
  );
}

/**
 * @param {ReplayEntry[]} heap
 * @param {ReplayEntry} item
 */
function pushHeap(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].deadline <= item.deadline) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = item;
}

/**
 * @param {ReplayEntry[]} heap
 * @returns {ReplayEntry | undefined}
 */
function popHeap(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length === 0) return top;

  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right].deadline < heap[left].deadline
      ? right
      : left;
    if (heap[child].deadline >= last.deadline) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return top;
}

/**
 * A bounded cache keyed by `(from, nonce)`.
 *
 * ```js
 * const cache = new ReplayCache();
 * verifyEnvelope(envelope);                 // first: never cache an unverified pair
 * if (cache.observe(envelope.from, envelope.nonce, new Date(envelope.expires)) === 'replay') {
 *   throw new Error('replayed envelope');
 * }
 * ```
 */
export class ReplayCache {
  /** @type {number} */
  #ttlMs;

  /** @type {number} */
  #maxEntries;

  /** @type {() => number} */
  #now;

  /** @type {((eviction: { from: string, nonce: string, deadline: number }) => void) | undefined} */
  #onUnsafeEviction;

  /** @type {Map<string, ReplayEntry>} */
  #entries = new Map();

  /**
   * A min-heap of entries ordered by deadline, plus lazy invalidation: an item is live
   * only while the map holds the same object. This keeps eviction O(log n) instead of
   * scanning every entry under load.
   *
   * @type {ReplayEntry[]}
   */
  #heap = [];

  /** @type {number} */
  #unsafeEvictions = 0;

  /**
   * @param {{
   *   ttlMs?: number,
   *   maxEntries?: number,
   *   now?: () => number,
   *   onUnsafeEviction?: (eviction: { from: string, nonce: string, deadline: number }) => void,
   * }} [options]
   * @throws {ValidationError}
   */
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new ValidationError('ReplayCache options must be an object');
    }

    const {
      ttlMs = DEFAULT_REPLAY_TTL_MS,
      maxEntries = DEFAULT_REPLAY_MAX_ENTRIES,
      now = () => Date.now(),
      onUnsafeEviction = undefined,
    } = /** @type {{
      ttlMs?: unknown,
      maxEntries?: unknown,
      now?: unknown,
      onUnsafeEviction?: unknown,
    }} */ (options);

    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new ValidationError('ttlMs must be a finite non-negative number', { ttlMs });
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new ValidationError('maxEntries must be a positive integer', { maxEntries });
    }
    if (typeof now !== 'function') {
      throw new ValidationError('now must be a function returning epoch milliseconds');
    }
    if (onUnsafeEviction !== undefined && typeof onUnsafeEviction !== 'function') {
      throw new ValidationError('onUnsafeEviction must be a function');
    }

    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = /** @type {() => number} */ (now);
    this.#onUnsafeEviction = /** @type {((eviction: { from: string, nonce: string, deadline: number }) => void) | undefined} */ (
      onUnsafeEviction
    );
  }

  /** @returns {number} pairs currently retained */
  get size() {
    return this.#entries.size;
  }

  /** @returns {number} premature evictions reported since construction */
  get unsafeEvictions() {
    return this.#unsafeEvictions;
  }

  /**
   * Record one observation of `(from, nonce)` and say whether it is new.
   *
   * Call this only after the envelope's signature has verified. The pair is retained until
   * `max(expiresAt, now + ttlMs)`, so a replay remains refused even if the envelope's own
   * expiry has passed in the caller's clock.
   *
   * @param {string} from the envelope's `from`
   * @param {string} nonce the envelope's `nonce`
   * @param {Date | number} expiresAt the envelope's expiry, as a Date or epoch milliseconds
   * @returns {'fresh' | 'replay'}
   * @throws {ValidationError}
   */
  observe(from, nonce, expiresAt) {
    assertKeyPart(from, 'from');
    assertKeyPart(nonce, 'nonce');

    const nowMs = this.#now();
    if (!Number.isFinite(nowMs)) {
      throw new ValidationError('now() must return a finite epoch-millisecond number', {
        now: nowMs,
      });
    }

    const deadline = Math.max(toEpochMs(expiresAt), nowMs + this.#ttlMs);
    const key = `${from}\u0000${nonce}`;

    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      if (existing.deadline > nowMs) return 'replay';
      // The retention window is over. The pair is no longer protected, so this
      // observation starts a new window rather than reporting a stale replay.
      this.#entries.delete(key);
    }

    this.#purgeExpired(nowMs);

    while (this.#entries.size >= this.#maxEntries) {
      const victim = this.#popLive();
      if (victim === undefined) break;
      this.#entries.delete(victim.key);

      if (victim.deadline > nowMs) {
        this.#unsafeEvictions += 1;
        if (this.#onUnsafeEviction !== undefined) {
          this.#onUnsafeEviction({
            from: victim.from,
            nonce: victim.nonce,
            deadline: victim.deadline,
          });
        }
      }
    }

    const entry = { key, from, nonce, deadline };
    this.#entries.set(key, entry);
    pushHeap(this.#heap, entry);
    return 'fresh';
  }

  /**
   * Remove every entry whose deadline has passed. Because the heap is ordered by
   * deadline, everything removable is at the top; no full scan is needed.
   *
   * @param {number} nowMs
   */
  #purgeExpired(nowMs) {
    while (this.#heap.length > 0) {
      const top = this.#heap[0];
      if (top.deadline > nowMs) break;
      popHeap(this.#heap);
      if (this.#entries.get(top.key) === top) this.#entries.delete(top.key);
    }
  }

  /**
   * Pop the live entry with the earliest deadline. Stale heap items — entries already
   * removed for another reason — are discarded on the way.
   *
   * @returns {ReplayEntry | undefined}
   */
  #popLive() {
    while (this.#heap.length > 0) {
      const candidate = popHeap(this.#heap);
      if (candidate === undefined) break;
      if (this.#entries.get(candidate.key) === candidate) return candidate;
    }
    return undefined;
  }
}
