#!/usr/bin/env node
/**
 * `cob` — command-line access to the COB/1 primitives.
 *
 * The CLI exists for two reasons:
 *
 * 1. A protocol you cannot poke at from a shell is a protocol nobody adopts.
 * 2. It is the reference behaviour. If the CLI can do it, the spec must describe it.
 *
 * Exit codes: `0` success, `1` a protocol or validation error, `2` a usage error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentIdentity,
  IMPLEMENTATION_VERSION,
  checkEnvelope,
  createEnvelope,
  createPaymentRequestBody,
  createPaymentRequest,
  envelopeDigest,
  matchReceipt,
  normalizePolicy,
  shortAgentId,
  validatePaymentRequest,
} from '../src/index.js';

const USAGE = `
cob — COB/1 reference CLI (communityofbillions)

Usage: cob <command> [options]

Identity
  keygen                          Generate an agent identity and write its secret file
    --out <path>                    (required) where to write the secret
    --force                         overwrite an existing secret file
  id                              Print the agent id for a secret file
    --key <path>                    (required)

Messages
  sign                            Create a signed envelope
    --key <path>                    (required) signing identity
    --to <agent-id>                 (required) recipient
    --type <message-type>           (required) e.g. cob.message
    --body <json>                   inline JSON body
    --body-file <path>              read the body from a file
    --ttl <seconds>                 validity window (default 300, max 86400)
    --out <path>                    write the envelope here instead of stdout
  verify                          Verify an envelope; exit 1 if it is not valid
    --envelope <path|->             (required) '-' reads stdin
    --to <agent-id>                 also assert the envelope is addressed to this agent
    --now <instant>                 evaluate expiry at this instant instead of now
  inspect                         Print an envelope in a readable form
    --envelope <path|->

Payments
  request                         Create a signed cob.payment.request
    --key <path>                    (required)
    --to <agent-id>                 (required)
    --chain <name>                  (required) e.g. base-sepolia
    --asset <symbol>                (required) e.g. USDC
    --amount <decimal-string>       (required) e.g. 2.50
    --pay-to <address>              (required)
    --memo <text>
    --valid-for <seconds>           invoice validity (default 900)
    --policy <path>                 JSON policy file; mainnet stays off unless it says otherwise
    --out <path>
  receipt-check                   Compare a receipt body against a request body
    --request <path>                (required)
    --receipt <path>                (required)

General
  --json                          Force machine-readable JSON output
  --help, -h                      Show this help
  --version, -V                   Show the implementation version
`;

const OPTIONS = {
  out: { type: 'string' },
  key: { type: 'string' },
  to: { type: 'string' },
  type: { type: 'string' },
  body: { type: 'string' },
  'body-file': { type: 'string' },
  ttl: { type: 'string' },
  envelope: { type: 'string' },
  now: { type: 'string' },
  chain: { type: 'string' },
  asset: { type: 'string' },
  amount: { type: 'string' },
  'pay-to': { type: 'string' },
  memo: { type: 'string' },
  'valid-for': { type: 'string' },
  policy: { type: 'string' },
  request: { type: 'string' },
  receipt: { type: 'string' },
  force: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
};

main();

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stdout.write(USAGE);
    process.exit(2);
  }

  /** @type {import('node:util').ParseArgsConfig & { values: any, positionals: string[] }} */
  let parsed;
  try {
    parsed = /** @type {any} */ (parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    fail(`usage: ${error instanceof Error ? error.message : String(error)}`, 2);
  }

  const { values } = parsed;
  const command = parsed.positionals[0];

  if (values.help === true || command === 'help') {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (values.version === true) {
    process.stdout.write(`cob ${IMPLEMENTATION_VERSION} (COB/1)\n`);
    process.exit(0);
  }
  if (command === undefined) {
    process.stdout.write(USAGE);
    process.exit(2);
  }

  try {
    switch (command) {
      case 'keygen': return cmdKeygen(values);
      case 'id': return cmdId(values);
      case 'sign': return cmdSign(values);
      case 'verify': return cmdVerify(values);
      case 'inspect': return cmdInspect(values);
      case 'request': return cmdRequest(values);
      case 'receipt-check': return cmdReceiptCheck(values);
      default:
        return fail(`unknown command "${command}"`, 2);
    }
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
      const e = /** @type {{ code: string, message: string, details?: unknown }} */ (error);
      process.stderr.write(`error [${e.code}] ${e.message}\n`);
      if (values.json === true && e.details !== undefined) {
        process.stderr.write(`${JSON.stringify({ code: e.code, details: e.details }, null, 2)}\n`);
      }
      process.exit(1);
    }
    throw error;
  }
}

/**
 * @param {any} values
 */
function cmdKeygen(values) {
  const out = requireOption(values.out, '--out');
  const target = resolve(out);

  if (existsSync(target) && values.force !== true) {
    let existingId;
    try {
      const secret = JSON.parse(readFileSync(target, 'utf8'));
      existingId = AgentIdentity.fromSecret(secret).id;
    } catch {
      existingId = undefined;
    }
    if (existingId !== undefined) {
      fail(`refusing to overwrite ${target} (existing agent id ${existingId}); pass --force to replace it`, 1);
    }
    fail(`refusing to overwrite ${target}; pass --force to replace it`, 1);
  }

  const identity = AgentIdentity.generate();
  const secret = identity.exportSecret();

  mkdirSync(dirname(target), { recursive: true });
  // 0600 is advisory on Windows but authoritative on POSIX. Ask for it either way.
  writeFileSync(target, `${JSON.stringify(secret, null, 2)}\n`, { mode: 0o600 });

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(identity.toPublicDescriptor(), null, 2)}\n`);
  } else {
    process.stdout.write(`agent id  ${identity.id}\n`);
    process.stdout.write(`public    ${identity.publicKey}\n`);
    process.stdout.write(`secret    ${target}  (mode 0600, never commit this)\n`);
  }
  return;
}

/**
 * @param {any} values
 */
function cmdId(values) {
  const identity = loadIdentity(requireOption(values.key, '--key'));
  process.stdout.write(`${identity.id}\n`);
}

/**
 * @param {any} values
 */
function cmdSign(values) {
  const identity = loadIdentity(requireOption(values.key, '--key'));
  const to = requireOption(values.to, '--to');
  const type = requireOption(values.type, '--type');

  const body = values.body !== undefined
    ? parseJson(values.body, '--body')
    : values['body-file'] !== undefined
      ? parseJson(readSource(values['body-file']), '--body-file')
      : undefined;

  if (body === undefined) fail('one of --body or --body-file is required', 2);

  const ttlSeconds = values.ttl === undefined ? undefined : parsePositiveInteger(values.ttl, '--ttl');

  const envelope = createEnvelope({ identity, to, type, body, ttlSeconds });
  emit(envelope, values);
}

/**
 * @param {any} values
 */
function cmdVerify(values) {
  const envelope = parseJson(readSource(requireOption(values.envelope, '--envelope')), '--envelope');
  const now = values.now === undefined ? undefined : new Date(String(values.now));
  const expectTo = values.to;

  const result = checkEnvelope(envelope, { now, expectTo });

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.valid) {
    process.stdout.write(`ok signature ${shortAgentId(String(envelope.from))}\n`);
    process.stdout.write(`  type    ${envelope.type}\n`);
    process.stdout.write(`  digest  ${envelopeDigest(/** @type {any} */ (envelope))}\n`);
  } else {
    process.stderr.write(`${result.code}: ${result.reason}\n`);
  }

  process.exit(result.valid ? 0 : 1);
}

/**
 * @param {any} values
 */
function cmdInspect(values) {
  const envelope = parseJson(readSource(requireOption(values.envelope, '--envelope')), '--envelope');
  const result = checkEnvelope(envelope);
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.stderr.write(`\n${result.valid ? 'ok' : result.code + ': ' + result.reason}\n`);
  process.exit(result.valid ? 0 : 1);
}

/**
 * @param {any} values
 */
function cmdRequest(values) {
  const identity = loadIdentity(requireOption(values.key, '--key'));
  const to = requireOption(values.to, '--to');
  const policy = values.policy === undefined ? undefined : parseJson(readSource(values.policy), '--policy');

  if (policy !== undefined) normalizePolicy(policy);

  const body = createPaymentRequestBody({
    chain: requireOption(values.chain, '--chain'),
    asset: requireOption(values.asset, '--asset'),
    amount: requireOption(values.amount, '--amount'),
    payTo: requireOption(values['pay-to'], '--pay-to'),
    memo: values.memo,
    validForSeconds: values['valid-for'] === undefined
      ? undefined
      : parsePositiveInteger(values['valid-for'], '--valid-for'),
    policy,
  });

  const envelope = createPaymentRequest({ identity, to, ...body, policy });
  emit(envelope, values);
}

/**
 * @param {any} values
 */
function cmdReceiptCheck(values) {
  const request = validatePaymentRequest(
    parseJson(readSource(requireOption(values.request, '--request')), '--request'),
  );
  const receipt = parseJson(readSource(requireOption(values.receipt, '--receipt')), '--receipt');
  const result = matchReceipt(request, receipt);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.matches) {
    process.stdout.write('receipt settles the request\n');
  } else {
    process.stderr.write(`${result.problems.length} problem(s):\n`);
    for (const problem of result.problems) {
      process.stderr.write(`  - ${problem.code}: ${problem.message}\n`);
    }
  }
  process.exit(result.matches ? 0 : 1);
}

function requireOption(value, flag) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${flag} is required`, 2);
  }
  return value;
}

function readSource(path) {
  if (path === '-') {
    return readFileSync(0, 'utf8');
  }
  return readFileSync(resolve(path), 'utf8');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}

function parsePositiveInteger(text, label) {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`, 2);
  }
  return value;
}

function loadIdentity(path) {
  const secret = parseJson(readSource(path), `key file ${path}`);
  return AgentIdentity.fromSecret(secret);
}

function emit(value, values) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (values.out === undefined) {
    process.stdout.write(text);
    return;
  }
  const target = resolve(String(values.out));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  process.stderr.write(`wrote ${target}\n`);
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
