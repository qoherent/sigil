# sigil-cli

Current package version: **0.1.0**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): version 0.1 CLI requirements, command behavior, output contracts,
  and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Install the published CLI:

```bash
deno install --global --allow-read --allow-write --name sigil jsr:@qoherent/sigil@0.1
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- link version-owned agent skills into a target repository;
- expose parser output;
- run workspace checks;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil install` links every installed `integrations/skills/*` directory into
  the current repository's `.agents/skills/` and gitignores those links;
- `sigil init [path]` creates a config without overwriting;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON;
- `sigil render ...` returns Markdown.

The CLI returns exit code `0` for success or warnings, `1` for error diagnostics, `2` for usage errors, and `3` for host/runtime failures.
Use JSON output for automation; human text and Markdown are convenience projections.

A versioned binary distribution should place its assets at
`<version>/integrations/skills` beside `<version>/bin/sigil`. This keeps each
binary paired with the language semantics and skills shipped for that version.

Run the package tests with:

```bash
deno task test
```
