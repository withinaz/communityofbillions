# Conformance test vectors

Machine-readable vectors for testing an implementation of COB/1 and its extensions against the
specification rather than against the reference implementation.

This directory holds slices of issue [#5](https://github.com/withinaz/communityofbillions/issues/5).
It now covers `cob.a2a` and the COB/1 amount and receipt-matching rules; the COB/1 envelope, identity
and canonicalisation categories are still open.

## Files

| Path | Covers | Status |
| --- | --- | --- |
| `a2a/v1.json` | `spec/COB-A2A.md` §3–§7: declaration, message preconditions, activation and echo | partial, see below |
| `cob1/v1.json` | `spec/COB-1.md` §8.1 and §8.4: amounts and receipt matching | partial, see below |

## Format `cob-conformance-vectors/1`

A file is one JSON object:

```json
{
  "format": "cob-conformance-vectors/1",
  "specification": "spec/COB-A2A.md",
  "extension": "https://github.com/withinaz/communityofbillions/a2a/cob/v1",
  "provenance": "why these vectors can be trusted to describe the rules",
  "vectors": [
    {
      "name": "stable, unique, lower-kebab-case",
      "rule": "§6.2",
      "operation": "is-active",
      "input": { "header": null, "options": { "declared": true } },
      "expected": { "outcome": "decided", "active": false }
    }
  ]
}
```

- `name` identifies the vector in a test report and **MUST** be unique within the file.
- `rule` cites the section of `specification` the vector checks.
- `operation` selects what to run. The operations below name behaviour, not a function of any one
  language.
- `input` and `expected` are operation-specific.

### Operations

| Operation | Input | Accepted / decided result |
| --- | --- | --- |
| `validate-declaration` | `{ extension }` — an Agent Card `AgentExtension` | `{"outcome":"accepted","agent":"cob:agent:…"}` |
| `parse-extensions` | `{ header }` — an `A2A-Extensions` value | `{"outcome":"parsed","names":[…]}` |
| `with-activation` | `{ header }` | `{"outcome":"header","names":[…]}` |
| `is-active` | `{ header, options }` | `{"outcome":"decided","active":true|false}` |
| `assert-echo` | `{ header }` | `{"outcome":"accepted"}` |
| `read-envelope` | `{ message, options }` | not yet exercised, see scope |
| `validate-amount` | `{ amount, decimals }` | `{"outcome":"accepted"}` or a refusal |
| `compare-amounts` | `{ left, right, decimals }` | `{"outcome":"decided","equal":true|false}` |
| `match-receipt` | `{ request, receipt }` | `{"outcome":"settled"}`, or `{"outcome":"mismatched","problem":"CODE"}` |

`names` is an **unordered** set with multiplicity. An implementation may format the header with any
spacing or order; the vector checks *which* extension names it carries and whether one is repeated,
not the exact string. In `with-activation`, the result MUST contain every name the input carried and
MUST contain the `cob.a2a` URI exactly once.

A refusal is written as:

```json
{ "outcome": "refused", "reason": "required" }
```

`reason` is a stable label for the rule that refused, not a required error message. Implementations
should map their own diagnostics to these labels:

| Reason | What was refused |
| --- | --- |
| `extension-not-object` | the declaration is not a JSON object |
| `required` | `required` is present and not `false` |
| `uri` | `uri` is absent or is not this extension's URI |
| `params` | `params` is not an object |
| `agent` | `params.agent`, or the reader's own agent id, is not a well-formed COB agent id |
| `header-not-string` | a header argument is neither absent nor a string |
| `options-not-object` | the options argument is not an object |
| `extension-uri-missing` | the message does not list the extension URI in `extensions` |
| `metadata-not-object` | the message's `metadata` is not an object |
| `envelope-not-object` | `metadata["cob.envelope"]` is not an object |
| `not-echoed` | the response does not name the extension URI |
| `format` | an amount is not a decimal string matching §8.1 |
| `precision` | an amount has more fractional digits than the asset supports |

For `match-receipt`, `problem` is one of the failure codes in COB/1 §8.4 (`INVOICE_MISMATCH`,
`CHAIN_MISMATCH`, `ASSET_MISMATCH`, `AMOUNT_MISMATCH`, `PAYEE_MISMATCH`, `TXHASH_INVALID`), not an
error message. Each vector has exactly one failure, so the suite does not turn §8.4's **SHOULD**
report every failure into a conformance requirement.

## Provenance

Each file records the specification its vectors were written from: `a2a/v1.json` from
`spec/COB-A2A.md`, `cob1/v1.json` from `spec/COB-1.md` §8. They were not exported from
`packages/core`, and a vector that merely recorded what the implementation happens to do would not be
accepted. The Node runners in `packages/core/test/` demonstrate that the reference implementation
passes them; that is a check on the implementation, not the source of the vectors.

## Scope

### `a2a/v1.json`

Covered:

- §4: `required` absent or `false`, the exact URI, `params.agent`, unknown `params` keys.
- §5: the message-level precondition that `extensions` names the URI and `cob.envelope` is an object.
- §6.1: the comma-separated request header, preserving other extensions, no duplicate URI.
- §6.2: activation requires both the server's declaration and the request header.
- §6.4: the response echo.
- §7: the unsigned `cob.payment.status` annotation is not an envelope.

Not covered yet, and deliberately so:

- **Accepted `read-envelope` and signature verification.** A vector that a receiver accepts needs a
  signed envelope. Writing one now would pin one signer's bytes before the COB/1 envelope vectors
  exist; the signature rule belongs to those vectors, not to the A2A file.
- **`attachCobEnvelope`.** It is the producer-side counterpart of §5 and has no rule of its own; it is
  tested in `packages/core/test/a2a.test.js` instead.
- **Activation outside an HTTP request.** §10.2 is an open question, not a rule.
- **The payment substate's allowed values and non-contradiction rule** (§7), beyond the single
  "annotation is not an envelope" vector.

### `cob1/v1.json`

Covered:

- §8.1: accepted decimal forms, the format refusals (number, exponent, sign, leading dot or zero,
  whitespace, empty, null), the precision refusal, and equality by base-unit value.
- §8.4: one accepted match and one vector for each of the six failure codes. Underpayment and
  overpayment are separate vectors because §8.4 treats an overpayment as a mismatch rather than a
  success.

Not covered yet, and deliberately so:

- **The envelope, identity and canonicalisation categories.** They are the rest of issue #5. The
  canonicalisation refusals in §3 include values JSON cannot express (`undefined`, `NaN`, `bigint`,
  cycles), so that file needs a documented value encoding rather than plain JSON.
- **Signature verification and expiry.** These need a signed envelope; see the A2A note above.
- **`AMOUNT_MISSING` and `AMOUNT_UNCOMPARABLE`.** The reference implementation reports them, but §8.4
  does not name a failure code for an absent or incomparable amount, so they are not conformance
  claims yet.
- **Reporting every failing check at once.** §8.4 says **SHOULD**, and each vector has one failure.

## Running the reference runners

```bash
node --test packages/core/test/a2a-vectors.test.js
node --test packages/core/test/cob1-vectors.test.js
```

Each runner fails on an unknown operation, an unknown reason label, a duplicate name, or a vector that
does not match the format. Adding a vector does not require touching the runner unless it introduces a
new operation.
