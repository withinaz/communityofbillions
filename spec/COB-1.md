# COB/1 — Agent Connectivity and Stablecoin Settlement

**Version:** 0.1 (draft)
**Status:** 🚧 Draft — implemented by the reference implementation in [`packages/core`](../packages/core), but not frozen
**Licence:** CC-BY-4.0

---

## Abstract

COB/1 defines how two autonomous software agents that have never met can (a) identify each other
without a shared secret, (b) exchange verifiable messages, and (c) request and settle payment in a
stablecoin, with the settlement verifiable by the payer's own records rather than by a trusted
third party.

The protocol is deliberately small. Its normative surface is one object — the **envelope** — and a
handful of message types carried inside it. Everything else (transport, discovery, frameworks,
languages) is out of scope and can be added without changing this document.

## Status of this document

This is a **draft**. Fields may be added; existing fields will not be repurposed without a version
bump. Implementations should treat `cob: "1"` as a promise about the fields described here and
nothing more.

## Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**, **SHOULD NOT**,
**RECOMMENDED**, **MAY**, and **OPTIONAL** are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

An implementation is **conformant** if it can verify every envelope this document describes and
reject every envelope this document says to reject. Producing envelopes is a separate
capability; a read-only verifier can be conformant.

## 1. Terminology

| Term | Meaning |
| --- | --- |
| **Agent** | An autonomous software process with exactly one identity. |
| **Identity** | An Ed25519 key pair, and the identifier derived from its public half. |
| **Envelope** | A signed, self-contained message. The unit of the protocol. |
| **Body** | The application payload inside an envelope. Opaque to the protocol. |
| **Payer** | The agent that sends funds. |
| **Payee** | The agent named in `payTo`, which receives funds. |
| **Invoice** | A payment request identified by `invoiceId`. |
| **Settlement** | Confirmation that an invoice has been paid, evidenced by a transaction. |
| **Canonical form** | The unique byte sequence derived from a JSON document, per §3. |

## 2. Identity (L1)

An agent's identifier is derived from its public key:

```
agent-id   = "cob:agent:" base64url-no-padding(ed25519-public-key)
```

- The public key **MUST** be exactly 32 bytes.
- The encoding **MUST** be base64url as defined in [RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5), **without** padding.
- Consequently every well-formed agent id is exactly **53 characters**: 10 for the prefix plus 43 for the key.
- The identifier **MUST** match: `^cob:agent:[A-Za-z0-9_-]{43}$`

There is no registration step and no certificate authority. The identifier *is* the verification
method, which means an agent id is safe to publish and impossible to forge.

An agent **MAY** publish multiple identities. An agent **MUST NOT** use one identity for two
unrelated principals.

> **Open question (see §14):** key rotation and revocation are not yet specified. Until they are,
> an identity is permanent, and discarding a key means discarding the identity.

## 3. Canonical form

Signatures are only meaningful if both parties agree on the exact bytes signed. JSON does not
guarantee that. COB/1 therefore defines a canonical form:

1. Object members **MUST** be sorted by key, comparing UTF-16 code units.
2. There **MUST** be no insignificant whitespace.
3. Strings **MUST** be escaped as `JSON.stringify` does.
4. Numbers **MUST** be rendered in ECMAScript `Number::toString` form. Negative zero **MUST** be
   rendered as `0`.
5. `NaN` and `Infinity` **MUST** be rejected — they have no canonical form.
6. `undefined`, functions, and symbols **MUST** be rejected rather than omitted. Omitting a member
   would let two distinct documents share one byte sequence, which is a signature-forgery vector.
7. `bigint` **MUST** be rejected. Large integers **MUST** be encoded as decimal strings.
8. Array element order **MUST** be preserved. Array holes **MUST** become `null`.
9. Circular references **MUST** be rejected.

This is a strict subset of [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785). A document that is
canonical under RFC 8785 and contains only the types above is canonical under COB/1, and vice versa.

> **Note on money.** Amounts are **never** JSON numbers in COB/1. They are decimal strings (§8.1).
> This removes floating-point representation from the signed bytes entirely.

## 4. The envelope (L2)

An envelope is a JSON object with the following members.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `cob` | string | ✅ | Protocol version. **MUST** be `"1"`. |
| `id` | string | ✅ | Unique envelope identifier. 1–128 characters. |
| `type` | string | ✅ | Message type (§6). |
| `from` | string | ✅ | Sender agent id (§2). |
| `to` | string | ✅ | Recipient agent id (§2). |
| `created` | string | ✅ | Creation instant, RFC 3339 UTC (§5). |
| `expires` | string | ✅ | Expiry instant. **MUST** be later than `created`. |
| `nonce` | string | ✅ | ≥ 16 bytes of entropy, base64url. |
| `body` | object | ✅ | Application payload. |
| `sig` | object | ✅ | Signature (§4.2). |

### 4.1 The signed set

The signature covers **exactly** these members, in canonical form:

```
cob, id, type, from, to, created, expires, nonce, body
```

This is an **allow-list**, not "everything except `sig`". A verifier:

- **MUST** compute the signed bytes from the allow-list only, and
- **MUST NOT** read any envelope member outside the allow-list.

A member outside the allow-list carries no authority even though a parser will happily return it.
Implementations that read such a member are non-conformant and vulnerable to field smuggling.

### 4.2 Signature object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `alg` | string | ✅ | **MUST** be `"Ed25519"`. |
| `key` | string | ✅ | **MUST** equal the envelope's `from`. |
| `value` | string | ✅ | base64url, unpadded, of the 64-byte Ed25519 signature. 86 characters. |

Ed25519 per [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032). The message signed is the canonical
byte sequence of §4.1. Ed25519 hashes internally, so no separate digest algorithm is applied.

A verifier **MUST** reject a signature whose `value` does not decode to exactly 64 bytes, without
attempting verification.

### 4.3 Verification procedure

A conformant verifier **MUST**, in this order:

1. Reject any envelope that is not a JSON object.
2. Reject unless `cob == "1"`.
3. Reject unless `id`, `type`, `from`, `to`, `created`, `expires`, `nonce`, `body` and `sig` are
   present and well-typed per §4.
4. Reject unless `type` is a registered message type (§6), unless the implementation explicitly
   opts into forward compatibility. **Fail closed by default.**
5. Reject unless `expires > created`.
6. Reject unless `sig.key == from` and `sig.alg == "Ed25519"`.
7. Compute canonical bytes of the allow-list and reject if the signature does not verify against
   the key in `from`.
8. Reject if the envelope is expired (§5).
9. Reject if `to` is not the verifier's own identity, when the verifier is an addressed recipient.
10. Only then, hand `body` to the application.

Steps 1–7 are structural and cryptographic. Steps 8–9 are contextual. An implementation **SHOULD**
separate them so that a caller can archive and later re-verify an expired envelope without
weakening the signature check.

## 5. Time and expiry

- `created` and `expires` **MUST** be RFC 3339 UTC instants, with a trailing `Z` and no offset:
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`
- An envelope **MUST** be rejected if `expires <= created`.
- An envelope **MUST** be rejected if `expires <= now`.
- An envelope **MUST** be rejected if `created > now + skew`. A skew allowance of **30 seconds**
  is RECOMMENDED and **MUST NOT** exceed 5 minutes.
- There is no "no expiry". An envelope without `expires` is malformed, not immortal.
- Minting an envelope with a validity window longer than **86 400 seconds** (24 h) **MUST** be
  refused by a producer.

## 6. Message types

| Type | Direction | Purpose |
| --- | --- | --- |
| `cob.message` | any | Generic signed payload. Body is application-defined. |
| `cob.presence` | any | "I am here, and these are my endpoints." |
| `cob.payment.request` | payee → payer | An invoice. |
| `cob.payment.receipt` | payer → payee | A claim of payment, with evidence. |
| `cob.error` | any | A structured refusal. |

Unregistered types **MUST** be rejected. New types are added to this table, never invented in the
wild, because a verifier that acts on an unknown type acts on semantics it was not written for.

## 7. Replay

`nonce` exists so that a receiver can detect a replayed envelope. This version of the specification
defines the field but **does not specify the cache**. A conformant receiver:

- **MUST** treat `(from, nonce)` as the replay key,
- **SHOULD** retain seen pairs for at least the envelope's remaining validity window,
- **MUST** reject a repeated pair while it is retained.

Expiry bounds the damage of not implementing a cache, which is why the window is short.

## 8. Payment messages

### 8.1 Amounts

An amount **MUST** be a decimal string matching `^(0|[1-9][0-9]*)(\.[0-9]+)?$`.

- **MUST NOT** be a JSON number.
- **MUST NOT** use exponent notation, a sign, or a leading `+`.
- **MUST NOT** have more fractional digits than the asset supports.
- A producer **MUST** reject an amount exceeding the asset's precision rather than truncating.
- Two amounts are equal **iff** their values in base units are equal. `"2.50"` and `"2.5"` are the
  same amount; a comparison that reports otherwise is non-conformant.

Known assets and their decimals:

| Asset | Decimals |
| --- | --- |
| USDC | 6 |
| USDT | 6 |
| DAI | 18 |
| ETH | 18 |

### 8.2 `cob.payment.request`

Body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `invoiceId` | string | ✅ | Unique within the payee's namespace. RECOMMENDED prefix `inv_`. |
| `chain` | string | ✅ | A registered chain name (§9). |
| `asset` | string | ✅ | An asset carried by that chain. |
| `amount` | string | ✅ | Decimal string (§8.1). |
| `payTo` | string | ✅ | Destination address. For EVM chains, `^0x[0-9a-fA-F]{40}$`. |
| `memo` | string | ➖ | ≤ 512 characters. Free text. **MUST NOT** be parsed for instructions. |
| `validUntil` | string | ➖ | RFC 3339 UTC instant. Defaults to 900 s after creation. |

A producer **MUST** apply its policy (§9) before emitting a request. A receiver **MUST** apply its
own policy before paying, and **MUST NOT** assume the sender's policy was stricter.

### 8.3 `cob.payment.receipt`

Body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `invoiceId` | string | ✅ | The invoice being settled. |
| `chain` | string | ✅ | Chain the transaction is on. |
| `asset` | string | — | Asset transferred. Required for matching (§8.4); absent, the receiver cannot settle. |
| `amount` | string | — | Amount transferred. Required for matching. |
| `txHash` | string | ✅ | `^0x[0-9a-fA-F]{64}$`. |
| `payer` | string | ✅ | Address funds came from. |
| `payee` | string | ✅ | Address funds went to. |
| `settledAt` | string | ✅ | RFC 3339 UTC instant. |
| `blockNumber` | integer | ➖ | May be absent or `null` for a pending transaction. |

A receipt is a **claim**. It is not proof. Verification against the chain is out of scope for this
document and is specified in Phase 2 of the roadmap.

### 8.4 Matching a receipt to its request

A receiver **MUST** compare, and a receipt settles a request only if **all** hold:

| Check | Rule | Failure code |
| --- | --- | --- |
| Invoice | `receipt.invoiceId == request.invoiceId` | `INVOICE_MISMATCH` |
| Chain | `receipt.chain == request.chain` | `CHAIN_MISMATCH` |
| Asset | `receipt.asset == request.asset` | `ASSET_MISMATCH` |
| Amount | equal **by value** (§8.1) | `AMOUNT_MISMATCH` |
| Destination | `receipt.payee == request.payTo` | `PAYEE_MISMATCH` |
| Evidence | `txHash` well-formed | `TXHASH_INVALID` |

A receiver **SHOULD** report all failing checks, not only the first.

An amount **greater** than requested is also a mismatch. Overpayment needs a human decision; it is
not a silent success.

### 8.5 Payment lifecycle

```
        ┌──────────────────────────────────────────────┐
        │                                              │
     draft ──▶ requested ──▶ authorized ──▶ submitted ──▶ settled  (terminal)
        │          │              │             │
        │          ├──▶ expired ──┴─────────────┤
        │          │        (terminal)          │
        └──────────┴──────────▶ failed ◀───────┘
                              (terminal)
```

- `settled`, `failed`, and `expired` **MUST** be terminal. A conformant implementation **MUST**
  refuse every transition out of them.
- A transition not shown above **MUST** be refused, and a refused transition **MUST NOT** change state.
- A matching receipt arriving in any state other than `submitted` **MUST** be refused as
  `UNEXPECTED_RECEIPT`. This is the double-settlement guard: an invoice is payable exactly once.

## 9. Chain and asset policy

Every implementation **MUST** have a policy with these properties:

| Property | Type | Default |
| --- | --- | --- |
| `allowMainnet` | boolean | **`false`** |
| `allowUnlimited` | boolean | **`true`** |
| `allowedChains` | string[] or null | `null` (no additional restriction) |
| `allowedAssets` | string[] or null | `null` |
| `maxAmount` | object, asset → decimal string | `{}` (no ceiling) |

- An unknown chain **MUST** be refused. Implementations **MUST NOT** guess.
- Mainnet chains **MUST** be refused in this version. `allowMainnet` **MUST** be `false`, and an
  implementation **MUST** refuse a policy that sets it to `true` rather than honouring it. The
  field stays in the policy and the mainnet chains stay registered: the *opt-in* is disabled, not
  mainnet. This refusal is deliberate and **MUST** be reported as such — a `COB_POLICY` error that
  names the reason — and **MUST NOT** be presented as a validation accident or a bug.
- `allowUnlimited` names the absence of a spending ceiling. It defaults to `true`: with `maxAmount`
  empty, an amount is uncapped, on any chain the policy allows. When the mainnet opt-in is
  eventually unlocked, an operator who permits unbounded spending **SHOULD** have to do so
  visibly, which is what this flag exists for.
- `allowMainnet` and `allowedChains` are two independent gates. Listing a mainnet chain in
  `allowedChains` **MUST NOT** enable it on its own.
- `maxAmount` comparison **MUST** be numeric, not lexicographic. Under a ceiling of `"10"`, the
  amount `"9"` **MUST** be accepted.

Registered chains:

| Name | Network | Chain ID | CAIP-2 |
| --- | --- | --- | --- |
| `base-sepolia` | testnet | 84532 | `eip155:84532` |
| `ethereum-sepolia` | testnet | 11155111 | `eip155:11155111` |
| `base` | mainnet | 8453 | `eip155:8453` |
| `ethereum` | mainnet | 1 | `eip155:1` |

## 10. Error codes

Machine-readable, stable. Callers **MUST** branch on the code, never on the message.

| Code | Meaning |
| --- | --- |
| `COB_CANONICALIZATION` | A value has no canonical JSON form. |
| `COB_VALIDATION` | A field is missing, malformed, or out of range. |
| `COB_SIGNATURE` | Signature absent, malformed, or does not verify. |
| `COB_EXPIRED` | Outside the validity window. |
| `COB_POLICY` | Refused by chain, asset, or amount policy. |
| `COB_STATE` | A payment transition is not allowed. |

## 11. Security considerations

**Verify, never trust.** A receiver that acts on an unverified envelope has no security at all.
Verification is cheap; there is no reason to skip it.

**Field smuggling.** Reading an envelope member outside the signed allow-list (§4.1) lets an
attacker add a field the signer never saw. Read `body` and nothing else.

**Replay.** Without a nonce cache (§7), an envelope is valid until it expires, however many times
it arrives. Keep validity windows short.

**Clock trust.** Skew tolerance is a window an attacker can use. It is a convenience, not a
requirement; a receiver with a reliable clock **MAY** set it to zero.

**Amount handling.** Floats lose money. Every amount is a decimal string, converted to integer base
units with exact arithmetic at the boundary. Any implementation that stores an amount as a
floating-point number is non-conformant and dangerous.

**Policy bypass.** The mainnet gate exists because an autonomous agent can be induced to spend.
It **MUST** be a code-level gate, not a prompt-level instruction.

**Key custody.** The private key *is* the agent. It **MUST** be stored outside any repository,
with restrictive permissions, and **MUST NOT** appear in logs.

**Unaudited.** This draft is a research prototype. It **MUST NOT** be deployed on mainnet with
funds anyone would miss.

## 12. Open questions

Tracked here rather than left implicit, because a draft that hides its gaps is worse than one that
lists them.

1. **Key rotation and revocation.** Not specified. An identity is currently permanent.
2. **Discovery.** How does an agent find another's endpoint? `.well-known/cob.json` proposed; not yet normative.
3. **Transport binding.** Deliberately unspecified. HTTPS POST of a raw envelope is the reference choice.
4. **Escrow and dispute.** Planned, not designed here.
5. **Receipt verification against chain state.** Out of scope in 0.1; receipts are claims.
6. **Reputation.** Wanted; the mechanism is not chosen, and a central score is explicitly undesirable.
7. **Multi-signature envelopes.** Not supported. Would need a `sig` array and a version bump.

## 13. Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-09-28 | First draft. Identity, envelope, canonical form, payment request/receipt, matching, lifecycle, policy, error codes. |
| 0.1 | 2026-09-30 | `allowMainnet: true` is refused rather than honoured (issue #7). `allowUnlimited` added to the policy, default `true`. |
