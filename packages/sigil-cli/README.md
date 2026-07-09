# sigil-cli

Command-line interface for agents, CI, scripts, and platform debugging.

The CLI is not the primary human authoring experience. Humans may use it early
for checks and generated artifacts, but editor integrations should become the
main human UI.

Package docs:

- [spec.md](spec.md): v1 CLI requirements, command behavior, output contracts,
  and acceptance scenarios.
- [architecture.md](architecture.md): command architecture, module boundaries,
  dependency rules, and implementation guidelines.

Local install for use from an installed Codex skill:

```bash
deno task install
```

This installs a `sigil` command that can be discovered on `PATH`.

Planned responsibilities:

- expose parser output;
- run workspace checks;
- produce agent-oriented context packs;
- render Markdown for review and documentation workflows;
- keep CLI behavior thin over `sigil-core`.

Initial command candidates:

- `sigil parse <path>` returns parsed JSON;
- `sigil check [path]` returns diagnostics;
- `sigil graph [path]` returns component and import graph data;
- `sigil context ...` returns agent context JSON;
- `sigil render ...` returns Markdown.
