# Journal

A public, append-only record of what changed in this repository and **why**.

Rules for this file:

- Newest entries at the top.
- Every entry says what was *attempted*, what actually landed, and what is still broken.
- Failed attempts and corrections stay in the record. An honest history is more useful than a clean one.
- No entry claims something works unless a test in `packages/core/test/` covers it.

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
