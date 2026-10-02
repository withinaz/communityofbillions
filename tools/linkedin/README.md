# Social card generator

`make-card.ps1` renders a card from a JSON spec, in this project's visual identity. It is what the
maintenance agent uses when a draft needs a graphic, and it is why two cards written a month apart
look like they came from the same place.

```bash
pwsh tools/linkedin/make-card.ps1 -Spec card.json -Out card.png
```

Output: a 1200 × 1200 PNG rendered at 2× (so 2400 × 2400), which is what LinkedIn wants for a feed
image. Square, because the feed crops landscape images unpredictably.

No dependency beyond a browser. Chrome or Edge, detected automatically, or `-ChromePath`.

## The spec

Every field is optional except one title line.

```json
{
  "kicker":             "small uppercase line at the top",
  "titleLine1":         "first title line, plain",
  "titleLine2Lead":     "second title line, de-emphasised",
  "titleLine2Accent":   "second title line, highlighted",

  "sections": [
    {
      "label":  "section heading",
      "accent": false,
      "meta":   "one line rendered directly under this section's rows",
      "rows": [
        { "name": "MCP", "role": "agent to tool", "tag": "Linux Foundation" }
      ]
    }
  ],

  "mine":  { "name": "COB/1", "role": "what is left.", "roleAccent": "the highlighted half." },
  "quote": { "text": "a quote from the repository", "source": "where it is written" },

  "punch":       "Compose, ",
  "punchAccent": "don't compete.",
  "repo":        "github.com/withinaz<br>/communityofbillions"
}
```

`meta` lives on the section, not at the top level. It reads as a caption for the rows above it, and
a top-level field cannot express that — the first version of this script put it above the *next*
section's heading, which was wrong in a way only a rendered card reveals.

Values are inserted as **HTML fragments**, not escaped. That is deliberate: the caller is this
repository's own tooling, and an escaping layer would fight every arrow (`&harr;`) and every
ampersand in "A2A + AP2 + x402". If you generate a spec from data you do not control, escape it
first.

## A worked example

[`spec.example.json`](spec.example.json) reproduces the A2A card used in the first LinkedIn draft.
The generator is verified against it: running it produces a byte-identical PNG to the one that was
originally hand-written.

```bash
pwsh tools/linkedin/make-card.ps1 -Spec tools/linkedin/spec.example.json
```

The rendered HTML is written next to the PNG with the same base name. When a card comes out wrong,
that file is what to look at — and it is usually a spec problem, not a rendering one.

## Two things that will bite you if you edit this script

**Chrome is a GUI process.** `& chrome.exe …` returns as soon as the process has been *launched*,
not when it has finished. Checking for the PNG on the next line is a race that is lost most of the
time and won once, which is worse, because it looks like it works. The script uses
`Start-Process -Wait`, and that is not optional.

**Chrome hands off to a running instance.** If Chrome is already open, an invocation without its own
`--user-data-dir` is delegated to the running one, which ignores `--headless` and writes nothing at
all — exit code 0, no file, no error. The script uses a throwaway profile per run and removes it
afterwards.

Both of these cost real time to diagnose. They are written down so they cost it once.
