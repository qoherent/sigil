# sigil-cli

The package version is declared in `deno.json`.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): language 0.8 CLI requirements, command behavior, output
  contracts, and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Standalone GitHub releases install both `sigil` and `sigilc`, plus bundled
skills. Each binary reports its own manifest version. On macOS or Linux:

```bash
curl -fsSL https://github.com/qoherent/sigil/releases/latest/download/install.sh | sh
```

Install on Windows PowerShell:

```powershell
irm https://github.com/qoherent/sigil/releases/latest/download/install.ps1 | iex
```

Alternatively, install the published JSR package when Deno is available:

```bash
deno install --global --allow-read --allow-write --allow-env=HOME,USERPROFILE --name sigil jsr:@qoherent/sigil
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- install version-owned agent skills globally or into a target repository;
- expose parser output;
- run workspace checks;
- expose owner-qualified Tags, explicit imports and source-faithful diagnostics;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil --help` reports top-level help, while `--help` after any recognized
  command or subcommand reports help scoped to that command path;
- `sigil skill list` reports bundled directories containing `SKILL.md`;
- `sigil skill install` installs skills globally for Codex, Claude Code,
  OpenCode, and Pi;
- `sigil skill install --project` installs into the current repository;
- `sigil skill install --agent <name>` limits installation to one agent;
- `sigil init [path]` creates a config and, when absent, a glossary seeded only
  with the eight agent-context-excluded, colon-qualified decision-record field
  labels; it never overwrites either file;
- new configurations have an empty `tools` object; provider/profile authoring
  and runtime doctor commands have been removed;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics; add `--format text --show-locations`
  to append each diagnostic's file path, line, and column to the text output
  (default text output and JSON are unchanged without the flag);
- `sigil glossary [path]` reports reviewed entries, resolved contexts, and
  source occurrences;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON with direct dependencies'
  complete provider contracts, selected Tags and consumer reference evidence
  plus reviewed terminology recognized in the selected and related Sigil files,
  excluding terms whose `agentContext` value is `false`;
- `sigil retrieve [path] (--component name | --file file) --purpose
  semantic|architecture|implementation`
  returns a deterministic selected graph, exact evidence, inclusion reasons,
  exclusion frontier, aggregated context, and a content fingerprint; add
  `--format markdown` for a readable context pack;
- `sigil render ...` returns Markdown;
- `sigil export design [path] [--root workspace] [--pretty]` emits the complete
  workspace's raw structural JSON bundle for native compilation.

Export preserves captured source, configuration, glossary and diagnostics. It
supports JSON only and rejects `--quiet`. The path locates a workspace; select
focused Design roots with native `--scope`, after export. Exit 0 means no
language errors, 1 means language errors remain in the bundle, 2 means invalid
usage, and 3 means an operational failure. Invalid UTF-8 cannot produce a
faithful bundle: stdout stays empty and stderr carries encoding diagnostics with
exit 1. A representable language-invalid source retains its captured text and
diagnostics in schema-2 JSON. These exits do not describe semantic gate states.

Language ranges are half-open original UTF-8 byte offsets. Text diagnostic
locations use scalar columns derived from the captured source. Implementation
annotation ranges remain explicitly separate, using one-based UTF-16 columns.
Relative display paths never rewrite authored prose, links or payload contents.

The skill catalog reports each skill's declared compatibility. The retained
`sigil` skill targets language 0.7 with frozen CLI `^0.8.0`, core `^0.7.0` and
native `^0.1.0` requirements. It is incompatible with the new language
toolchain. Installing skill documentation does not run or certify its runtime
workflow. Use `sigil-understand`, `sigil-write` and `sigil-evaluate` for 0.8
designs.

Use the native compiler directly:

```sh
sigil export design . > frontend.json
sigilc stale design --frontend frontend.json
sigilc compile design --frontend frontend.json
```

See the [native command guide](../sigilc/README.md) for ordered scope, external
reconstruction, preparation/ingestion, catalogs and Implementation comparison.
The model or operator invokes `sigilc` directly. The language CLI exports
structure; it does not launch semanticizers or forward compiler commands.

For a checkout whose installed CLI predates export:

```sh
deno run --allow-read packages/cli/src/main.ts export design . > frontend.json
```

Run this command from the repository root. Run package tests from `packages/cli`
with `deno task test`.
