# Journal

A public, append-only record of what changed in this repository and **why**.

Rules for this file:

- Newest entries at the top.
- Every entry says what was *attempted*, what actually landed, and what is still broken.
- Failed attempts and corrections stay in the record. An honest history is more useful than a clean one.
- No entry claims something works unless a test in `packages/core/test/` covers it.

---

## 2026-10-08 — x402 read first-hand; the A2A notes have no second-hand claims left

**Attempted:** one increment, chosen by the priority order in the brief. No dated directive names
this pass. Issue #21 (A2A track, `good first issue`) had AP2 read on 2026-10-06 with x402 still
second-hand; finishing it is the first item of the A2A track, which directive D-2 says to prefer. The
pass read x402 and the A2A x402 extension from their own specifications and rewrote the x402 half of
`docs/a2a.md` §3. Nothing else was attempted.

**Landed:**

- §3's x402 subsection rewritten from `coinbase/x402` `main` — `specs/x402-specification-v2.md`,
  `specs/schemes/exact/scheme_exact_evm.md`, `README.md` — and from `google-agentic-commerce/a2a-x402`
  `spec/v0.1/spec.md` and its `README.md`, plus A2A's own extensions documentation for the activation
  header. Nothing in the new §3 is second-hand.
- The three claims the old second-hand paragraph carried are now settled: EIP-3009 is the recommended
  EVM transfer method and Permit2 the universal ERC-20 fallback (ERC-7710 also listed); the A2A x402
  extension is real, with URI `https://github.com/google-a2a/a2a-x402/v0.1` and its payment state in
  `Message.metadata` rather than in new task states; and "A2A to talk, AP2 to authorise, x402 to
  settle" is consistent with both specifications.
- §7.1 marked done, §8's provisional answers updated, and the dated §9 entry added, per D-2.
- Issue #21 closes with this pass: both halves of its reading are complete.

**Findings recorded rather than smoothed over (in §3 and the §9 entry):** x402's identity is
EIP-712/secp256k1 and does not compose with COB/1's Ed25519 — an x402 payload would ride inside a
COB/1 envelope as opaque data, with two signature domains; the A2A x402 extension is at v0.1 and
still shows x402 v1 field names while core x402 is v2; the extension says the activation header is
`X-A2A-Extensions` and A2A's own docs say `A2A-Extensions`; and x402 narrows T11 rather than closing
it, because the settlement response that names the transaction is itself produced by the
facilitator.

**Gate results:** Gate 1 has nothing to check — the diff touches only `docs/a2a.md`, `JOURNAL.md`,
and `CHANGELOG.md`, no `.js`. Gate 2 **170 pass / 0 fail**; Gate 3 `examples/two-agents/run.js`
**19/19 expectations held**. As in the last three entries, Gate 2's written command
(`node --test "packages/core/**/*.test.js"`) cannot run in this sandbox because the default runner
spawns a child per file and the pipe is denied (`spawn EPERM`); it was run as
`node --test --test-isolation=none`, the same files and assertions. CI runs the unmodified command.

**Still broken / not done:**

- **The A2A draft required by directive D-3 could not be saved**, for the same reason as the
  2026-10-06 pass: the queue is outside this pass's file sandbox. This pass did touch A2A, so a draft
  is owed; the write was attempted and refused, and the draft is deliberately not reproduced here.
  Issue #26 already records the three possible fixes and this pass adds nothing to it.
- **`git pull --rebase` fails in this pass sandbox** (`schannel: AcquireCredentialsHandle failed:
  SEC_E_NO_CREDENTIALS`), so the branch was not confirmed against the remote; the working tree was
  clean when the pass began. `git push` is left to the runner, as in earlier passes.
- The decision this reading feeds — implement x402, interop with it, or document why neither — is
  issue #25 and is not this pass's call. The A2A steps after §7.1 (#22 canonicalisation, #23
  `cob.a2a`, #24 Agent Card) are unstarted.
- The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are still
  claims (T11), and issues #18/#19 remain open. The roadmap item for #21 stays 🚧: the roadmap
  reserves ✅ for test-covered work and a reading task has no test to cover it.
- **The project board item for #21 is `Done`.** The first `gh project item-list` call, without
  `--owner`, refused to run non-interactively; re-run as `gh project item-list 2 --owner withinaz`,
  the item already shows status `Done` — GitHub moved it when the issue closed — so no board write
  was needed. The earlier version of this bullet said the board was unavailable; that was wrong, and
  the correction is here.

**Next:** §7.2 / issue #22 — compare `canonical.js` with A2A's Agent Card canonicalisation
requirement. It needs no network reading and is the next step in dependency order.

---

## 2026-10-06 — AP2 read first-hand, and the notes it replaces were wrong

**Attempted:** one increment, chosen by the priority order in the brief. `good first issue` #21
("read the AP2 specification and replace the second-hand notes") is the first item of the A2A track,
which directive D-2 says to prefer, so the pass read AP2 from its own specification and rewrote §3 of
`docs/a2a.md`. Nothing else was attempted.

**Landed:**

- `docs/a2a.md` §3 rewritten from AP2 **v0.2**, read in `google-agentic-commerce/AP2`:
  `docs/ap2/specification.md`, `agent_authorization.md`, `checkout_mandate.md`, `payment_mandate.md`,
  plus `README.md` and `mkdocs.yml`. Nothing in the new §3 is second-hand.
- Two corrections, both stated in the file:
  - The three-mandate model this repository had been repeating (**Intent / Cart / Payment**) came
    from the launch announcement. v0.2 defines **two** mandates — Checkout (`mandate.checkout.1`) and
    Payment (`mandate.payment.1`) — each with **open** and **closed** states, carried as **SD-JWTs**
    (RFC 9901) with the schema version in the `vct` suffix.
  - This file said AP2 **is an A2A extension**. The v0.2 specification does not say that; it calls
    itself a security feature within a Commerce Protocol and places itself in an ecosystem that
    *includes* A2A and MCP. The claim is now marked unverified, and the A2A tie is located where it
    actually is — the samples under `code/samples/.../scenarios/a2a/...`.
- Issue #21's question — does AP2's mandate model subsume `cob.payment.request` and
  `cob.payment.receipt` — is answered in §8: **no**, because AP2 authorises and produces delegation
  evidence, while our messages are an invoice between two identified agents and a payee-signed claim
  of settlement; AP2's Payment Receipt is a verifier-signed statement about a mandate. The answer is
  marked provisional until x402 is read.
- **The uncomfortable finding, recorded in §3:** AP2 requires the merchant-signed Checkout JWT to use
  a non-deterministic signature scheme ("e.g., ECDSA") and explicitly rules out deterministic ones,
  naming **Ed25519** — which is the only signature scheme COB/1 has. "COB/1 as an AP2 profile" would
  force a decision about the identity layer; the notes say so instead of implying the move is cheap.
- §7.1 now reads "AP2 read, x402 not"; §3 keeps the x402 half behind an explicit *Not yet read*
  caveat; §9 has the dated entry D-2 requires.

**Gate results:** Gate 1 has nothing to check — the diff touches only `docs/a2a.md`, `JOURNAL.md`,
and `CHANGELOG.md`, no `.js`. Gate 2 **170 pass / 0 fail**; Gate 3 `examples/two-agents/run.js`
**19/19 expectations held**; Gate 4 runner tests **40/40 assertions passed**. As in the previous two
entries, Gate 2's written command (`node --test "packages/core/**/*.test.js"`) cannot run in this
sandbox because the default runner spawns a child per file and the pipe is denied (`spawn EPERM`);
it was run as `node --test --test-isolation=none`, the same files and assertions. CI runs the
unmodified command.

**Still broken / not done:**

- **x402 is still second-hand.** §3 says so explicitly now, with the specific claims that depend on
  that reading. Reading it and the A2A x402 extension is the rest of issue #21, which stays open.
- The Ed25519 conflict recorded above is a finding, not a fix. It is not yet an issue; §8 holds it.
- The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are still
  claims (T11), and issues #18/#19 from the 2026-10-01 pass remain open.
- **The A2A draft required by directive D-3 could not be saved.** This pass did touch A2A, so
  `pass.md` §8 applies and a draft is owed. The queue is
  `C:\Herve\projects\communityofbillions-maintenance\linkedin\queue`, which is outside this pass's
  file sandbox; the one-shot escalation needs an approval channel, and an unattended pass has none,
  so the write failed closed. The draft was written but could not be saved, and it is deliberately
  not reproduced here — the brief says these are personal posts and must not be committed. Opened as
  issue #26, with the three possible fixes, because it will recur on every A2A pass.
- **`git pull --rebase` fails in this pass sandbox** (`schannel: AcquireCredentialsHandle failed:
  SEC_E_NO_CREDENTIALS`), so the branch state was not confirmed against the remote; `git push` will
  likewise be left to the runner, as in earlier passes. The working tree was clean when the pass
  began and only the three files above are modified.

**Next:** finish issue #21 — read x402 and the A2A x402 extension, and replace the last second-hand
paragraph in §3. After that, §7.2 (compare `canonical.js` with A2A's Agent Card canonicalisation) is
the next A2A step and needs no network reading.

---

## 2026-10-01 — A bad `now` no longer skips the expiry check

**Attempted:** one increment, chosen by the priority order in the brief. The `good first issue`s in
the current phase (#12, #13, #14) each already have an open contributor PR (#15, #16, #17), so
picking one would have duplicated work in flight. The pass looked for a reproducible bug instead,
and found one in `verifyEnvelope`.

**Landed:**

- `verifyEnvelope` now rejects a `now` that is not a valid `Date` with a `ValidationError`
  (`COB_VALIDATION`). Before this change an unparseable instant made
  `created.getTime() > now.getTime() + clockSkewMs` and `expires.getTime() <= now.getTime()` both
  compare against `NaN`; every comparison with `NaN` is false, so *both* clock checks were skipped
  and an expired envelope verified as valid. This is reachable from the CLI:
  `cob verify --now <anything>` does `new Date(String(values.now))`, so a typo in `--now` was a
  silent verification downgrade rather than an error.
- Regression test in `packages/core/test/envelope.test.js` pins the throw and the `checkEnvelope`
  result (`valid: false`, `COB_VALIDATION`). It fails if the guard is removed: without it,
  `verifyEnvelope` returns the expired envelope instead of throwing.
- No spec edit: §4.3/§5 already require an expired envelope to be rejected, so the code was the
  thing out of agreement. `CHANGELOG.md` records the tightened input, per Gate 8.

**Gate results:** `node --check` clean on both changed files; `node --test` **170 pass / 0 fail**
(169 before, so the new test is counted); `examples/two-agents/run.js` 19/19. As in the previous
entry, the suite had to be run as `node --test --test-isolation=none`: the default runner spawns a
child per file and the pass sandbox denies that pipe (`spawn EPERM`). Same files and assertions; CI
runs the unmodified command, and the new test uses no child process.

**Still broken / not done:**

- **`verifyEnvelope`'s other time option is still unbounded.** `clockSkewMs` accepts any number, and
  `Infinity` or `NaN` disables the future check exactly the way a bad `now` disabled both. Spec §5
  says the skew **MUST NOT** exceed 5 minutes. Opened as issue #18 — deliberately not fixed here
  (one increment).
- **Payment time fields are not validated.** `validatePaymentRequest` accepts any string for
  `validUntil` and `validatePaymentReceipt` any string for `settledAt`, though spec §8.2/§8.3
  require RFC 3339 UTC instants. Opened as issue #19.
- **The mainnet lock left two documents inconsistent with the code.** `packages/core/README.md`'s
  "Design rules" still says "Mainnet requires an explicit policy opt-in", which the same file
  contradicts twenty lines earlier; `docs/security.md` T10 says an operator permits unbounded
  spending by setting `allowUnlimited: false`, but the flag is `true` when unlimited is allowed.
  Not fixed here; not yet an issue either, so this entry is the record.
- The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are
  still claims (T11).
- **`git push` still fails in this pass sandbox** (the credential helper's signal pipe is denied),
  so the commit is local and the runner pushes after the pass returns — same as the 2026-09-30
  entry.

**Next:** issues #18 and #19 are both small and adjacent to this pass; then the Phase 1 items —
the discovery document (#1) or the read-only reference registry (#2).

---

## 2026-09-30 — Lock the mainnet opt-in, name unlimited spending

**Attempted:** carry out operator directive D-1 (issue #7): make `allowMainnet: true` a refusal
rather than an opt-in, and add an `allowUnlimited` policy flag naming the absence of a spending
ceiling. The directive is the pass, so nothing else was attempted.

**Landed:**

- `normalizePolicy({ allowMainnet: true })` throws `PolicyError` whose message says the refusal is
  deliberate, names issue #7, and carries `{ allowMainnet: true, issue: 7 }` in `details`. The mainnet
  chains stay in `CHAIN_REGISTRY` and the field stays readable.
- The mainnet check that used to sit inline in `assertChainAllowed` is now `assertMainnetAllowed`,
  exported and covered by a test on both sides (mainnet refused with `allowMainnet: false`, allowed
  with `true`). This is the option the directive offered — expose the check — and not a bypass:
  `assertChainAllowed` still normalises the policy first, so the opt-in cannot be reached through
  the payment path.
- `DEFAULT_POLICY.allowUnlimited` is `true`; `normalizePolicy` validates it as a boolean and carries
  it through. No behaviour changed: an empty `maxAmount` still means no ceiling.
- `spec/COB-1.md` §9 documents the lock, adds `allowUnlimited`, and has a change-log row.
- `docs/security.md` T10 no longer *proposes* a fix; T9 notes the opt-in refusal.
  `docs/architecture.md`, `docs/glossary.md`, and `packages/core/README.md` were showing
  `allowMainnet: true` as the way to open mainnet and now describe the lock.
- CI's mainnet job now asserts that `allowMainnet: true` is refused, and the ceiling job runs on
  `base-sepolia` so it tests the ceiling instead of being short-circuited by the mainnet refusal.
- Tests: `policy.test.js` pins the refusal and its wording, the default `allowUnlimited`, the
  boolean validation, and both sides of `assertMainnetAllowed`; `payments.test.js` asserts a mainnet
  request is refused even when the policy asks for the opt-in.

**Gate results:** syntax check clean; `node --test` 169 pass / 0 fail; `examples/two-agents/run.js`
19/19 expectations; runner tests 40/40. The suite had to be invoked as
`node --test --test-isolation=none` in this environment: the default runner spawns a child per test
file and the pass sandbox denies that pipe (`spawn EPERM`). It is the same test files and the same
assertions; CI runs the unmodified command. Noted because CHECKS.md says the gates must be run for
real, and the invocation differed from the one written there.

**Still broken / not done:**

- `allowUnlimited` is validated and carried, but nothing reads it yet. That is what the directive
  asked for: it is a name for a decision that only matters when mainnet opens, and T10 says so.
- Mainnet remains unreachable by configuration, as intended. There is no way to open it short of an
  operator changing `normalizePolicy` in a visible commit.
- The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are
  still claims (T11).
- **The agent's own `git push` failed in this pass environment.** git runs its credential helper
  through the MSYS `sh`, which cannot create its signal pipe under the pass sandbox
  (`fatal error - couldn't create signal pipe, Win32 error 5`), so git fell back to asking for a
  username it does not have. The commits are local; the runner that started this pass pushes after
  it returns (`tools/schedule/run-pass.ps1`). Issue #7 is closed against `3e5db76` on that basis.

**Next:** the Phase 1 items — the `/.well-known/cob.json` discovery document (issue #1) or the
read-only reference registry (issue #2).

---

## 2026-09-28 — Bootstrap

**Attempted:** stand up the repository with enough real substance to be worth a stranger's attention.

**Landed:**

- Public repository `withinaz/communityofbillions` with a description and topics.
- `COB/1` draft specification (`spec/COB-1.md`) covering identity, envelope, and payment messages.
- Reference implementation in `packages/core/` — plain ESM, **zero runtime dependencies**:
  - Ed25519 identity (`cob:agent:<base64url(pubkey)>`) with JWK-based key import/export
  - Canonical JSON serialisation and envelope signing/verification
  - Payment request / receipt messages and a payment state machine
  - Chain and asset policy with mainnet disabled by default
- CLI (`packages/core/bin/cob.js`): `keygen`, `id`, `sign`, `verify`, `request`, `inspect`.
- Test suite run with the Node built-in runner.
- CI workflow, issue templates, contribution guide, code of conduct, security policy, roadmap.

**Still broken / not done:**

- No registry, no transport binding — two agents cannot actually reach each other yet.
- No on-chain settlement. `packages/core/src/payments.js` models the messages, not the transaction.
- Replay protection is a field on the envelope (`nonce`), not yet a cache that enforces it.
- `docs/` is thin.

**Next:** Phase 1 — discovery document and a read-only reference registry.
