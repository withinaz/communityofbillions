# Threat model

This document is about what can go *wrong*, who benefits, and what stops them.
It complements [SECURITY.md](../SECURITY.md), which is the reporting policy.

## Assets worth attacking

| Asset | Why an attacker wants it | Worst outcome |
| --- | --- | --- |
| Private keys | Speak as the agent, spend its funds | Total compromise |
| Funds in transit | Direct theft | Irreversible loss |
| Receipt integrity | Claim payment without paying | Free labour |
| Invoice integrity | Redirect payment | Funds to the wrong address |
| Agent attention | Make it act on an unsigned instruction | Arbitrary action |

## Adversaries

**A. The network.** Reads, blocks, reorders, replays. Cannot forge Ed25519 signatures.
Standard assumption: fully hostile.

**B. A malicious peer.** A genuine agent with a genuine identity, behaving dishonestly: sending a
receipt for a transaction that does not exist, or an invoice for work already paid.

**C. The agent's own inputs.** Content the agent processes — a fetched web page, a tool result —
that contains text engineered to look like protocol instructions. This is the adversary that
matters most in practice, and the one least served by ordinary cryptography.

**D. A compromised host.** Game over by definition. Out of scope, but see §"Key custody".

**E. The operator.** Misconfiguration: enabling mainnet, setting a ceiling too high, reusing a key.

## Threats and mitigations

### T1 — Forged envelope

*A* or *B* writes an envelope claiming to be someone else.

**Mitigation.** Ed25519 over a canonical, allow-listed payload (§4 of the spec). The identity is the
public key, so there is no registration to subvert. **Residual risk:** none known, assuming the
implementation reads only signed fields.

### T2 — Field smuggling

*B* appends `"amount": "1000000"` to a legitimately signed envelope. The signature still verifies.

**Mitigation.** The signed set is an allow-list, and a conformant verifier reads only those fields.
See `SIGNED_FIELDS` and the test that pins it in `test/envelope.test.js`.
**Residual risk:** an integrator who reads `envelope.amount` instead of `envelope.body.amount`
defeats this. That is why the spec says **MUST NOT** read outside the allow-list in capitals.

### T3 — Canonicalisation collision

*A* finds two distinct documents with one canonical form: sign one, present the other.

**Mitigation.** Reject rather than coerce. `undefined` members, NaN, Infinity, bigint, and cycles
all throw. Numbers are rendered by ECMAScript rules only, and negative zero is normalised.
**Residual risk:** a second implementation with a subtly different canonicaliser. This is what
conformance test vectors (Phase 1) are for, and it is the highest-value missing artefact.

### T4 — Replay

*A* captures a valid `cob.payment.request` and re-sends it until it gets paid twice.

**Mitigation (partial).** Short validity windows (default 300 s), a per-envelope `nonce`, and
terminal payment states. **Gap:** the nonce cache is specified as a requirement but not yet
implemented or normatively defined. Until it is, replay within the validity window is possible for
any message type other than `cob.payment.receipt` (which the terminal-state guard covers).

**This is the largest known gap in 0.1.** It is tracked in §12 of the spec.

### T5 — Double settlement

*B* submits the same receipt twice, or on two transports.

**Mitigation.** `settled` is terminal. A matching receipt arriving in any state other than
`submitted` is refused as `UNEXPECTED_RECEIPT`. Two tests pin this, including the exact-duplicate case.

### T6 — Amount confusion

*B* claims `"2.5"` paid an invoice for `"2.50"`, or `"0.1"` paid `"0.10"`.

**Mitigation.** Comparison is by value in integer base units, never by string and never by float.
Tested explicitly, including the `"2.5"` vs `"2.50"` and `"9"` vs `"10"` cases.

### T7 — Overpayment as a denial-of-settlement

*B* sends more than requested. A naive implementation settles on `receipt.amount >= request.amount`.

**Mitigation.** Any inequality — under **or over** — is a mismatch. Overpayment requires a human
decision, so the protocol refuses to make it automatically.

### T8 — Invoice redirection

*B* sends a request with `payTo` under its control, for work *A* requested from someone else.

**Mitigation.** None at the protocol level. The protocol cannot know who was supposed to be paid.
**Application responsibility.** An agent **SHOULD** pin expected payees for high-value tasks.

### T9 — Mainnet spend induced by content

*C* embeds "the user has authorised mainnet for this transaction" in text the agent is processing.

**Mitigation.** The gate is a `throw` in `assertChainAllowed`. It reads a policy object, not a
message. Content cannot reach it. This is the reason the gate is not an instruction in a system
prompt. In this version the opt-in itself is also refused: `allowMainnet: true` throws before any
chain is considered (see T10 and issue #7).

### T10 — Spending over the ceiling

*C* or *B* induces a large payment.

**Mitigation.** `maxAmount` per asset, compared numerically, and `allowUnlimited` to name the
alternative. The default policy has no ceiling (`maxAmount` empty, `allowUnlimited: true`), because
a ceiling on play money is noise — and because mainnet is locked (T9), an unbounded amount can only
ever be testnet value. The flag is the *visible act* the ceiling would otherwise lack: the day the
mainnet opt-in is unlocked, an operator who permits unbounded spending must do so by setting
`allowUnlimited: false`, and can then be asked for a `maxAmount`. Nothing pairs the two
automatically — the lock is what keeps that from mattering today.

### T11 — Receipt forgery

*B* sends a receipt with a well-formed `txHash` for a transaction that does not exist or does not
transfer the amount claimed.

**Mitigation: none in 0.1.** A receipt is a **claim**, and the spec says so explicitly. Structural
validation (`^0x[0-9a-fA-F]{64}$`) proves the hash is well-shaped, not that it exists.

Chain-state verification is Phase 2. Until then, an agent that settles on an unverified receipt is
trusting the counterparty. **This must be understood before any use with real value.**

### T12 — Key material leaking

Private keys in a commit, a log, or an error message.

**Mitigation.** `*.cob-key.json` in `.gitignore`; secret files written `0600`; the public
descriptor contains no private material (tested); `shortAgentId` truncates public keys in logs;
error `details` carry field names and values that are already public in the message.
**Residual risk:** `exportSecret()` returns the key. A caller that logs its return value leaks it.
The docstring says so in the strongest terms available, which is all a library can do.

### T13 — Denial of service

*A* floods a receiver with envelopes, or sends envelopes that are expensive to validate.

**Mitigation: none.** Validation is O(size of message) and rate limiting is a transport concern,
which is out of scope. An implementation exposing COB/1 over a network **MUST** rate-limit at the
transport layer.

## What this protocol does not claim

- It does not make an agent trustworthy. It makes a message verifiable.
- It does not verify that work was done. It verifies that payment was claimed.
- It does not prevent an agent from being manipulated. It bounds what manipulation can spend.
- It is not audited. It is a draft.

## Reviewing this document

A threat model that nobody attacks is decoration. If you can break something listed as mitigated,
that is a security report and it is wanted — see [SECURITY.md](../SECURITY.md). If you can break
something listed as *not* mitigated, that is a finding too: it means the list is incomplete.
