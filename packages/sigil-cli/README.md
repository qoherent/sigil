# sigil-cli

Current package version: **1.0.0**.

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): v1 CLI requirements, command behavior, output contracts,
  and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Install the published CLI:

```bash
deno install --global --allow-read --allow-write --name sigil jsr:@sigil/cli@1
```

Local development install:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Implemented responsibilities:

- expose parser output;
- run workspace checks;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Commands:

- `sigil init [path]` creates a config without overwriting;
- `sigil version [path]` reports tool and configured contract versions;
- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON;
- `sigil render ...` returns Markdown.

The CLI returns exit code `0` for success or warnings, `1` for error diagnostics, `2` for usage errors, and `3` for host/runtime failures.
Use JSON output for automation; human text and Markdown are convenience projections.

Run the package tests with:

```bash
deno task test
```
