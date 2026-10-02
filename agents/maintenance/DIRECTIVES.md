# Operator directives

Directives from the human operator of this repository.

A directive here **outranks** the roadmap ordering, the issue priority, and the "choose one
increment" rules in [`pass.md`](pass.md) for the pass it names.

## Rules

- A directive names the pass it applies to, **by date**.
- In that pass it is the increment. Do the directive, and nothing else, unless the directive
  says otherwise.
- When it is carried out, fill in `**Done in:** <short sha>` underneath it. **Do not delete it.**
  The record of what was asked is as valuable as the record of what was done.
- A directive that cannot be carried out goes back to the operator as an issue, and this file
  says so.
- **Adding, editing, or reinterpreting a directive is an operator action.** The maintenance
  agent must not do any of the three. If a directive seems wrong, open an issue about it and
  stop — do not act on the reinterpretation.

---

## D-1 · pass of 2026-09-30 · Issue #7 — lock mainnet, name unlimited spending

**Decided by the operator on 2026-09-28.** This is the answer to issue #7 and it supersedes the
recommendation written in that issue.

### What was decided

1. **Mainnet is locked.** `allowMainnet: true` must be **refused**, not honoured. The field stays
   in the policy object — keep it readable and documented — but setting it to `true` throws.
   Do **not** delete the field, and do **not** remove the mainnet entries from the chain
   registry. The point is that the *opt-in* is disabled, not that mainnet has been erased from
   the protocol.
2. **`allowUnlimited` is added, defaulting to `true`.** It names the absence of a spending
   ceiling. Today's behaviour is preserved exactly: no `maxAmount` still means no ceiling, on
   any chain the policy allows.

### Why

Mainnet must be unreachable by construction, for now, because the protocol is unaudited and a
receipt is still a *claim* rather than verified evidence ([`docs/security.md`](../../docs/security.md),
threat T11). The `allowUnlimited` flag exists so that when mainnet is eventually unlocked, the
configuration that permits unbounded spending can require a visible act. It defaults to `true`
today because with mainnet locked, "unlimited" can only ever mean testnet play money.

### Exactly what to change

**`packages/core/src/policy.js`**

- `DEFAULT_POLICY` gains `allowUnlimited: true`.
- `normalizePolicy` validates `allowUnlimited` (must be a boolean) and rejects anything else with
  a `ValidationError`.
- `normalizePolicy` throws a `PolicyError` when `allowMainnet === true`. The message must say
  that mainnet is deliberately unavailable in this version and must reference issue #7. It must
  read as a deliberate refusal, never as a bug.
- Keep the existing mainnet branch in `assertChainAllowed`. It is now unreachable through
  `normalizePolicy`, and it is still the check that will run the day mainnet is unlocked, so it
  must stay **and stay tested**. Resolve this cleanly — expose the check so it remains testable,
  or add a clearly named internal option — rather than deleting a security check because it
  became unreachable.

**`spec/COB-1.md` §9**

- `allowMainnet`: document that it **MUST** be `false` in this version and that a producer
  **MUST** refuse `true`.
- Add `allowUnlimited` to the policy table, default `true`.
- Add a row to the change-log table.

**`docs/security.md`**

- Threat T10 currently *proposes* a fix. It is now decided and shipped: rewrite T10 to describe
  the mitigation as implemented.
- Threat T11 (receipt forgery) stays as it is. It is still the largest open risk.

**`CHANGELOG.md`**

- Entries under `## [Unreleased]` for both changes.
- `allowMainnet: true` now throwing is a **breaking change** for any caller that was opening
  mainnet. Say so plainly; do not bury it.

### Tests that must exist

- `normalizePolicy({ allowMainnet: true })` throws `PolicyError`, and the message mentions
  issue #7.
- `DEFAULT_POLICY.allowUnlimited === true`.
- `normalizePolicy({ allowUnlimited: 'yes' })` throws `ValidationError`.
- The mainnet branch that remains in `assertChainAllowed` is still covered by a test.
- `examples/two-agents/run.js` still passes. Its expectation *"a mainnet invoice is refused by
  the default policy"* must keep holding; only the *reason* for the refusal may change. If the
  example asserts on the specific error, update it and say so in `JOURNAL.md`.

### Do not

- Do not unlock mainnet in any form.
- Do not change `maxAmount` semantics.
- Do not add a bypass for the lock. No environment variable, no option, no "internal" flag,
  no test-only escape that ships in the public surface.
- Do not amend this directive, even to make it easier to implement.

### Done in

**Done in:** 3e5db76

---

## D-2 · from the pass of 2026-10-06 onwards · Work the A2A track

**Standing directive.** Not a single pass; it applies to every pass from the date below until the
operator says otherwise.

### What was decided

The operator asked, on 2026-10-01, that the project engage with **A2A**, the Agent2Agent protocol —
<https://a2a-protocol.org/latest/> — by adding development notes about it, and by developing the code
in that direction.

### What this means for a pass

1. **The increment comes from the A2A track**, whenever there is a reasonable one available. The
   track is laid out in [`docs/a2a.md`](../../docs/a2a.md) §7, in rough dependency order.
2. **Append a dated entry to §9 of `docs/a2a.md`**, whatever the pass did. Say what was read, what
   was decided, and what changed — or say plainly that nothing changed and why. The newest entry
   goes last.
3. **Reading counts as an increment** when it is the honest next step. A pass that reads the AP2
   specification and writes down what it found has done real work; a pass that skips the reading and
   writes plausible-sounding prose about it has not.
4. **A real bug or a failing gate still takes priority.** Fix it, record it, and say in the A2A note
   that this pass was spent elsewhere.

### Rules that do not bend

- **Do not invent what the other protocols say.** `docs/a2a.md` marks clearly what has been read
  first-hand and what comes from second-hand sources. Keep that discipline. If a claim about AP2 or
  x402 has not been verified against their own specification, say so in the note.
- **Do not let the notes become marketing.** §4 of `docs/a2a.md` records that COB/1 overlaps almost
  entirely with A2A + AP2 + x402. That is uncomfortable and it stays. A pass that quietly softens it
  has failed, no matter how good the diff looks.
- **Do not rewrite the repository in one pass.** Option B in §6 (compose with A2A rather than compete)
  is a year of increments, and the brief's rule about one small increment per pass applies here more
  than anywhere.
- **Do not amend this directive.**

### Done in

*(not a single pass — this one runs until the operator ends it)*

---

## D-3 · from the pass of 2026-10-06 onwards · Draft a public summary when a pass touches A2A

**Standing directive.** Applies to every pass, alongside `D-2`.

### What was decided

The operator asked, on 2026-10-02: after each pass, write an English summary of what was developed
on the A2A protocol, 20 lines maximum, with a graphic if one helps — **and write nothing at all when
the pass did not concern A2A.**

### Where it is implemented

[`pass.md`](pass.md) §8, which is the brief every pass already reads. This directive exists so that
the instruction is traceable to the operator rather than appearing to be something the maintenance
agent decided for itself.

### The rule that matters most

**A pass that did not touch A2A writes nothing.** Not a short post, not a note explaining the
silence. The operator reads every draft; a feed that announces it has nothing to say is worse than a
quiet one, and a draft written to satisfy a rule is the same failure as a commit written to fill a
graph.

### What the drafts are and are not

- They are **drafts**, in a directory outside the repository. Never committed.
- They are **never published by an agent.** No API call, no browser automation, no credential. The
  operator copies and pastes, and reads every word first.
- They are written **in English**, for an audience that already knows what A2A, AP2 and x402 are.
- They may be **uncomfortable**. A draft that only flatters the project has failed.

### Done in

*(not a single pass — this one runs until the operator ends it)*

