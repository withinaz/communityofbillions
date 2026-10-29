# Journal

A public, append-only record of what changed in this repository and **why**.

Rules for this file:

- Newest entries at the top.
- Every entry says what was *attempted*, what actually landed, and what is still broken.
- Failed attempts and corrections stay in the record. An honest history is more useful than a clean one.
- No entry claims something works unless a test in `packages/core/test/` covers it.

---

## 2026-10-29 — `cob.a2a` drafted: the envelope moves into A2A metadata

**Attempted:** issue #23, the next A2A step in `docs/a2a.md` §7 and the increment the last entry
named. No dated directive names this pass, and there was no reproducible bug to take ahead of it:
#26 is the runner/sandbox decision it already says it is, and #28 is a settlement-rail proposal, not
something a maintenance pass should decide. The brief prefers the A2A track when there is a
reasonable next step, and #23 was exactly that.

**Read:** A2A's extensions documentation — declaration, `required`, activation, versioning, the
`A2A-Extensions` header — and `a2aproject/A2A` `main`'s `specification/a2a.proto` for the fields the
draft relies on: `AgentExtension`, `Message.metadata`, `Message.extensions`, and the metadata maps on
`Task`, `TaskStatusUpdateEvent` and `Artifact`. These were read first-hand this pass; the notes in
`docs/a2a.md` are cited where they, not this pass, did the reading.

**Landed:**

- `spec/COB-A2A.md` — a draft of the extension, written normatively but explicitly not stable. It
  fixes the URI `…/a2a/cob/v1`, a `required: false` declaration whose `params.agent` is the COB
  identity the endpoint speaks for, `Message.metadata["cob.envelope"]` as the envelope **object**,
  the requirement that `Message.extensions` list the URI, activation through `A2A-Extensions` with an
  echo rule the client must check, and a `cob.payment.status` substate that is an annotation only.
  It adds no A2A task state and no enum value.
- `docs/a2a.md` §7.3 is marked drafted and §9 gains this pass's dated entry. `CHANGELOG.md` records
  the new file. `ROADMAP.md` moves #23 from 🗓 to 🚧 — not ✅, because there is still no
  implementation and no test.
- Issue #29 opened for the adapter and its tests, so closing #23 does not lose the next step.

**Gate results:** Gate 1 had nothing to check — no `.js` file changed. Gate 2 as written,
`node --test "packages/core/**/*.test.js"`, still fails in this sandbox with `spawn EPERM`; the same
files and assertions were run as `node --test --test-isolation=none "packages/core/test/*.test.js"`,
**187 pass / 0 fail**. Gate 3 `examples/two-agents/run.js` **19/19 expectations held**.

**Still broken / not done:**

- The draft has no implementation and no conformance vector. Until #29 lands, it is prose, and prose
  is not a protocol. The three rules most likely to move when code arrives are the `to` check, the
  `Message.extensions` requirement, and the echo rule.
- #24 (Agent Card discovery) and #25 (x402) are untouched. #26 (the sandbox cannot write the drafts
  queue) remains open and is still not a pass decision. #28 (a Nano settle rail) is a real proposal
  and was not answered this pass; it needs a design decision, not an implementation.
- The extension URI is an identifier that does not resolve to a document. The draft says so plainly;
  hosting it is a future pass and not a claim being made now.
- `git pull --rebase` and `git push` still fail in this sandbox (`schannel:
  SEC_E_NO_CREDENTIALS`); the commit is local and the runner must push it. `git status` was clean at
  the start and `HEAD` was `ef43b91`. Issue #23 is closed with a comment naming this commit; the
  reference only resolves once the runner's push lands.

**Next:** #29 — implement the declaration and metadata adapter in `packages/core`, with tests for
the `to` check, the `Message.extensions` requirement, and the echo rule. If a reproducible bug
arrives first, it still wins.

---

## 2026-10-27 — an invoice deadline that any string could satisfy

**Attempted:** issue #19, which the previous entry named as the next increment and which the brief's
priority order puts ahead of the A2A track because it is a reproducible bug. Reading the two
validators confirmed the gap: `validatePaymentRequest` passed `validUntil` through untouched and
`validatePaymentReceipt` only length-checked `settledAt`. That was then reproduced against the
pre-fix source after writing the tests: the two new refusal tests fail there (48 pass / 2 fail),
which is the reproduction the issue asked for. The problem is not the producers —
`createPaymentRequestBody` and `createPaymentReceiptBody` always compute well-formed instants — but
the validators, which are exactly what a receiver calls on a message it did not produce.

**Landed:**

- `packages/core/src/payments.js` now calls the existing `assertInstant` on `validUntil` and on
  `settledAt`. The functions were already in `envelope.js` and exported from `index.js`; this is a
  reuse, not a new validator. `validUntil` remains returned exactly as sent — it is part of the
  signed body, so validation must not rewrite it — and the spec's optional milliseconds still work.
- Three tests in `packages/core/test/payments.test.js`. The two refusal tests fail against the old
  code: an explicit `validUntil` or `settledAt` in one of four bad shapes (`not-a-date`, a date with
  no time, a non-UTC offset, and a shape-valid but non-existent date) must be refused with
  `COB_VALIDATION`. The third pins the accepted form — an explicit `validUntil` with no milliseconds
  is accepted and returned unchanged — so the fix cannot over-tighten the spec's optional precision.
  The core suite goes from 184 to **187 pass / 0 fail**.
- `CHANGELOG.md` records the tightening under `Fixed`. No specification edit was needed: §8.2 and
  §8.3 already said **MUST** be RFC 3339 UTC instants, so the code was the side that disagreed.

**Gate results:** Gate 1 `node --check` passed for `payments.js` and `payments.test.js`. Gate 2 as
written, `node --test "packages/core/**/*.test.js"`, still fails in this sandbox with `spawn EPERM`
— the runner spawns a child per file and the pipe is denied. It was run as
`node --test --test-isolation=none`, the same files and assertions: **187 pass / 0 fail**. Gate 3
`examples/two-agents/run.js` **19/19 expectations held**; the mainnet refusal now reports
`allowMainnet=false`, which is the policy lock from #7, not this change.

**Still broken / not done:**

- `validUntil` is now a real instant but is not checked against `now`. An invoice dated in the past
  still validates. The spec does not require an ordering check and #19 did not ask for one; if it
  should exist, that is a separate issue and a separate increment.
- Issue #23 (`cob.a2a`) remains open and unstarted. Issue #26 (the pass sandbox cannot write the
  LinkedIn drafts queue) remains open; this pass did not touch A2A, so it produced no draft.
- `git pull --rebase` and `git push` still fail in this sandbox (`schannel:
  SEC_E_NO_CREDENTIALS`); the commit is local and the runner must push it. `git status` was clean at
  the start and `HEAD` was `7d7608d`. Issue #19 was closed with a comment naming this commit; the
  reference only resolves once the runner's push lands.
- The project board needs an explicit `--owner` when not running interactively; `gh project
  item-list` without it fails with `owner is required`. Once supplied, item #19 was already in
  `Done` after the issue was closed, so no move was needed.

**Next:** #23 — draft `cob.a2a` as the A2A extension, starting from what `docs/a2a.md` has already
recorded rather than re-deriving the design. If a dated directive or a new reproducible bug arrives
first, that wins.

---

## 2026-10-22 — a verifier option that could switch off the future check

**Attempted:** at first, the wrong thing. No dated directive names this pass, so I read the priority
order and the last entry, which named `cob.a2a` (#23) as the next step. I wrote a 400-line draft of
the extension — `Message.metadata`, `params.agent`, activation through `A2A-Extensions` — and
updated `docs/a2a.md`, `README.md` and `CHANGELOG.md` for it. Then I re-read §2 before committing
and found issue #18: an open, reproducible verifier bypass. The brief puts a reproducible bug ahead
of the A2A track, and D-2 says a real bug still takes priority. The draft was reverted — the new file
removed, the three edited files restored — and the pass fixed #18 instead. The mistake was taking
the previous entry's "Next" line as the plan without checking the open bug list against the priority
order.

**What was wrong:** `verifyEnvelope` destructured `clockSkewMs` and used it raw in
`created > now + clockSkewMs`. For `Infinity` and `NaN` that comparison is false for every
`created`, so the future-created check never fired and an envelope dated arbitrarily far ahead
verified. A huge finite value did the same in practice, and a negative value or a numeric string
changed the comparison in ways the caller did not ask for. The specification already caps the skew
allowance at five minutes; the code did not enforce the cap.

**Landed:**

- `packages/core/src/envelope.js` exports `MAX_CLOCK_SKEW_MS = 300_000` and `verifyEnvelope` now
  refuses a `clockSkewMs` that is not a finite number in `[0, MAX_CLOCK_SKEW_MS]` with
  `COB_VALIDATION`. The guard runs before the envelope is examined, next to the existing invalid-`now`
  guard, because both are options that can silently disable a clock check.
- `packages/core/src/index.js` exports the constant, so a caller can name the bound rather than copy
  the literal.
- Three new tests in `packages/core/test/envelope.test.js`: the invalid values (`Infinity`,
  `-Infinity`, `NaN`, `-1`, `MAX + 1`, `'30000'`) are each refused with the expected message and
  `checkEnvelope` reports `COB_VALIDATION`; `0` and `MAX` are accepted; an envelope six minutes in
  the future is still rejected at the maximum skew. The core suite goes from 181 to **184 pass / 0
  fail**.
- `CHANGELOG.md` records the tightening as a fixed input.

**Gate results:** Gate 1 `node --check` passed for `envelope.js`, `index.js` and
`envelope.test.js`. Gate 2 as written, `node --test "packages/core/**/*.test.js"`, still fails in
this sandbox with `spawn EPERM` — the runner spawns a child per file and the pipe is denied. It was
run as `node --test --test-isolation=none`, the same files and assertions: **184 pass / 0 fail**.
Gate 3 `examples/two-agents/run.js` **19/19 expectations held**.

**Still broken / not done:**

- Issue #19 is the same class and remains open: `validatePaymentRequest` accepts any string as
  `validUntil`, and `validatePaymentReceipt` accepts any string as `settledAt`. `assertInstant`
  already exists and is not used at either point.
- The A2A draft is **not** in the repository. #23 remains open and unstarted; the draft was reverted
  rather than landed as a second increment. A future pass must write it again. `docs/a2a.md` §9
  records the reverted attempt and why; `README.md` is unchanged.
- `git pull --rebase` still fails in this sandbox (`schannel: SEC_E_NO_CREDENTIALS`), and so does
  `git push` with the same error. The commit is local; the runner must push it. `git status` was
  clean at the start and `HEAD` was `3023196`.
- PR #17 and PR #15 remain open and unreviewed. #18 was not blocked on either.

**Next:** #19 — validate `validUntil` and `settledAt` with `assertInstant` and add the two tests.
After that, #23.

---

## 2026-10-20 — the pass was failing on a credential it was never given

**Attempted:** find out why the 08:40 pass stopped after 47 seconds with
`MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`, when the
key had been stored from the web Models page weeks earlier and every pass since September had
worked.

**What was wrong:** `dsh headless` is not the interactive app. Its bundle disables the harness
credentials plugin on purpose — *"one-shot jobs use launch-time credentials instead of the
interactive store"* — so the scheduled pass only ever sees what is already in its own environment.
The stored document was never consulted, and nothing in the runner was putting the key into that
environment. The `dsh` install had also been upgraded from `0.1.7-rc.2` to `0.2.1-rc.2`, which is
when the passes stopped working, but the version was a coincidence: the headless design is the
cause, and it would have bitten on any fresh install.

**Landed:**

- `tools/schedule/run-pass.ps1` reads `DEEPSEEK_API_KEY` out of `$DSH_HOME/.credentials.yaml` and
  sets it in its own process before invoking the agent, for the maintenance pass and the comment
  responder alike. An already-exported value wins and the log says which source was used. A key
  that exists in neither place warns and continues, so the pass still runs the gates and writes a
  verdict instead of collapsing before the first line of work.
- The document layout is fixed and tiny, so it is read directly rather than with a YAML parser: the
  runner has to keep working for a year with no dependencies at all. 17 new assertions cover the
  reader and the injection, including a strict-mode null-property trap that the first draft walked
  into and the tests caught before it shipped.
- `agents/maintenance/README.md` gains a **Credentials** section, because "the key is stored, why
  is the pass asking for one?" is exactly the question the next person will have.
- A second, smaller bug fell out of reading the log of the verification run: the pass summary
  printed the *post*-agent head as `head before`, so a pass that committed anything reported the
  same value twice and could not be used to tell what it had done. It now prints the real
  pre-agent head.

**Verified:** `dsh headless` answers with the lifted key, and a full pass at 08:55 landed
`febc9fa` (*core: add amount round-trip property tests*) and pushed it. The 08:40 failure line
stays in the operator's `result.txt` above the 08:55 success; the log is not rewritten.

**Still broken / not done:**

- The agent cannot push from inside its own sandbox (`cannot create standard input pipe for
  remote-https`), so every pass depends on the runner's push afterwards. If that push fails, the
  work stays local while the verdict still says `ok`. The verdict is about the pass, not about the
  remote.
- The runner's credential reading covers `NAME: value` lines only. A future credentials document
  that stores values in flow style or with block scalars would read as absent — the pass would warn
  and fail exactly as it did this morning, which is at least the honest failure.

---

## 2026-10-20 — amount round-tripping is a property, not six examples

**Attempted:** one increment, chosen by the priority order in the brief. No dated directive names
this pass. Three issues were already in progress with open pull requests; #13 (`good first issue`,
`area:core`) had PR #16 open since 2026-09-29, narrowly scoped to the missing property test. This
pass reviewed that PR rather than writing a duplicate: an open issue is a promise, and #13 was the
smallest real item in the board's Phase 1 column. The A2A draft (#23) was the other candidate and
remains the next step.

**Landed:**

- `packages/core/test/amount.test.js` gains a generated round-trip test for
  `parseAmountToBaseUnits` / `formatBaseUnits`. It uses the fixed seed `0xC0B10001`, starts with
  explicit `decimals = 0` cases (`"0"`, `"1"`, `"42"`), covers every decimal count from 0 to 18,
  then adds 500 generated valid amounts. Each case must parse without throwing, and the formatted
  result must compare equal by value to the original amount. A seeded LCG and amount generator are
  local to the test; no dependency was added.
- The core suite goes from 180 to **181 pass / 0 fail**. No production code changed. The test is
  PR #16 by Polly Labs, landed with the contributor's authorship preserved in the commit trailer.
- Issue #13 closes and its board item moves to Done. No `CHANGELOG.md` entry (tests only) and no
  `ROADMAP.md` line moves (no roadmap item was waiting on this).
- A2A was not touched this pass: no entry is added to `docs/a2a.md` §9, and no draft is owed.

**Gate results:** Gate 1 `node --check packages/core/test/amount.test.js` passed. Gate 2 **181 pass
/ 0 fail** — but, as in the previous six entries, not as written: `node --test
"packages/core/**/*.test.js"` fails in this sandbox because the default runner spawns a child per
file and the pipe is denied (`spawn EPERM`). It was run as `node --test --test-isolation=none`, the
same files and assertions. CI runs the unmodified command. Gate 3 `examples/two-agents/run.js`
**19/19 expectations held**.

**Still broken / not done:**

- The new test is one fixed seed and 500 generated cases, not an exhaustive proof. It covers the
  positive round-trip only: it does not exercise `formatBaseUnits` with negative base units, nor
  `decimals > 18`, and it cannot prove the generator reached every precision edge. The explicit
  `decimals = 0` cases and the seed in every failure message are what make a failure reproducible.
- **PR #17 remains open and unreviewed.** It contains the `cob keygen --force` guard for #14, but
  also unrelated CLI output and comment removals, so it is not landable as one increment. PR #15
  (the settlement-handshake diagram for #12) also remains open and unreviewed. Neither was touched
  here.
- `git pull --rebase` and `git push` need git helper pipes that this sandbox denies, so the branch
  was not re-fetched or pushed by this pass. `git status` was clean and `HEAD` equalled
  `origin/main` when checked at the start. If the runner does not push, the issue comment naming
  this commit refers to a local commit only.
- The A2A steps after the canonicalisation work are still unstarted: `cob.a2a` (#23), the Agent Card
  decision (#24) and the x402 decision (#25), with compose-or-compete (#20) still the operator's
  call. The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts
  are still claims (T11), and issues #18/#19 remain open.

**Next:** §7.3 / issue #23 — draft `cob.a2a` as an A2A extension (URI, `AgentExtension` declaration,
where COB/1 data lives in `metadata`, what activation means). If PR hygiene comes first, split the
unrelated churn out of PR #17 and land only the keygen guard for #14.

---

## 2026-10-15 — the RFC 8785 reference corpus now runs against canonicalize

**Attempted:** one increment, chosen by the priority order in the brief. No dated directive names
this pass, so D-2's preference applies: the A2A track. Issue #27 (`good first issue`, `area:core`) is
the follow-up the 2026-10-13 pass opened when it compared `canonical.js` with A2A's Agent Card
signing rule: §5 of `docs/a2a.md` and `canonical.js` both claim a match with RFC 8785, but every
test behind that claim was written from our own reading of the RFC. This pass ran the RFC's own
vectors. Nothing else was attempted.

**Landed:**

- The six input/output vector pairs from the `testdata` directory of
  `cyberphone/json-canonicalization` (the RFC 8785 reference implementation), commit
  `32a48195b9b20fe67b1795e39e4509f14d860b45`, are vendored verbatim under
  `packages/core/test/vectors/rfc8785/`, with provenance and the Apache-2.0 notice in that
  directory's README. The seven `hex-ieee,expected` sample lines from the upstream
  `testdata/README.md` are vendored alongside them as `es6-samples.txt`.
- `packages/core/test/rfc8785.test.js` parses each input as JSON text and asserts that
  `canonicalize` reproduces the expected output byte-for-byte, and drives the seven number samples
  through the same assertion. The core suite goes from 173 to **180 pass / 0 fail**, seven new
  tests.
- `docs/a2a.md` §5 gains a short "checked against the RFC's own corpus" paragraph and §9 gains the
  dated entry D-2 requires. §7.2 stays done. No production code changed: this pass checked a claim
  rather than altering behaviour, which is what issue #27 asked for.
- Issue #27 is resolved by this pass. No roadmap item moves: no roadmap line was waiting on this,
  and the brief's rule is that ✅ needs a covering test, not that a new test needs to move a line.

**What the vectors found:** all thirteen pass — nothing in `canonical.js` changed and nothing
needed to. The claim "we match RFC 8785" now rests on the corpus that defines the RFC rather than
only on tests written from our reading of it. Two limits are stated in the test and in §5 rather
than left implicit:

1. The corpus is JSON text and `canonicalize` takes a value, so `JSON.parse` sits in the middle.
   None of the six inputs depends on anything it cannot carry (no integer past 2^53, no duplicate
   key), so the expected bytes describe the whole document — but a future vector could.
2. The full ES6 number corpus is a 100-million-line download and is **not** vendored. The number
   axis is sampled by the seven documented examples rather than proved over the generator's whole
   output; those samples do reach `-0` (bit pattern `8000000000000000`) and the 2^53 boundary.

**Gate results:** Gate 1 `node --check packages/core/test/rfc8785.test.js` passed. Gate 2
**180 pass / 0 fail** — but, as in the last five entries, not as written:
`node --test "packages/core/**/*.test.js"` fails in this sandbox because the default runner spawns a
child per file and the pipe is denied (`spawn EPERM`). It was run as
`node --test --test-isolation=none`, the same files and assertions. CI runs the unmodified command.
Gate 3 `examples/two-agents/run.js` **19/19 expectations held**. No `.js` under `src/` changed, so
the zero-dependency rule is not in play.

**Still broken / not done:**

- **The A2A draft required by D-3 could not be saved.** This pass touched A2A, so a draft is owed.
  The write to `C:\Herve\projects\communityofbillions-maintenance\linkedin\queue\2026-10-15-rfc8785-vectors.md`
  was attempted and refused (`[sandbox: file access denied under workspace-write mode]`); the
  one-shot escalation needs an approval channel and an unattended pass has none, so it fails closed.
  As on the previous three A2A passes, the draft is deliberately not reproduced in the repository.
  Issue #26 records the fix and this pass adds nothing to it.
- **The number corpus is sampled, not proved.** A bounded local subset would mean reimplementing
  `numgen.js` (or vendoring a slice of the release download); that is a pass of its own, and it is
  not opened as an issue because #27 named the corpus and this pass closed the part of it that is
  practical. The limit is written into `docs/a2a.md` §5 and the vectors README.
- **`git pull --rebase` still fails in this sandbox** (`schannel: AcquireCredentialsHandle failed:
  SEC_E_NO_CREDENTIALS`), so the branch was not confirmed against the remote. `git status --short`
  was empty when the pass began. `git push` is left to the runner, as in earlier passes; if the
  runner does not push, issue #27's close comment names a commit that is only local.
- The steps after this one are still not ours to take: `cob.a2a` (#23), the Agent Card decision
  (#24) and the x402 decision (#25) are unstarted, and compose-or-compete (#20) is the operator's
  call. The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are
  still claims (T11), and issues #18/#19 remain open.

**Next:** §7.3 / issue #23 — draft `cob.a2a` as an A2A extension (URI, `AgentExtension` declaration,
where COB/1 data lives in `metadata`, what activation means). It is the next step in dependency order
and the 2026-10-13 and 2026-10-15 findings both feed it: the field-presence step belongs to whatever
builds the ProtoJSON view, not to `canonicalize`.

---

## 2026-10-13 — canonical.js checked against A2A's Agent Card signing requirement

**Attempted:** one increment, chosen by the priority order in the brief. No dated directive names
this pass, so D-2's preference applies: the A2A track. The last entry's `Next` named §7.2 / issue
#22 — compare `canonical.js` with A2A's Agent Card canonicalisation requirement — and that is what
this pass did. A2A's specification §8.4.1–8.4.3 was read first-hand and our canonicaliser checked
against it. Nothing else was attempted.

**Landed:**

- `docs/a2a.md` §5 gains "The A2A §8.4.1 comparison". It records what the section actually requires
  (RFC 8785, plus Protocol Buffer field-presence preprocessing, plus exclusion of `signatures`), and
  what we match: the three RFC 8785 rules A2A's own summary omits — literal UTF-8 strings, UTF-16
  code-unit key ordering, ECMAScript number serialisation.
- `packages/core/test/canonical.test.js` gains a second `describe` block with three tests: the
  §8.4.1 worked example reproduced byte-for-byte, surrogate-pair key ordering (the axis a code-point
  sort gets wrong), and `0.000001` / `1e+21` number serialisation. The suite goes from 170 to 173
  passing tests. No production code changed.
- §7.2 is marked done; §9 has the dated entry D-2 requires; issue #22 closes with this pass, and the
  roadmap item moves to ✅ because a test now covers it.

**What the comparison found, stated plainly:** we match the canonicalisation half of §8.4.1. The
other half is not canonicalisation at all — rule 1 is protobuf field presence, and canonicalising
the section's "Original Agent Card" directly emits `"extensions":[]`, which is not the payload the
specification signs. A `cob.a2a` extension (#23) therefore cannot be "sign the card with
`canonicalize`": the field-presence step belongs to whatever builds the ProtoJSON view. That is a
finding about composition, not a defect in `canonical.js`.

- **The uncomfortable finding, recorded in §5 rather than smoothed over:** A2A's §8.4.1 is
  under-determined in its own tracker. [a2aproject/A2A#2122](https://github.com/a2aproject/A2A/issues/2122)
  reports two first-party SDKs producing different bytes for the same card and neither reproducing
  the section's example, because rule 1 asks for output the normative ProtoJSON serializer cannot
  express. This pass read that report (through `gh api`) but did **not** independently reproduce it,
  and says so. What it did verify is that the worked example on `main` today is not the one the
  issue quotes. The pinned vector is the one read on 2026-10-13.

**Gate results:** Gate 1 `node --check packages/core/test/canonical.test.js` passed. Gate 2
**173 pass / 0 fail** — but, as in the last three entries, not as written: `node --test
"packages/core/**/*.test.js"` fails in this sandbox because the default runner spawns a child per
file and the pipe is denied (`spawn EPERM`). It was run as `node --test --test-isolation=none`, the
same files and assertions. CI runs the unmodified command. Gate 3 `examples/two-agents/run.js`
**19/19 expectations held**.

**Still broken / not done:**

- **The A2A draft required by D-3 could not be saved**, for the same reason as the last two passes:
  the queue is outside this pass's file sandbox (`[sandbox: file access denied under workspace-write
  mode]`). This pass touched A2A, so a draft is owed; the write was attempted and refused, and the
  draft is deliberately not reproduced in the repository. Issue #26 already records the fix and this
  pass adds nothing to it.
- **`git pull --rebase` still fails in this sandbox** (`schannel: AcquireCredentialsHandle failed:
  SEC_E_NO_CREDENTIALS`), so the branch was not confirmed against the remote. `git status --short`
  was empty when the pass began. `git push` is left to the runner, as in earlier passes.
- The comparison surfaced one real test gap: nothing runs RFC 8785's own reference vectors against
  `canonical.js`, so the evidence for "we match JCS" is our own tests plus one borrowed example.
  That is issue #27, opened this pass and deliberately not fixed in it.
- The steps after this one are still not ours to take: `cob.a2a` (#23), the Agent Card decision
  (#24) and the x402 decision (#25) are unstarted, and compose-or-compete (#20) is the operator's
  call. The pre-existing gaps are unchanged: no registry, no transport, no nonce cache, receipts are
  still claims (T11), and issues #18/#19 remain open.

**Next:** run the RFC 8785 reference vectors against `canonical.js` (issue #27) — small, and it
turns "we match the RFC" from an argument into evidence. After that, §7.3 / issue #23.

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
