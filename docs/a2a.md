# Notes on A2A, AP2 and x402

Development notes on how `communityofbillions` relates to the agent-interoperability protocols that
already exist. Written to be appended to: the maintenance agent adds a dated entry at the bottom of
every pass it spends on this track.

Reference: <https://a2a-protocol.org/latest/>

These are notes, not a specification, and not a commitment. They record what was read, what was
decided, and — more usefully — what is still uncomfortable.

---

## 1. A2A, in short

The **Agent2Agent (A2A) Protocol** is an open standard for communication between AI agents built on
different frameworks and by different vendors. It was developed by Google and **donated to the Linux
Foundation on 23 June 2025**; it is now under the Agentic AI Foundation, governed by a Technical
Steering Committee with representatives from AWS, Cisco, Google, IBM Research, Microsoft, Salesforce,
SAP and ServiceNow, with more than 150 supporting organisations. Apache 2.0.

Sources: the [protocol site](https://a2a-protocol.org/latest/), the
[Linux Foundation announcement](https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/),
and the [one-year milestone](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year).

### Core concepts

| Element | What it is |
| --- | --- |
| **Agent Card** | A JSON document describing an agent: identity, endpoint, capabilities, skills, auth requirements. |
| **Task** | A stateful unit of work with a unique id and a defined lifecycle. |
| **Message** | One turn of communication, with a role and one or more `Part`s. |
| **Part** | A content container: `text`, `raw` (bytes), `url`, or `data` (structured JSON), plus `mediaType` and `metadata`. |
| **Artifact** | A concrete deliverable produced during a task. |
| **Context (`contextId`)** | Groups related tasks across a series of interactions. |

Bindings: JSON-RPC 2.0 over HTTP(S), with Server-Sent Events for streaming and webhooks for push
notifications. Authentication is ordinary web security — OAuth 2.0, OpenID Connect, API keys —
declared in the Agent Card and carried in HTTP headers, *outside* the A2A messages.

### Extensions — the part that matters most to us

A2A has a **formal extension mechanism**, and this is the natural place for anything like COB/1:

- An extension is identified by a **URI** and defined by its own specification. Anyone may define,
  publish and implement one.
- Agents declare extensions in `AgentCapabilities.extensions` as `AgentExtension` objects
  (`uri`, `description`, `required`, `params`).
- Clients activate them per request with the **`A2A-Extensions`** HTTP header; the response echoes
  which were activated.
- Extensions may add data, RPC methods, state-machine states, or "profile" the core flow.

Two constraints matter:

1. **Extensions cannot change core data structures** — no new fields, no removed required fields,
   no new enum values. Custom data goes in the **`metadata` map** present on core structures.
2. A `required: true` extension must be understood or the request must be rejected. Data-only
   extensions must not be marked required.

Source: [Extensions overview](https://a2a-protocol.org/latest/topics/extensions/).

### A detail worth noticing

From the specification: **Agent Card signing requires a canonical JSON representation.**

> *"Agent Card Canonicalization: When creating cryptographic signatures of Agent Cards, it is
> required to produce a canonical JSON representation."*

That is the same problem `packages/core/src/canonical.js` already solves for the envelope. It is the
single clearest point of contact between the two projects, and it is a point where we may already
have something to offer rather than only something to learn.

---

## 2. What A2A explicitly is not

Worth writing down, because it is where a project like this one can honestly position itself:

- Not an agent development kit.
- Not a sub-agent or tool-call protocol (that is MCP).
- Not a replacement for MCP. **MCP is agent-to-tool; A2A is agent-to-agent.**
- Not an interactive messaging app.

And, critically: **A2A does not handle payments.** It is a communication protocol.

---

## 3. The payment layer: AP2 and x402

A2A does not settle anything. Two things sit next to it.

### AP2 — Agent Payments Protocol

**Read first-hand on 2026-10-06**, from the v0.2 specification and its sub-documents in
`google-agentic-commerce/AP2` (`docs/ap2/specification.md`, `agent_authorization.md`,
`checkout_mandate.md`, `payment_mandate.md`, plus the repository `README.md` and `mkdocs.yml`).
Everything in this subsection is traceable to those files.

- **Two mandate types, not three.** The earlier Intent / Cart / Payment description in this file
  came from the launch announcement and is out of date. AP2 v0.2 defines a **Checkout Mandate**
  (`vct` `mandate.checkout.1`, open `mandate.checkout.open.1`) and a **Payment Mandate**
  (`mandate.payment.1`, open `mandate.payment.open.1`). Each mandate type versions its schema in the
  numeric suffix of `vct`, and implementations **MUST** match the exact string.
- **They are SD-JWTs** (RFC 9901), i.e. Verifiable Digital Credentials, not W3C VCs specifically;
  the specification says other VDC formats such as ISO mDocs *could* be substituted.
- **Open and closed.** An open mandate carries `constraints` and a `cnf` proof-of-possession key; a
  closed mandate is bound to one transaction by a key-binding JWT signed with the key the open
  mandate endorsed. Verifiers always receive a closed mandate; in Autonomous mode they receive the
  open mandate alongside it and **MUST** evaluate every constraint, treating an unknown constraint
  as a failure.
- **Five roles:** Shopping Agent, Credential Provider, Merchant, Merchant Payment Processor, and
  Trusted Surface. The Trusted Surface **MUST** be non-agentic; the Shopping Agent is expected to be
  agentic, which is the threat AP2 is built around.
- **Delegation** is either an OpenID4VP presentation of a User Credential (`transaction_data` with
  `type: "delegate"`) or a Trusted Agent Provider that holds a signing key the agent cannot reach.
- **Receipts are verifier-signed JWTs** carrying `iss`, a `result` of `success` or `error`, and a
  `reference` that is the base64url hash of the mandate received (the `sd_hash` construction). The
  Checkout Receipt and Payment Receipt together are the evidence for a dispute.
- **What it is not:** AP2 calls itself a "security feature within a Commerce Protocol". The commerce
  protocol — catalogue, checkout, the APIs between the roles — is explicitly out of scope, and AP2
  is designed to be compatible with the Universal Commerce Protocol (UCP). It authorises; it does
  not move money and names no settlement rail.
- **Two corrections to what this file used to say.** (a) AP2 v0.2 does not present itself as an A2A
  extension: it says it is part of an ecosystem that includes A2A and MCP, and the A2A tie is
  visible in the repository's samples (`code/samples/.../scenarios/a2a/...`) rather than in the
  specification text. The earlier claim is downgraded to **unverified**. (b) The mandate model is
  the one above, not Intent / Cart / Payment.

**The finding that matters to us.** The specification requires the merchant-signed Checkout JWT to
use a **non-deterministic** signature scheme — "e.g., ECDSA" — and explicitly **not** a
deterministic one, naming **Ed25519**, because the Checkout JWT's hash is published and a
deterministic signature would let an observer test candidate payloads against that hash. COB/1 is
Ed25519 throughout. Any future "COB/1 as an AP2 profile" has to confront that; it is not a detail
that can be waved through.

### x402

**Read first-hand on 2026-10-08.** Core protocol from `coinbase/x402` — the repository has since
moved to `x402-foundation/x402`, and Coinbase's copy is a development fork; this pass read the fork's
`main`: `specs/x402-specification-v2.md` and `specs/schemes/exact/scheme_exact_evm.md`. The A2A
extension from `google-agentic-commerce/a2a-x402`: `spec/v0.1/spec.md`. Nothing below is second-hand.

- **What it is.** An open, chain- and transport-agnostic standard for internet-native payments,
  reviving HTTP `402 Payment Required`. Three roles: **resource server**, **client**, **facilitator**
  (verification and settlement). The facilitator pays gas but cannot change the amount or the
  destination; both are fixed by the client's signature.
- **The flow.** The client asks for a resource; the server answers `402` with a `PaymentRequired`
  object in a `PAYMENT-REQUIRED` header. The client signs a `PaymentPayload` and retries with it in
  `PAYMENT-SIGNATURE`. The server verifies (locally or through the facilitator's `POST /verify`),
  does the work, then settles directly or through `POST /settle`, and returns a `SettlementResponse`
  in `PAYMENT-RESPONSE`. `GET /supported` advertises the `(scheme, network)` pairs a facilitator can
  handle; `GET /discovery/resources` lists monetised resources (a "Bazaar").
- **Types.** `PaymentRequirements` is `{scheme, network, amount, asset, payTo, maxTimeoutSeconds,
  extra}`. `PaymentPayload` carries the chosen requirement as `accepted`, the scheme-specific
  `payload`, and an `extensions` map. `SettlementResponse` is `{success, errorReason?, payer?,
  transaction, network, amount?}` — the `transaction` is the on-chain hash.
- **Version 2.** The core specification is at **v2**, which moved networks to **CAIP-2**
  (`eip155:8453` Base, `eip155:84532` Base Sepolia) and renamed v1's `maxAmountRequired` to `amount`.
  The scheme directories also list `upto` and `batch-settlement`; `exact` is the one shipping.
- **`exact` on EVM.** Three asset-transfer methods, chosen by what the token supports: **EIP-3009**
  `transferWithAuthorization` (recommended, truly gasless — the USDC path), **Permit2** with a
  witness-bearing proxy (the universal ERC-20 fallback), and **ERC-7710** delegation for smart
  accounts. Replay protection is EIP-3009's 32-byte nonce plus a `validAfter`/`validBefore` window;
  the authorization is an EIP-712 signature over secp256k1.
- **The A2A x402 extension is real.** Canonical URI
  `https://github.com/google-a2a/a2a-x402/v0.1`; declared in `capabilities.extensions`; state is
  carried in `Message.metadata` as `x402.payment.status` — `payment-required`, `payment-submitted`,
  `payment-rejected`, `payment-verified`, `payment-completed`, `payment-failed` — over the existing
  A2A task states. It adds no task states, which is the precedent §8 asked for.

**The two things that matter to us.**

1. **x402 is the settlement rail COB/1 deliberately does not have.** `cob.payment.receipt` is a
   payee-signed *claim* (threat T11). x402's `SettlementResponse` names an on-chain transaction,
   which a counterparty can check against the chain — the direction T11 points at. It is not a
   solution by itself: the response is still produced by the facilitator, so a client must verify the
   hash rather than trust the object.
2. **The identity layers do not compose.** x402's `exact` scheme signs EIP-712 typed data with the
   payer's secp256k1 key; COB/1 signs a canonical JSON envelope with Ed25519. That is a different
   conflict from AP2's: the rail does not use our identity at all. Composition means carrying an x402
   payload *inside* a COB/1 envelope as opaque data and keeping the two signature domains separate,
   not expecting one envelope to satisfy both.

> **Two discrepancies worth recording, both in the other specifications.**
>
> (a) **Version skew.** The A2A x402 extension is at **v0.1** and its examples still show x402 **v1**
> fields — `x402Version: 1`, `maxAmountRequired`, `network: "base"`. Core x402 is at **v2**
> (`x402Version: 2`, `amount`, CAIP-2). An implementer copying the extension's examples verbatim
> would emit a v1 payload.
>
> (b) **Header name.** The extension's §7 says activation uses the `X-A2A-Extensions` header. A2A's
> own extensions documentation says the header is **`A2A-Extensions`**, a comma-separated list of
> URIs. One of the two is wrong, and this pass did not find a version that resolves it.

The composition AP2's own role description is consistent with still holds: **A2A** to find and talk
to another agent, **AP2** to authorise the payment, **x402** to settle it. Both ends are now read
first-hand. Whether COB/1 should implement an x402 client, interop with one, or document why neither
is issue [#25](https://github.com/withinaz/communityofbillions/issues/25) and is not decided here.

Sources: [AP2 specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md),
[x402 specification v2](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md),
[exact scheme on EVM](https://raw.githubusercontent.com/coinbase/x402/main/specs/schemes/exact/scheme_exact_evm.md),
[A2A x402 extension v0.1](https://raw.githubusercontent.com/google-agentic-commerce/a2a-x402/main/spec/v0.1/spec.md),
[A2A extensions documentation](https://a2a-protocol.org/latest/topics/extensions/).

---

## 4. The uncomfortable part

Laid out plainly, because pretending otherwise would be the worst thing these notes could do:

| Concern | Who already does it |
| --- | --- |
| Agent discovery | A2A Agent Card |
| Signed agent-to-agent messages | A2A, with its own extension model |
| Payment authorisation with cryptographic evidence | AP2 mandates |
| Stablecoin settlement between agents | x402 (EIP-3009) |
| Canonical JSON for signing | Required by A2A; solved in `canonical.js` |

**COB/1 as currently designed overlaps almost entirely with A2A + AP2 + x402.**

Those are three protocols with a Linux Foundation, 150+ organisations, six SDKs, tutorials, and
production deployments. Building a fourth from scratch and hoping for adoption is not a strategy;
it is a hobby with extra steps.

That is the honest reading, and it should be the starting assumption for everything below.

---

## 5. What COB/1 actually has

Not nothing. Four things, and they are worth being precise about:

1. **Zero dependencies, and small enough to audit in one sitting.** `packages/core` imports
   `node:crypto` and nothing else. A2A arrives with SDKs, a JSON-RPC binding, a task state machine,
   and a governance process. There is a real place for a reference envelope that a person can read
   in twenty minutes and reimplement in a language that has no SDK.
2. **A precise, opinionated canonicalisation.** A2A *requires* canonical JSON for Agent Card
   signing; COB/1 has a tested implementation of a strict RFC 8785 subset, including the rejection
   cases that make it safe.
3. **Custody-free, registry-free identity.** Derived from the key, no authority, no account. A2A
   leaves identity to web security (OAuth, OIDC, API keys) — which is right for enterprises and
   heavier than two agents settling a two-dollar task need.
4. **The mainnet gate as code.** A `throw`, not a policy note. That is a specific, defensible
   position about autonomous spending that none of the three protocols takes.

What COB/1 does **not** have: adoption, a governance body, an SDK ecosystem, or a reason for anyone
else to implement it. Those are not solved by writing more code.

---

## 6. Options

**A. Compete.** Ship COB/1 as an independent protocol and try to build an ecosystem.
*Assessment: no. There is no path from here to adoption, and the energy is better spent elsewhere.*

**B. Compose — become an A2A extension.** Keep the envelope and its guarantees, and carry them as an
A2A extension: declared in the Agent Card under `AgentExtensions`, transported over A2A's JSON-RPC
binding, with COB/1 messages in the `metadata` map. Discovery becomes the Agent Card instead of a
bespoke `.well-known` document. Settlement aligns with x402 rather than inventing a rail.
*Assessment: this is the strongest option, and it is a genuine piece of work rather than a retreat.*

**C. Stay narrow — be the smallest thing that settles.** Keep COB/1 independent but explicitly
positioned as a minimal, auditable envelope that *interoperates* with A2A rather than replacing it.
*Assessment: viable, and compatible with B. It is roughly what this repository already is; writing
it down would make it a choice rather than an accident.*

**Recommendation: B, with C as the tone.** Compose with A2A, keep the zero-dependency core as the
thing that makes the repository worth reading, and stop implying that anyone should adopt COB/1 as a
replacement for anything. The README says "agents should be able to find each other, talk to each
other, and pay each other"; A2A and x402 have largely answered the first, and the useful contribution
is a small, legible, well-tested piece of the last one.

This is an operator decision, not a maintenance-pass one. Issue
[#20](https://github.com/withinaz/communityofbillions/issues/20) records it.

---

## 7. Concrete alignment steps

In rough dependency order. Each is a pass, not a day's work crammed into one a pass.

1. **Read the AP2 specification and the x402 extension properly**, replacing the second-hand notes in
   §3 with things actually verified. **Done.** AP2 was read on 2026-10-06; x402, the `exact` scheme
   and the A2A x402 extension on 2026-10-08. §3 is first-hand throughout. What that reading leaves
   open is composition across two signature domains, and the extension's v1/v2 skew.
2. **Compare canonicalisation.** Check `canonical.js` against A2A's stated requirement for Agent Card
   signing, and write the comparison down. Either we match, or we have found a real gap in one of us.
3. **Draft `cob.a2a` as an A2A extension**: URI, `AgentExtension` declaration, where COB/1 data lives
   in `metadata`, and what activation means. Specification first, code later.
4. **Agent Card discovery.** Decide whether the planned `.well-known/cob.json` (issue #1) becomes an
   Agent Card, or is dropped in favour of one.
5. **Settlement.** Decide the relationship to x402 — implement it, interoperate with it, or document
   why neither.
6. **Say it in the README.** A short, honest "how this relates to A2A, AP2 and x402" section. The
   current README implies COB/1 stands alone, which is no longer the truthful framing.

---

## 8. Open questions

- Is COB/1's envelope still worth keeping once A2A's extension model can carry it? *Probably yes, as
  the canonical-and-signed payload — but the honest answer is "keep it, and find out by using it".*
- Does AP2's mandate model subsume what `cob.payment.request` and `cob.payment.receipt` do? *On the
  AP2 reading of 2026-10-06: **no** — and the x402 reading of 2026-10-08 does not change that.* AP2
  authorises a payment and produces evidence of a user's delegation; it has no invoice addressed
  from one agent to another, no payer/payee identity of the COB/1 kind, and no settlement. Its
  Payment Receipt is a verifier's statement about a mandate — the Credential Provider, Network or
  Merchant Payment Processor — not the payee's claim that a transfer happened. x402 supplies the
  settlement evidence our receipt only claims, but it too defines no invoice between two identified
  agents; its `PaymentRequirements` are the server's terms and its `PaymentPayload` the client's
  authorization. All three sit in the same layer, and none is interchangeable with the others.
- A2A says extensions must not change core structures or add enum values, but its extensions
  documentation also lists "state machine extensions" and allows **substates** in `metadata`. The
  x402 extension takes the safe path: it keeps the core task states and puts a finer-grained
  `x402.payment.status` in `Message.metadata`. That is the precedent to follow for `cob.a2a`; adding
  task states is the part still in question.
- What does "settled" mean when the settlement rail is x402 and the evidence is an on-chain
  transfer? Our T11 (receipt forgery) says a receipt is a claim; x402's `SettlementResponse` names
  the transaction, so the claim becomes checkable against the chain. But the response is still
  produced by the facilitator, so it is evidence to verify rather than proof by construction. T11 is
  narrowed, not closed — a client that does not check the hash learns nothing new.

---

## 9. Dated notes

Appended by the maintenance agent. Newest last. Each entry says what was read, what was decided, and
what changed in the repository as a result — or says plainly that nothing changed.

### 2026-10-01 — initial notes

Written by hand, not by a pass. Nothing in the repository changed as a result: this file is the
first artefact of the track. The conclusion that mattered was uncomfortable and is recorded above in
§4 rather than softened.

Next: read the AP2 specification properly (§7.1).

### 2026-10-06 — AP2 read first-hand; the notes were wrong

**Read:** AP2 at `google-agentic-commerce/AP2`, `main` — `docs/ap2/specification.md` (v0.2),
`agent_authorization.md`, `checkout_mandate.md`, `payment_mandate.md`, plus `README.md` and
`mkdocs.yml`. Nothing was read second-hand for this entry.

**Changed:** §3 rewritten from the specification. The Intent / Cart / Payment model this file had
been repeating came from the launch announcement and is wrong for v0.2: AP2 defines two mandates,
Checkout and Payment, each with open and closed states, carried as SD-JWTs with `vct` version
suffixes. The claim that AP2 *is* an A2A extension is not in the specification and is now marked
unverified. The answer to issue #21's question is written into §8: AP2 does not subsume
`cob.payment.request` / `cob.payment.receipt`, though it sits in the same layer.

**The uncomfortable finding, recorded in §3 rather than smoothed over:** AP2 requires the
merchant-signed Checkout JWT to use a non-deterministic signature scheme and explicitly rules out
**Ed25519**, which is the only signature scheme COB/1 has. A "COB/1 as an AP2 profile" is therefore
not a rename; it would force a decision about the identity layer.

**Not done:** x402 and the A2A x402 extension are still second-hand and still marked as such in §3.
Reading them is the rest of issue #21.

### 2026-10-08 — x402 and the A2A x402 extension read; §3 is first-hand throughout

**Read:** x402 from `coinbase/x402` `main` (the development fork of the standard, which has moved to
`x402-foundation/x402`) — `specs/x402-specification-v2.md`, `specs/schemes/exact/scheme_exact_evm.md`,
`README.md`. The A2A x402 extension from `google-agentic-commerce/a2a-x402` — `spec/v0.1/spec.md`,
`README.md`. A2A's own extensions documentation at `a2a-protocol.org/latest/topics/extensions/`, to
check the activation header and the limits on extensions. Nothing was read second-hand.

**Changed:** §3's x402 subsection rewritten from those files. The three claims the old second-hand
paragraph carried are now settled: EIP-3009 is the recommended EVM transfer method and Permit2 the
universal ERC-20 fallback (ERC-7710 is also listed); the A2A x402 extension exists, with canonical URI
`https://github.com/google-a2a/a2a-x402/v0.1` and its state carried in `Message.metadata` rather than
in new task states; and the composition "A2A to talk, AP2 to authorise, x402 to settle" is consistent
with both specifications. §7.1 is marked done and §8's provisional answers are updated. Issue #21
closes with this entry.

**Findings recorded rather than smoothed over:**

- **The identity layers do not compose.** x402 signs EIP-712 over secp256k1 with the payer's Ethereum
  key; COB/1 signs Ed25519 over canonical JSON. Unlike AP2's Ed25519 exclusion, this is not a rule
  against us — the rail simply uses a different identity. Composition means an x402 payload inside a
  COB/1 envelope as opaque data, with two separate signature domains.
- **The A2A x402 extension is one protocol version behind.** It is v0.1 and its examples use x402 v1
  field names (`x402Version: 1`, `maxAmountRequired`, `network: "base"`), while core x402 is v2
  (`amount`, CAIP-2).
- **The activation header disagrees between the two specifications.** The extension says
  `X-A2A-Extensions`; A2A's extensions documentation says `A2A-Extensions`. Not resolved here.
- **x402 points the way out of T11 but does not close it.** Its `SettlementResponse` names an
  on-chain transaction hash, which is externally checkable, but the response is produced by the
  facilitator, so a client must verify the hash rather than trust the object.

**Not done:** the decision this reading feeds — whether COB/1 implements an x402 client, interops
with one, or documents why neither — is issue #25 and is not this pass's call. Nothing in the
repository's code changed; this pass is notes only. The A2A steps after §7.1 remain unstarted:
canonicalisation comparison (#22), the `cob.a2a` extension draft (#23), and the Agent Card decision
for `.well-known/cob.json` (#24).
