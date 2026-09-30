# The maintenance agent

This project is kept alive by an automated agent that performs small, real increments on a regular
cadence, in public, with an honest record of what it did and what it got wrong.

It is documented here rather than hidden because the same reasoning that makes the protocol
auditable makes the maintenance auditable: if you cannot see how a repository is maintained, you
cannot judge whether its history means anything.

## What it is

| | |
| --- | --- |
| **What** | An LLM agent invoked headlessly against this repository |
| **Cadence** | Two passes a week — Tuesday and Thursday, 08:30 local |
| **Brief** | [`pass.md`](pass.md) — the full instruction, versioned with the code |
| **Operator directives** | [`DIRECTIVES.md`](DIRECTIVES.md) — dated instructions that outrank everything else |
| **Quality gates** | [`CHECKS.md`](CHECKS.md) — what must pass before anything is committed |
| **Runner** | [`../../tools/schedule/run-pass.ps1`](../../tools/schedule/run-pass.ps1) |
| **Second agent** | [`../comment-responder/README.md`](../comment-responder/README.md) — answers visitor comments at the end of every pass |
| **Public record** | [`../../JOURNAL.md`](../../JOURNAL.md) and [`../../CHANGELOG.md`](../../CHANGELOG.md) |
| **Private record** | A local log directory outside the repository: `result.txt` — one line per pass, newest first — plus a verbose log per pass |

## What it is allowed to do

- Add, modify, and delete files in this repository.
- Create and remove directories.
- Commit and push directly to `main`.
- Open, comment on, label, and close issues.
- Move items on the project board.
- Change its own brief, with the change visible in the diff.

## What it must not do

- **Fabricate history.** No deliberately broken commit to be "fixed" later, no empty commits, no
  shuffled file timestamps. If a pass produces nothing worth committing, it commits nothing and
  says so.
- **Fabricate quality.** Nothing is marked done in `ROADMAP.md` without a test that covers it.
- **Chase stars.** No star exchanges, no purchased stars, no coordinated voting. Growth comes from
  the work being legible and useful, or it does not come.
- **Handle secrets.** No key material in a commit, a log, or an issue. Ever.
- **Touch mainnet.** The policy gate stays closed unless the operator opens it in a visible commit.
- **Break the public API silently.** A wire-format change requires a spec edit in the same pass.

## What counts as a pass

A pass is **one** increment, not a rewrite. The brief tells the agent to prefer small and verifiable
over large and impressive, and to leave the repository in a state where every test passes.

A pass is complete when:

1. Something in the repository is genuinely better — a bug fixed, a gap filled, a document made
   clearer, a test that would catch a real regression.
2. The quality gates in [`CHECKS.md`](CHECKS.md) pass.
3. `JOURNAL.md` records what was attempted, what landed, and what is still broken.
4. `CHANGELOG.md` records it if a user would notice.
5. The work is pushed.
6. The local log has an entry.

A pass that only moves a checkbox is a failed pass.

## Failure modes this design accepts

**The agent will write bad code.** Real maintainers do. The mitigation is the test suite and the
gates, not the agent's confidence.

**The agent will sometimes produce a trivial pass.** A typo fix is a legitimate pass; an invented
one is not. `JOURNAL.md` distinguishes them by saying which it was.

**The agent will hit a wall.** When a task needs a decision that is the operator's to make, the
brief requires it to open an issue describing the decision instead of guessing. The issue is the
deliverable of that pass.

**The cadence will be missed.** A laptop that is asleep at 09:00 runs nothing. The next pass
continues from the repository, not from a schedule, so a missed pass costs a day and nothing else.

## Following along

- **Commits** — every pass is a commit, or a small series, with a scoped message.
- **[JOURNAL.md](../../JOURNAL.md)** — the narrative, including failures.
- **[CHANGELOG.md](../../CHANGELOG.md)** — the user-visible summary.
- **[Issues](https://github.com/withinaz/communityofbillions/issues)** — work identified but not yet done.
- **[ROADMAP.md](../../ROADMAP.md)** — where this is all going.

## Running a pass yourself

```bash
# Read the brief
cat agents/maintenance/pass.md

# Run one pass by hand
pwsh tools/schedule/run-pass.ps1

# Or drive an agent of your own against the same brief
```

Nothing about this setup is specific to one model or one operator. If you fork this repository,
point your own agent at `pass.md` and it will maintain your fork the same way.
