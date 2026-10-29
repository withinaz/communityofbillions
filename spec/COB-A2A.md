# `cob.a2a` — the COB/1 envelope as an A2A extension

**Version:** 0.1 (draft)
**Status:** 🚧 Draft — specification only; no implementation and no conformance vectors
**Extension URI:** `https://github.com/withinaz/communityofbillions/a2a/cob/v1`
**Licence:** CC-BY-4.0

---

## Abstract

This document defines how a **COB/1 envelope** is carried inside an **A2A message**, how an agent
declares that it can process one, and what activation means. It adds no field to any A2A core
structure: the envelope travels in the `metadata` map that A2A already provides.

It does not define discovery or settlement, and it adds no transport of its own. Those remain where
they are: the A2A Agent Card for discovery, A2A's bindings for transport, and (for settlement) the
question recorded as issue [#25](https://github.com/withinaz/communityofbillions/issues/25).

## Status of this document

This is a **draft**. It is written normatively — `MUST` and `SHOULD` mean what
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) says — because an implementer needs something
exact to follow. It has no implementation and no test vectors. A change to any rule below is a
breaking change and **MUST** use a new extension URI; a change to the envelope is COB/1's business,
not this document's.

The extension URI is an identifier, not an endpoint. Until the project has a documentation site, the
canonical text of v1 is this file; the URI itself is not yet expected to resolve.

## 1. Terminology

| Term | Meaning |
| --- | --- |
| **A2A extension** | A URI-identified layer on A2A, declared in an Agent Card and activated per request. |
| **COB identity** | An Ed25519 public key and the `cob:agent:…` identifier derived from it (COB/1 §2). |
| **Envelope** | The signed COB/1 message defined in COB/1 §4. |
| **Extension URI** | The identifier in the header of this document. |

## 2. What this extension is, and is not

A2A is the messaging layer. COB/1 is a signed payload with a small set of payment messages. This
extension is the seam between them: an A2A message may carry one COB/1 envelope, and the declaration
says which COB identity the endpoint claims.

It is **not**:

- a replacement for the Agent Card as a discovery document (that is issue
  [#24](https://github.com/withinaz/communityofbillions/issues/24));
- a settlement rail. A `cob.payment.receipt` is still a payee-signed claim (COB/1 §8.3, threat T11);
- an AP2 mandate, and not a profile of one. AP2 requires a non-deterministic signature for the
  Checkout JWT and explicitly rules out Ed25519 (`docs/a2a.md` §3), so composing the two is not a
  rename.

A2A's extension rules are the constraint that shapes everything below: an extension may not add
fields to core structures or new enum values, and custom data belongs in `metadata`
([A2A extensions](https://a2a-protocol.org/latest/topics/extensions/)). This draft uses only
`metadata`, the existing `Message.extensions` list, and the `A2A-Extensions` header.

## 3. Two identities, kept separate

The A2A endpoint and the COB agent are different things, authenticated differently:

| | A2A endpoint | COB agent |
| --- | --- | --- |
| Identity | web security — OAuth 2.0, OIDC, API key — declared in the Agent Card | Ed25519 public key |
| Proof | the transport's authentication | the envelope signature (COB/1 §4.2) |

The extension binds them by **declaration**:

- `AgentExtension.params.agent` names the COB identity the endpoint speaks for.
- A sender **MUST** set the envelope's `from` to the identity it declares in its own Agent Card. A
  receiver that has that card **SHOULD** check it. The signature, not the declaration, proves the
  key.
- A receiver **MUST** reject an envelope whose `to` is not its own declared `params.agent`.

This binding is a claim by the endpoint, not proof of it. A valid COB signature proves possession of
the COB key and nothing about the A2A endpoint; a valid A2A session proves the endpoint and nothing
about the envelope. Neither **MUST** be treated as satisfying the other.

## 4. Declaration

An agent that can process COB/1 envelopes adds one `AgentExtension` to
`capabilities.extensions`:

```json
{
  "capabilities": {
    "extensions": [
      {
        "uri": "https://github.com/withinaz/communityofbillions/a2a/cob/v1",
        "description": "Carries signed COB/1 envelopes for payment requests and receipts.",
        "required": false,
        "params": {
          "agent": "cob:agent:9tQK3v1sVn0m2Yf4pQ7rLbXwZc8dHjKeSgUaNtMi5Pk"
        }
      }
    ]
  }
}
```

- `required` **MUST** be `false`. An A2A participant that does not understand COB/1 must still be
  able to talk to this agent; marking the extension required would turn every ordinary message into
  a negotiation failure.
- `params.agent` **MUST** be a well-formed COB agent id (COB/1 §2). It is the address an incoming
  envelope's `to` is checked against.
- `params` **MAY** carry additional keys in a later revision. A v1 receiver **MUST** ignore keys it
  does not know rather than reject the declaration.

## 5. Carrying the envelope

A message that carries a COB/1 envelope:

1. sets `Message.metadata["cob.envelope"]` to the **envelope object** — not a serialised string and
   not an array;
2. lists the extension URI in `Message.extensions`.

`Message.extensions` is the A2A field for "extensions present or contributed to this Message". It is
per-message provenance; it does not activate anything by itself (§6).

Rules:

- The value of `cob.envelope` **MUST** be one complete COB/1 envelope. A receiver **MUST** reject a
  value that is not a JSON object or that fails COB/1 §4.3.
- A message **MUST NOT** carry more than one envelope. If an implementation needs to send two, it
  sends two messages.
- The envelope **MUST NOT** be placed in a `Part`, and a receiver **MUST NOT** parse a `Part` as an
  envelope. Parts are model-visible content: a text or data part can be paraphrased, truncated, or
  echoed, and a signature over the paraphrased content is not a signature over the original.
- A receiver **MUST NOT** act on a `cob.envelope` unless the URI is also present in
  `Message.extensions`. The two fields together are the message-level claim; either alone is not.
- The envelope is self-contained. A2A fields **MUST NOT** be used to supply a missing envelope field,
  extend its validity, or override its `body`. The signed allow-list in COB/1 §4.1 is the whole
  authority.
- Keys added by this extension use the `cob.` prefix. Other metadata is untouched.

Why an object rather than the producer's JSON text: COB/1's signature is over the **canonical form**
of the value (COB/1 §3), not over the bytes as they happened to be serialised. A2A already carries
`metadata` as a JSON object, so an object is the natural representation. A producer that serialises
to a string first only adds a parse step before verification.

## 6. Activation

Extensions in A2A are inactive by default and negotiated per request. This draft follows the
mechanism in A2A's extensions documentation:

1. A client that wants COB/1 semantics includes the extension URI in the `A2A-Extensions` header of
   the HTTP request, comma-separated with any others it wants.
2. A server **MUST** process `cob.envelope` only if the extension is both declared in its Agent Card
   and named in the request's `A2A-Extensions` header. If it was not activated, the server **MUST NOT**
   treat the envelope as a payment request or receipt; it processes the A2A message without COB/1
   semantics.
3. A response that processed an envelope **SHOULD** echo the URI in its `A2A-Extensions` header.
4. A client **MUST NOT** treat a `cob.payment.request` as delivered unless the response echoes the
   URI. A server that ignores an unknown extension is behaving correctly under A2A, so the echo is
   the only evidence that the server processed the envelope.
5. Version mismatch is not negotiated downward. A server that does not support `…/v1` ignores the
   activation; it **MUST NOT** fall back to a different version.

This draft defines activation for A2A's HTTP bindings, where the header exists. Other bindings and
push delivery are open questions (§10.2).

The header name is `A2A-Extensions`, as in A2A's extensions documentation. The A2A x402 extension's
§7 says `X-A2A-Extensions`; that discrepancy is recorded in `docs/a2a.md` §3 and is not resolved by
this draft.

## 7. Payment substate

A2A task states are A2A's. COB/1 payment states (COB/1 §8.5) are the payment's. This extension does
not add task states or enum values, following the x402 extension's precedent of a substate in
metadata.

A message **MAY** carry `Message.metadata["cob.payment.status"]` with one of the COB/1 states:
`requested`, `authorized`, `submitted`, `settled`, `failed`, `expired`.

- The value **MUST** be one of those strings. A receiver **MUST** ignore an unknown value rather
  than guess at it.
- The substate is an annotation for routing and display. It is **not** signed, **not** evidence, and
  **MUST NOT** be used to settle a payment. Settlement comes from the envelope and the local
  `Payment` state machine, exactly as it does without A2A.
- The substate **MUST NOT** contradict the envelope. An envelope that carries a
  `cob.payment.receipt` cannot be annotated `requested`, and a receiver that sees the contradiction
  **SHOULD** trust the envelope and report the annotation as malformed.

## 8. Verification and replay

- The receiver **MUST** verify the envelope per COB/1 §4.3 before reading `body`. A2A transport
  authentication is not a substitute for that check.
- The replay key is `(from, nonce)`, as in COB/1 §7. It is scoped to the **COB identity**, not to an
  A2A task or context. The same envelope replayed in a new task, a new context, or a new transport
  is still a replay and **MUST** be refused while its pair is retained.
- A2A retries deliver the same `Message` again. A retry of an envelope is a duplicate, not a new
  payment request; the receiver **MUST** apply the replay rule rather than acting twice.
- A2A's `messageId` and COB/1's `id` are independent identifiers. Neither **MUST** be derived from
  the other or checked against it.
- An A2A task may outlive the envelope. COB/1 expiry still applies; a task in progress does not
  extend it.

## 9. Security considerations

**The metadata is not the signed object.** Only `cob.envelope` is covered by a COB/1 signature. Every
other metadata key, including `cob.payment.status`, is ordinary A2A data protected (if at all) by
the transport. Terms, amounts, and destinations **MUST** come from the envelope, never from a
sibling key that is easier to read.

**Silent non-processing is the default failure.** `required: false` keeps ordinary A2A traffic
working, at the cost that a server may ignore a payment request without an error. Rule §6.4 makes the
echo the client's signal; a client that does not check it can believe it asked for payment when it
did not.

**The signature does not authenticate the endpoint.** A stranger can present a valid envelope signed
by a key the receiver has never seen. Whether to trust that key is a policy question outside this
document; the signature only proves the key signed these bytes.

**The extension is not the rail.** A `cob.payment.receipt` remains a claim. Carrying it over A2A
changes nothing about threat T11; a receiver that wants settlement evidence must check the
transaction, as it would without A2A.

**Parts are model-visible.** A `Part` is the content a model reads, and a model may paraphrase,
truncate, or echo it. That is why the envelope is in `metadata` (§5) and not in a part. Metadata can
still be rewritten by anything between the two agents; TLS and A2A authentication protect the
channel, the COB signature protects the envelope, and neither protects an unsigned annotation from
being *displayed*.

## 10. Open questions

1. **More than one COB identity per Agent Card.** `params.agent` is singular. An agent that publishes
   several identities (COB/1 §2 allows it) has no way to declare them all. A future revision could
   add `params.agents`, but the receiver-side `to` check would need a rule for choosing among them.
2. **Activation outside an HTTP request.** Push notifications, webhooks, and non-HTTP bindings carry
   no `A2A-Extensions` request header. This draft does not define how an envelope is activated
   there, and a receiver **SHOULD** treat such an envelope as inactive until it is.
3. **Receipt as an Artifact.** A receipt is a deliverable. `Artifact.metadata` also exists, and a
   future revision might prefer it to a `Message`. This draft uses `Message` because it is the turn
   object that already carries `extensions` and metadata; task- and artifact-level placement is left
   for a revision that can test it.
4. **Relationship to x402.** Issue #25. This extension carries a claim; x402 names a transaction.
   Whether a COB/1 receipt should embed an x402 `SettlementResponse` is not decided here.
5. **Paid skills.** A2A declares extensions per agent, not per skill. There is no way to say "this
   skill costs money and requires `cob.a2a`" in the Agent Card. `required: false` is the only honest
   setting this draft can use.
6. **Canonicalisation is two operations.** COB/1 canonicalises the envelope; A2A canonicalises an
   Agent Card under its own field-presence rule (`docs/a2a.md` §5). They are compatible but not the
   same step, and this extension does not merge them.

## 11. Change log

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-10-29 | First draft. URI, Agent Card declaration, `metadata["cob.envelope"]`, activation and echo, payment substate, replay and security notes, open questions. |

---

## References

- [`spec/COB-1.md`](COB-1.md) — the envelope, identity, canonical form, payment messages.
- [`docs/a2a.md`](../docs/a2a.md) — the reading notes this draft is built on.
- [A2A extensions](https://a2a-protocol.org/latest/topics/extensions/) — declaration, activation,
  limits, versioning.
- [A2A protocol definition](https://a2a-protocol.org/latest/definitions/) — `Message.metadata`,
  `Message.extensions`, `AgentExtension`.
