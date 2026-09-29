# Journal

A public, append-only record of what changed in this repository and **why**.

Rules for this file:

- Newest entries at the top.
- Every entry says what was *attempted*, what actually landed, and what is still broken.
- Failed attempts and corrections stay in the record. An honest history is more useful than a clean one.
- No entry claims something works unless a test in `packages/core/test/` covers it.

---

## 2026-09-29 — keygen refuses to overwrite an existing secret

**Attempted:** stop `cob keygen --out` from silently destroying an existing identity file.

**Landed:**

- `cob keygen` exits non-zero if `--out` already exists, names the file, and prints the existing agent id when the file is a readable secret.
- `--force` is required to replace the file.
- Covered by `packages/core/test/cli-keygen.test.js`.

**Still broken / not done:**

- Other CLI write paths (`--out` on `sign` / `request`) still overwrite without asking.

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
