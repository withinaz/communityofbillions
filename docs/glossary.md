# Glossary

Terms used with a precise meaning in this project. Where a word has an ordinary meaning and a
COB/1 meaning, the COB/1 meaning wins in this repository.

**Agent** — An autonomous software process with exactly one identity. Not a model, not a session:
an agent is the thing that holds a key.

**Agent id** — `cob:agent:` followed by the unpadded base64url of an Ed25519 public key. 53
characters. Derived, never issued. See §2 of the spec.

**Allow-list (signed set)** — The explicit list of envelope fields covered by a signature. The
alternative — "everything except `sig`" — permits field smuggling. See §4.1.

**Amount** — A non-negative decimal string such as `"2.50"`. Never a JSON number. See §8.1.

**Base units** — An integer representation of an amount, scaled by the asset's decimals.
`"2.50"` USDC is `2500000n` base units. The only representation in which amounts are compared.

**Body** — The `body` member of an envelope. Opaque to the protocol; the application owns its shape.

**Canonical form** — The unique byte sequence derived from a JSON document. Two documents with the
same canonical form are the same document for signing purposes. See §3.

**Chain** — A named, registered settlement network: `base-sepolia`, `ethereum-sepolia`, `base`,
`ethereum`. Registered in `CHAIN_REGISTRY`. Unknown names are refused, never guessed.

**COB/1** — This protocol. `/1` is the wire version and appears as `cob: "1"` in every envelope.

**Envelope** — A signed, self-contained message. The only primitive COB/1 requires.

**Escrow** — A flow where funds are committed and released on a condition. **Planned, not
implemented.** Mentioned here so the word is not mistaken for a feature.

**Invoice** — A `cob.payment.request`, identified by `invoiceId`.

**Envelope digest** — SHA-256 over the canonical signed set, base64url. For logs and correlation,
not for signing.

**Fail closed** — On ambiguity, refuse. An unknown chain, asset, message type, or envelope version
is rejected rather than passed through.

**Mainnet gate** — The `allowMainnet` policy flag, default `false`. A code-level refusal, not an
instruction to a model. In this version the opt-in itself is locked: setting it to `true` throws
(issue #7), so mainnet is unreachable by construction.

**`allowUnlimited`** — A policy flag, default `true`, naming the absence of a spending ceiling: an
empty `maxAmount` means an amount is uncapped. It exists so that unbounded spending can require a
visible act once the mainnet gate opens.

**Nonce** — ≥ 16 bytes of entropy, base64url, unique per envelope. The replay key is
`(from, nonce)`.

**Payee** — The address funds are sent to: `payTo` in a request, `payee` in a receipt. A receipt
settles a request only if these match.

**Payer** — The agent that sends funds.

**Receipt** — A `cob.payment.receipt`: a **claim** of payment with structural evidence. Not proof.
Chain-state verification is Phase 2.

**Settlement** — The moment a payment reaches the terminal `settled` state after a receipt matches
its request. Terminal: it cannot be unsettled.

**Skew** — Permitted clock difference when judging `created` and `expires`. Recommended 30 s,
never above 5 minutes.

**Testnet-first** — The design stance that the default configuration can only move valueless funds.
Phase 2 adds mainnet support behind the gate; nothing before it does.

**Zero-dependency** — `packages/core` imports only `node:crypto`. A protocol you cannot audit by
reading, you cannot trust.
