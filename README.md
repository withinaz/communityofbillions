<div align="center">

# communityofbillions

**Agents should be able to find each other, talk to each other, and pay each other — without a human in the middle.**

An open protocol (`COB/1`) and toolkit for AI agent-to-agent connectivity with native stablecoin settlement.
Testnet-first. Zero-dependency core. Spec-driven.

[![CI](https://github.com/withinaz/communityofbillions/actions/workflows/ci.yml/badge.svg)](https://github.com/withinaz/communityofbillions/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Spec: COB/1 draft](https://img.shields.io/badge/spec-COB%2F1%20draft-orange.svg)](spec/COB-1.md)
[![Status: early](https://img.shields.io/badge/status-early%20development-red.svg)](ROADMAP.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**[Roadmap](ROADMAP.md) · [Project board](https://github.com/users/withinaz/projects/2) · [Specification](spec/COB-1.md) · [Issues](https://github.com/withinaz/communityofbillions/issues) · [Journal](JOURNAL.md)**

</div>

---

## Why

Today an AI agent can call a tool. It cannot easily:

- **discover** another agent it has never met,
- **prove who it is** without a shared secret,
- **negotiate** a price for a task,
- **pay** for that task in a way that is verifiable and final,
- **dispute** a result it did not get.

Every team building multi-agent systems is rewriting that plumbing badly, in private, in incompatible ways.
`communityofbillions` is an attempt to write it **once, in the open, with tests**.

We start from a deliberately unfashionable position: **the message is the primitive, not the framework.**
A signed, self-contained envelope that any runtime — Python, TypeScript, Rust, a shell script — can produce and verify.

## What works today

| Area | Status |
| --- | --- |
| `COB/1` envelope (signed, canonical, versioned) | ✅ draft spec + reference implementation |
| Ed25519 agent identity (`cob:agent:…`) | ✅ implemented, tested |
| Payment request / receipt messages | ✅ implemented, tested |
| Chain & asset policy (testnet-first, mainnet gated) | ✅ implemented, tested |
| Payment state machine | ✅ implemented, tested |
| CLI (`cob keygen`, `cob sign`, `cob verify`, …) | ✅ usable |
| Agent registry / discovery | 🚧 next |
| On-chain USDC settlement (Base Sepolia) | 🚧 next |
| Escrow & dispute flow | 🗓 planned |
| MCP server (`cob_*` tools) | 🗓 planned |
| Multi-runtime SDKs (Python, Rust) | 🗓 planned |

See [ROADMAP.md](ROADMAP.md) for the honest, dated version of this table.

## Quickstart

Requires **Node.js ≥ 22**. The core package has **no runtime dependencies**.

```bash
git clone https://github.com/withinaz/communityofbillions.git
cd communityofbillions
node packages/core/bin/cob.js --help
```

Generate an agent identity:

```bash
node packages/core/bin/cob.js keygen --out ./alice.cob-key.json
# {
#   "cob": "1",
#   "id": "cob:agent:9tQK3v1sVn0m2Yf4pQ7rLbXwZc8dHjKeSgUaNtMi5Pk",
#   "publicKey": "9tQK3v1sVn0m2Yf4pQ7rLbXwZc8dHjKeSgUaNtMi5Pk",
#   "privateKey": "…"
# }
```

Sign and verify an envelope:

```bash
node packages/core/bin/cob.js sign --key ./alice.cob-key.json \
  --to cob:agent:<bob> --type cob.payment.request \
  --body '{"asset":"USDC","chain":"base-sepolia","amount":"2.50","payTo":"0x…"}'

node packages/core/bin/cob.js verify --envelope ./payment.json
# ✔ signature ok · key cob:agent:9tQK3v… · not expired
```

Run the test suite:

```bash
node --test packages/core/test/
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          COB/1 layers                            │
├──────────────────────────────────────────────────────────────────┤
│  L4  Application      task offers · invoices · receipts · escrow │
├──────────────────────────────────────────────────────────────────┤
│  L3  Settlement       USDC on Base Sepolia / Ethereum Sepolia    │
│                       (mainnet present but disabled by policy)   │
├──────────────────────────────────────────────────────────────────┤
│  L2  Envelope         canonical JSON + Ed25519 signature         │
├──────────────────────────────────────────────────────────────────┤
│  L1  Identity         cob:agent:<base64url(ed25519 pubkey)>      │
├──────────────────────────────────────────────────────────────────┤
│  L0  Transport        HTTPS · WebSocket · file drop · MCP        │
└──────────────────────────────────────────────────────────────────┘
```

The design rule that keeps this small: **every layer is optional except L1 and L2.**
An agent that can only write files to a shared directory can still participate.

Read more in [docs/architecture.md](docs/architecture.md).

## Design principles

1. **Verify, don't trust.** Every envelope is signed and every signature is checked by the receiver. There is no "trusted broker".
2. **Testnet first.** The default policy refuses mainnet chains. Turning them on is an explicit, auditable act. See [docs/security.md](docs/security.md).
3. **Money is a string, never a float.** Amounts are decimal strings in human units plus an explicit asset and chain. Rounding is a bug you cannot afford.
4. **No framework lock-in.** The core has zero dependencies and speaks JSON. Frameworks can wrap it; they cannot own it.
5. **Fail closed.** Unknown chain, unknown asset, unknown `cob` version, expired envelope → reject.

## Repository layout

```
spec/            COB/1 protocol specification (the normative document)
packages/core/   Reference implementation — zero dependencies
docs/            Architecture, security model, glossary
agents/          Two agents: the maintainer, and the one that answers visitors
examples/        Runnable two-agent scenarios
JOURNAL.md       Public, append-only log of what changed and why
```

## How this project is maintained

This repository is kept alive by an automated maintenance agent that performs small, real increments
twice a week and records what it did — including what it got wrong — in [JOURNAL.md](JOURNAL.md).
Its brief, its quality gates, and its standing prohibitions are all public:

- [agents/maintenance/README.md](agents/maintenance/README.md) — what it is and what it may do
- [agents/maintenance/pass.md](agents/maintenance/pass.md) — the brief it runs under
- [agents/maintenance/DIRECTIVES.md](agents/maintenance/DIRECTIVES.md) — dated operator instructions that outrank the roadmap
- [agents/maintenance/CHECKS.md](agents/maintenance/CHECKS.md) — what must pass before it commits
- [agents/comment-responder/README.md](agents/comment-responder/README.md) — the second agent, which answers visitor comments after every pass
- [tools/schedule/](tools/schedule/) — the runner and the scheduler setup

It is instructed, in as many words, not to fabricate history, not to mark anything done without a
test, and not to chase stars. If that ever stops being true, the commit history is where you will
see it.

**If you comment here, a bot will probably answer you.** Every such reply says so, at the bottom,
with a link to how the responder works. It is a language model given a strict brief, and the runner
validates its output before anything is posted — but it is still a bot, and it will occasionally be
wrong. A human reads the [issues](https://github.com/withinaz/communityofbillions/issues)
regularly.

## Contributing

Issues and pull requests are genuinely welcome — this project is early enough that your opinion still changes the design.
Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [`good first issue`](https://github.com/withinaz/communityofbillions/labels/good%20first%20issue) label.

If you build something with `COB/1`, open a discussion and tell us — real usage is worth more than stars.

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

**This software moves money-adjacent messages. It is pre-1.0 and unaudited. Do not use it on mainnet with real funds.**

## License

Code: [MIT](LICENSE). Specification text (`spec/`): CC-BY-4.0.

---

<div align="center">
<sub>Built in the open, one honest commit at a time.</sub>
</div>
