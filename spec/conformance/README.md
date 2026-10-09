# Sigil conformance corpus

Each directory is one case: a `workspace/` tree plus the `expected.json` both
parsers must produce. The TypeScript parser (`packages/core`) and the sigilc
parser (`packages/sigilc`) read the same files in CI, so a grammar change has
to land in both.

`expected.json` is a normalized structural view: components, Tags, groupings,
Facets, imports, and diagnostics, with UTF-8 byte ranges. It leaves out
identifiers (each parser mints its own) and diagnostic `message` text (wording
is implementation-defined). A diagnostic is compared by code, stage, severity,
file, range, and related ranges.

The TypeScript runner lists files with the CLI's disk adapter, so its skip
rules (`.git`, symlinks, and every `.sigil/` entry except `config.json`,
`local.json`, and `glossary.json`) are part of the corpus, then loads them
under a virtual root so this repository's own workspace config does not nest.

To change a case, edit its `workspace/`, review the difference, then rewrite
the expectation:

```sh
cd packages/core
SIGIL_UPDATE_CONFORMANCE=1 deno test --allow-read --allow-write --allow-env tests/conformance_test.ts
```

Seed cases follow the spec's conformance examples C01 to C06
(`spec/sigil-reference.md`) and the workspace rules in `spec/sigil-config.md`.
