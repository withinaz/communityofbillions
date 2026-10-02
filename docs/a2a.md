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

A2A does not settle anything. Two things sit next to it:

**AP2 — Agent Payments Protocol.** An **A2A extension** for payment *authorisation*. It chains three
cryptographically signed mandates:

- an **Intent Mandate** (the user delegates authority),
- a **Cart Mandate** (the user approves a specific cart at a specific price),
- a **Payment Mandate** (a derived credential the network sees).

It is payment-method agnostic, built on W3C Verifiable Credentials, and designed to produce
non-repudiable evidence for disputes.

**x402.** A payment *execution* protocol, HTTP-native, using stablecoins. It relies on **EIP-3009**
(`transferWithAuthorization`) for gasless USDC transfers and **Permit2** for other ERC-20 tokens.
Google published an official **A2A x402 extension**.

The composition their documentation describes: an agent uses **A2A** to find and talk to another
agent, **AP2** to authorise the payment, and **x402** to settle it.

Sources: [Announcing AP2](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol),
[AP2 specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md),
[Coinbase on AP2 + x402](https://www.coinbase.com/developer-platform/discover/launches/google_x402),
[x402 explained](https://eco.com/support/en/articles/12328618-x402-protocol-explained-how-ai-agents-pay-onchain).

> **Not yet read.** These AP2 and x402 notes come from announcement material and secondary write-ups,
> not from the AP2 specification itself. Anything below that depends on their detail is marked as an
> assumption. Reading them properly is a pass of its own.

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
   §3 with things actually verified.
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
- Does AP2's mandate model subsume what `cob.payment.request` and `cob.payment.receipt` do? If it
  does, our payment messages should become an AP2 profile, not a parallel design.
- A2A says extensions must not change core structures. A settlement extension that wants to add task
  **states** may be pushing against that. Worth checking before designing one.
- What does "settled" mean when the settlement rail is x402 and the evidence is an on-chain
  transfer? Our T11 (receipt forgery) says a receipt is a claim; x402 may make the claim verifiable
  by construction. That would resolve the largest open risk in the threat model.

---

## 9. Dated notes

Appended by the maintenance agent. Newest last. Each entry says what was read, what was decided, and
what changed in the repository as a result — or says plainly that nothing changed.

### 2026-10-01 — initial notes

Written by hand, not by a pass. Nothing in the repository changed as a result: this file is the
first artefact of the track. The conclusion that mattered was uncomfortable and is recorded above in
§4 rather than softened.

Next: read the AP2 specification properly (§7.1).
