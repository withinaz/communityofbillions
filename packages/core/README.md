# @communityofbillions/core

The COB/1 reference implementation. Signed agent envelopes and testnet-first stablecoin settlement
messages.

**Zero runtime dependencies.** Node ≥ 22. No build step.

```bash
node --test                       # from this directory
node bin/cob.js --help
```

## Install

```bash
npm install @communityofbillions/core     # not yet published — use the repository for now
```

Or, from a checkout, import the entry point directly:

```js
import { AgentIdentity, createEnvelope, verifyEnvelope } from './packages/core/src/index.js';
```

## Use

### Identity

```js
import { AgentIdentity } from '@communityofbillions/core';

const agent = AgentIdentity.generate();
agent.id;          // 'cob:agent:9tQK3v1s…'  — 53 characters, derived from the key
agent.publicKey;   // base64url, 43 characters — safe to publish
agent.exportSecret();  // ⚠️ the private key. Never log it, never commit it.
```

Persist an identity:

```js
import { writeFileSync, readFileSync } from 'node:fs';

writeFileSync('alice.cob-key.json', JSON.stringify(agent.exportSecret()), { mode: 0o600 });

const restored = AgentIdentity.fromSecret(JSON.parse(readFileSync('alice.cob-key.json', 'utf8')));
restored.id === agent.id;   // true
```

`fromSecret` re-derives the public key from the private seed and refuses a file where the two
disagree. A corrupted key file is an error, not a working identity with different behaviour.

### Envelopes

```js
import { createEnvelope, verifyEnvelope, checkEnvelope } from '@communityofbillions/core';

const envelope = createEnvelope({
  identity: agent,
  to: peer.id,
  type: 'cob.message',        // one of MESSAGE_TYPES
  body: { hello: 'there' },
  ttlSeconds: 300,            // default 300, maximum 86400
});

verifyEnvelope(envelope, { expectTo: peer.id });   // throws on any problem
checkEnvelope(envelope);                           // { valid: true } | { valid: false, code, reason }
```

`verifyEnvelope` throws; `checkEnvelope` returns the failure as data. Use the first in code that
cannot continue, the second in a receiver that logs and drops.

### Payments

```js
import { createPaymentRequest, createPaymentReceipt, matchReceipt, Payment } from '@communityofbillions/core';

const request = createPaymentRequest({
  identity: payee,
  to: payer.id,
  chain: 'base-sepolia',        // mainnet is refused unless policy.allowMainnet === true
  asset: 'USDC',
  amount: '2.50',               // a decimal STRING. Never a number.
  payTo: '0x1111111111111111111111111111111111111111',
});

const payment = new Payment(request.body);
payment.transition('requested').transition('authorized').transition('submitted');

const match = matchReceipt(request.body, receiptBody);
if (match.matches) payment.applyReceipt(receiptBody);

payment.summary();  // { state, amount, explorerUrl, history }
```

`matchReceipt` returns every problem it found, not just the first. Amounts are compared by value in
integer base units, so `"2.5"` correctly settles a request for `"2.50"`.

### Policy

```js
import { assertPaymentAllowed, DEFAULT_POLICY } from '@communityofbillions/core';

DEFAULT_POLICY.allowMainnet;   // false

assertPaymentAllowed({ chain: 'base-sepolia', asset: 'USDC', amount: '10' });   // ok
assertPaymentAllowed({ chain: 'base', asset: 'USDC', amount: '10' });          // throws PolicyError

// Opt in explicitly, with a ceiling.
assertPaymentAllowed(
  { chain: 'base', asset: 'USDC', amount: '10' },
  { allowMainnet: true, maxAmount: { USDC: '100' } },
);
```

The gate is a `throw`, not an instruction to a model. That is the point.

## CLI

```
cob keygen --out <path> [--force]    generate an identity (refuses to overwrite unless --force)
cob id --key <path>                  print the agent id
cob sign --key <path> --to <id> --type <t> --body <json>
cob verify --envelope <path|->       exit 1 if the envelope is not valid
cob inspect --envelope <path|->
cob request --key <path> --to <id> --chain <c> --asset <a> --amount <n> --pay-to <addr>
cob receipt-check --request <path> --receipt <path>
```

`cob verify` is designed for a shell: it exits `0` when the envelope is valid and `1` when it is
not, so it composes with `&&` and with CI.

## Design rules

1. **Money is a string.** Amounts are decimal strings, converted to `BigInt` base units at the
   boundary. A float never touches an amount.
2. **The signed set is an allow-list.** See `SIGNED_FIELDS`. A verifier reads those fields and
   nothing else, so an appended field carries no authority.
3. **Fail closed.** Unknown chain, asset, message type, or version → reject.
4. **Testnet first.** Mainnet requires an explicit policy opt-in.
5. **No dependencies.** `node:crypto` and the standard library. A protocol implementation you
   cannot audit by reading is one you cannot trust.

## Errors

Every deliberate failure carries a stable `code`:

`COB_CANONICALIZATION` · `COB_VALIDATION` · `COB_SIGNATURE` · `COB_EXPIRED` · `COB_POLICY` ·
`COB_STATE`

Switch on the code, never on the message.

## Status

Pre-1.0, unaudited, draft specification. **Do not use it on mainnet with real funds.**
See [`SECURITY.md`](../../SECURITY.md) and [`docs/security.md`](../../docs/security.md).
