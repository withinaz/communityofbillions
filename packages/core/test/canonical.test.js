import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canonicalBytes, canonicalize } from '../src/canonical.js';
import { CanonicalizationError } from '../src/errors.js';

describe('canonicalize', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    assert.equal(canonicalize({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}');
  });

  it('produces the same bytes regardless of insertion order', () => {
    const one = { z: 1, a: { y: 2, b: 3 }, m: [1, 2] };
    const other = { m: [1, 2], a: { b: 3, y: 2 }, z: 1 };
    assert.equal(canonicalize(one), canonicalize(other));
  });

  it('keeps array order', () => {
    assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  });

  it('does not reorder array elements even when they are objects', () => {
    assert.equal(canonicalize([{ b: 1, a: 2 }, { b: 3 }]), '[{"a":2,"b":1},{"b":3}]');
  });

  it('emits no insignificant whitespace', () => {
    assert.equal(canonicalize({ a: { b: [1, 2] } }), '{"a":{"b":[1,2]}}');
  });

  it('handles the JSON scalars', () => {
    assert.equal(canonicalize(null), 'null');
    assert.equal(canonicalize(true), 'true');
    assert.equal(canonicalize(false), 'false');
    assert.equal(canonicalize(0), '0');
    assert.equal(canonicalize(42), '42');
    assert.equal(canonicalize('hi'), '"hi"');
  });

  it('normalises negative zero so the sign cannot leak into signed bytes', () => {
    assert.equal(canonicalize(-0), '0');
    assert.equal(canonicalize({ a: -0 }), '{"a":0}');
  });

  it('escapes strings the way JSON does', () => {
    assert.equal(canonicalize('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
  });

  it('keeps non-ASCII characters as-is rather than escaping them', () => {
    // U+00E9 and U+1F600 must survive a UTF-8 round trip unchanged.
    assert.equal(canonicalize('café 😀'), '"café 😀"');
    assert.equal(canonicalBytes('café').toString('utf8'), '"café"');
  });

  it('renders undefined array holes as null, matching JSON.stringify', () => {
    // eslint-disable-next-line no-sparse-arrays
    assert.equal(canonicalize([1, , 3]), '[1,null,3]');
  });

  it('rejects undefined members instead of dropping them', () => {
    // Dropping `b` would make {a:1,b:undefined} and {a:1} share one byte stream.
    assert.throws(() => canonicalize({ a: 1, b: undefined }), CanonicalizationError);
  });

  it('rejects NaN and Infinity', () => {
    assert.throws(() => canonicalize(Number.NaN), CanonicalizationError);
    assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), CanonicalizationError);
    assert.throws(() => canonicalize({ a: Number.NEGATIVE_INFINITY }), CanonicalizationError);
  });

  it('rejects bigint and points the caller at decimal strings', () => {
    assert.throws(
      () => canonicalize({ amount: 10n }),
      (error) => error instanceof CanonicalizationError && /decimal string/.test(error.message),
    );
  });

  it('rejects functions and symbols', () => {
    assert.throws(() => canonicalize({ f: () => {} }), CanonicalizationError);
    assert.throws(() => canonicalize({ s: Symbol('x') }), CanonicalizationError);
  });

  it('detects cycles rather than blowing the stack', () => {
    /** @type {any} */
    const node = { name: 'a' };
    node.self = node;
    assert.throws(
      () => canonicalize(node),
      (error) => error instanceof CanonicalizationError && /circular/.test(error.message),
    );
  });

  it('allows the same object to appear twice when it is not an ancestor', () => {
    const shared = { x: 1 };
    assert.equal(canonicalize({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
  });
});

describe('canonicalize — the RFC 8785 points A2A §8.4.1 depends on', () => {
  // A2A requires an Agent Card to be canonicalised with RFC 8785 before signing. Its own
  // summary of the RFC omits the three rules implementations actually diverge on, so these
  // tests pin the rules rather than the summary. The comparison is written up in
  // docs/a2a.md §5 and is the increment for issue #22.

  it('orders keys by UTF-16 code unit, not by Unicode code point', () => {
    // U+10000 is the surrogate pair D800 DC00, so its first code unit sorts before
    // U+E000. A code-point sort — Python's `sort_keys`, Go's `sort.Strings` — reverses
    // that, and RFC 8785 §3.2.3 requires the code-unit order this asserts.
    assert.equal(canonicalize({ '\uE000': 2, '\u{10000}': 1 }), '{"\u{10000}":1,"\uE000":2}');
  });

  it('serialises numbers the ECMAScript way, not by shortest exponent', () => {
    // RFC 8785 §3.2.2.3 delegates to ECMAScript `Number::toString`. Python's `json.dumps`
    // emits `1e-06` for the first of these, which is a different byte stream.
    assert.equal(canonicalize(0.000001), '0.000001');
    assert.equal(canonicalize(1e21), '1e+21');
  });

  it('reproduces the worked example printed in A2A specification §8.4.1', () => {
    // The object the section says is left after its field-presence rules, and the
    // canonical string it prints for that object. Both copied from the specification
    // (`a2aproject/A2A` main, `docs/specification.md`, released version v1.0.0, read
    // 2026-10-13). If this ever fails, one of the two implementations moved.
    const card = {
      name: 'Example Agent',
      description: 'An example agent that echoes messages.',
      supportedInterfaces: [
        { url: 'https://example.com/a2a/v1', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [{ id: 'echo', name: 'Echo', description: 'Echoes the input.', tags: ['echo'] }],
    };

    const expected =
      '{"capabilities":{"pushNotifications":false,"streaming":false},' +
      '"defaultInputModes":["text/plain"],"defaultOutputModes":["text/plain"],' +
      '"description":"An example agent that echoes messages.","name":"Example Agent",' +
      '"skills":[{"description":"Echoes the input.","id":"echo","name":"Echo","tags":["echo"]}],' +
      '"supportedInterfaces":[{"protocolBinding":"JSONRPC","protocolVersion":"1.0",' +
      '"url":"https://example.com/a2a/v1"}],"version":"1.0.0"}';

    assert.equal(canonicalize(card), expected);
  });
});
