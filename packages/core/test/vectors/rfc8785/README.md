# RFC 8785 reference vectors

`input/` and `output/` are copied **verbatim** from the `testdata` directory of
[`cyberphone/json-canonicalization`](https://github.com/cyberphone/json-canonicalization)
(master, commit `32a48195b9b20fe67b1795e39e4509f14d860b45`, read 2026-10-15). That repository is
the reference implementation of RFC 8785 (JSON Canonicalization Scheme); its test corpus is
Apache-2.0, Copyright 2018 Anders Rundgren. The licence text is at
<https://www.apache.org/licenses/LICENSE-2.0>.

- `input/<name>.json` — a JSON text that is not in canonical form.
- `output/<name>.json` — the exact byte stream RFC 8785 requires for it. No trailing newline.
- `es6-samples.txt` — the seven `hex-ieee,expected` sample lines printed in that repository's
  `testdata/README.md`. The full ES6 number corpus is a 100-million-line download and is **not**
  vendored; these samples are the ones the upstream README documents, kept because between them
  they cover the `-0` and 2^53 boundaries the structural vectors do not reach.

`../rfc8785.test.js` parses each input as JSON text and asserts that `canonicalize` produces the
matching output byte-for-byte. The vectors are read from disk; the tests fetch nothing.

This directory is material for a test, not part of the published package: `packages/core`'s
`files` field ships only `src`, `bin` and `README.md`.
