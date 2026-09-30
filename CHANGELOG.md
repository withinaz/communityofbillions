# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for the implementation.
The **wire format** is versioned separately: it is `cob: "1"`, and it will only change with a
documented specification revision.

## [Unreleased]

### Changed

- **Breaking: `allowMainnet: true` is refused, not honoured.** `normalizePolicy` now throws a
  `PolicyError` naming issue #7 instead of returning a policy that permits mainnet. The field stays
  in the policy object and stays documented, and the mainnet chains stay in `CHAIN_REGISTRY`: the
  *opt-in* is disabled, not mainnet. Any caller that was opening mainnet by passing
  `allowMainnet: true` must stop — that call now throws. The mainnet check in `assertChainAllowed`
  is unchanged and is now exported as `assertMainnetAllowed`, so the control that will guard
  mainnet remains exercised by a test while the opt-in is locked.

### Added

- **`allowUnlimited` policy field**, default `true`. It names the absence of a spending ceiling:
  with `maxAmount` empty, an amount is uncapped on any chain the policy allows. Today's behaviour
  is unchanged; the flag exists so that unbounded spending can require a visible act once the
  mainnet opt-in is unlocked.
- **Comment responder** (`agents/comment-responder/`) — a second agent runs at the end of every
  maintenance pass. It reads the comments left on the repository, decides whether each deserves an
  answer, and writes those answers; the runner validates and posts them. It is split that way on
  purpose: the agent never touches GitHub, so everything that becomes public passes through code
  that can be read and tested.
  - A local state file records what has been answered. A comment is answered **again only when its
    author edits it** — GitHub's `updated_at` is stored as a Unix epoch and compared, so an
    untouched comment is never re-answered and an edited one always is.
  - Replies are capped at four sentences and 2000 characters, must name a comment that was actually
    in the input, and are refused if they look like they contain key material.
  - Every reply is signed by the runner as the work of an automated agent.
  - Comments are treated as untrusted input: a reply is never produced by following instructions
    found inside one.
- **Runner tests** (`tools/schedule/tests/run-pass.tests.ps1`) — 40 assertions over the decision
  logic, with no test framework and no dependencies. The functions are extracted from the runner
  with the PowerShell AST, so the tests exercise the code that ships rather than a copy. Wired into
  the quality gates as Gate 4.
- Runner switches: `-CommentsOnly` (run only the comment pass) and `-CheckGates` (run the gates and
  exit, invoking no agent).
- `result.txt` — one line per scheduled pass, newest first, for the operator. Written only by a real
  pass; the dry-run and gate modes do not touch it.

### Fixed

- **The scheduled task did not run.** Its action was `pwsh.exe`, which resolves to a **0-byte app
  execution alias** when PowerShell 7 comes from the Microsoft Store. Task Scheduler accepts the
  registration, reports the task as Ready, fires it on schedule, and then fails in milliseconds
  with `0x80070002` (`ERROR_FILE_NOT_FOUND`) — with nothing in the repository to show for it.
  The task is now started by Windows PowerShell 5.1, whose path in `System32` cannot move, and
  [`tools/schedule/launch.ps1`](tools/schedule/launch.ps1) hands over to a real PowerShell 7. No new
  dependency: 5.1 ships with Windows.
- **`$PSScriptRoot` is empty in a `param()` default under PowerShell 5.1** when the script declares
  `[CmdletBinding()]`. The launcher and the runner tests resolved their paths that way, so both
  would have died at parameter binding. Both now resolve their paths in the body of the script.
  This is verified behaviour: the same script without `[CmdletBinding()]` binds it correctly, and
  PowerShell 7 does not have the problem.
- The runner no longer calls `pwsh` from `PATH` to run its own tests; it uses the real
  installation directory of the interpreter currently running (`$PSHOME`), for the same alias
  reason.

## [0.1.0] — 2026-09-28

First draft. Everything below is new.

### Added

- **Specification** `spec/COB-1.md` (draft 0.1): identity, envelope, canonical form, message types,
  payment request/receipt, receipt matching, payment lifecycle, chain and asset policy, error codes,
  and an explicit list of open questions.
- **Canonical JSON** (`canonical.js`) — a strict subset of RFC 8785. Rejects `undefined` members,
  NaN, Infinity, bigint, and cycles rather than coercing them, because coercion is how two distinct
  documents collide onto one signed byte stream.
- **Amounts** (`amount.js`) — decimal strings ↔ integer `BigInt` base units. Comparison is numeric,
  so `"2.5"` and `"2.50"` are the same amount and `"9"` is below a ceiling of `"10"`.
- **Identity** (`identity.js`) — Ed25519 key pairs, `cob:agent:` identifiers derived from the public
  key, JWK-free DER import/export, and a secret loader that re-derives and cross-checks the public
  half so a doctored key file is an error rather than a silently different agent.
- **Envelope** (`envelope.js`) — minting, structural validation, signature verification, expiry and
  clock-skew handling, and an explicit signed-field allow-list.
- **Policy** (`policy.js`) — chain registry with CAIP-2 identifiers, `allowMainnet` defaulting to
  `false`, allow-lists, and per-asset amount ceilings compared numerically.
- **Payments** (`payments.js`) — payment request and receipt messages, `matchReceipt` with all
  problem codes, a `Payment` state machine whose terminal states cannot be left, and a double
  settlement guard.
- **CLI** (`bin/cob.js`) — `keygen`, `id`, `sign`, `verify`, `inspect`, `request`, `receipt-check`.
- **Example** `examples/two-agents/run.js` — a full dialogue plus five refusals that must happen.
- **CI** — test matrix on Node 22 and 24, a syntax check, and an end-to-end CLI job that asserts a
  tampered envelope, an expired envelope, a mainnet request, and an over-ceiling amount are refused.
- **Documentation** — `docs/architecture.md` (why the layers are shaped this way),
  `docs/security.md` (threat model, including what is *not* mitigated), `docs/glossary.md`.
- **Repository hygiene** — contribution guide, code of conduct, security policy, roadmap, PR and
  issue templates, and this changelog.

### Known gaps

- No transport binding, so two agents cannot actually reach each other over a network yet.
- No discovery: no `.well-known/cob.json`, no registry.
- Replay protection is a `nonce` field without a cache. **This is the largest known gap.**
- No on-chain settlement. Receipts are structural claims and are not verified against chain state.
- No escrow, no dispute flow, no reputation.

### Notes

- The `Payment` class originally carried a stray TypeScript-shaped `readonly;` field, which was
  removed before the first commit.
- `AgentIdentity.fromSecret` first derived the public key from a JWK containing only `d`. Node
  rejects OKP private JWKs without `x`, so the derivation was rewritten in terms of PKCS#8 DER.
  A test now pins the behaviour.
- `assertPaymentAllowed` initially did not check amount precision, so a USDC invoice could be
  created with seven decimals — an invoice that could never be settled. Fixed, with a test.
- One test was flaky: it built an invalid identifier with `good.replace('-', '+')`, a no-op
  whenever the generated key contained no `-`. Now deterministic.
