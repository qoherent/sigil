# sigil-cli Architecture

**Status:** Draft **Owner:** _TBD_ **Last updated:** 2026-07-09

This document defines the architecture style, internal modules, dependency
rules, and implementation guidelines for `sigil-cli`. Product requirements live
in [spec.md](spec.md). Platform-wide boundaries live in
[../../spec/sigil-platform-architecture.md](../../spec/sigil-platform-architecture.md).

## 1. Architecture Style

`sigil-cli` uses a thin command adapter architecture over `sigil-core`.

The main flow is:

```text
parse argv -> create command request -> call sigil-core -> shape output -> write stdout/stderr -> choose exit code
```

Command modules may shape output for agents, CI, scripts, and review workflows.
They must not reinterpret Sigil syntax, imports, graph edges, diagnostics, or
collected expansions independently.

## 2. Design Principles

- Keep command behavior predictable and scriptable.
- Prefer JSON as the stable automation interface.
- Treat human text output as convenience, not API.
- Keep command modules thin over `sigil-core`.
- Keep Deno filesystem and process APIs at the outer edge.
- Never mutate `.sigil` files in version 0.4.
- Keep CLI behavior deterministic and non-interactive.

## 3. Internal Modules

### `main`

Owns the executable entrypoint.

Responsibilities:

- receive `Deno.args`;
- invoke argument parsing;
- dispatch commands;
- write stdout and stderr;
- set process exit code.

Rules:

- may depend on `args`, `commands`, `output`, and `exit`;
- must not parse Sigil files directly;
- must not contain command-specific business logic.

### `args`

Owns command-line argument parsing.

Responsibilities:

- parse command names;
- parse global flags such as `--root`, `--format`, `--pretty`, and `--quiet`;
- parse command-specific selectors such as `--component` and `--file`;
- validate usage;
- produce typed command request objects.

Rules:

- must not call `sigil-core`;
- must not read files;
- must not write output.

### `commands`

Owns command handlers.

Responsibilities:

- implement `skill list`, `skill install`, `parse`, `check`, `graph`, `context`, and `render`;
- call `sigil-core` through shared helpers;
- return typed command result objects;
- avoid command-specific duplication of parser and resolver behavior.

Rules:

- may depend on `args`, `core-adapter`, `installer`, `output-model`, and `exit`;
- must not write directly to stdout or stderr;
- must not directly call Deno filesystem APIs.

### `core-adapter`

Owns the boundary between command handlers and `sigil-core`.

Responsibilities:

- create the concrete Deno filesystem adapter;
- call `sigil-core` parse, workspace, resolver, graph, and projection APIs;
- normalize command targets before passing them to core;
- keep command handlers from knowing core setup details.

Rules:

- may depend on `sigil-core`;
- may depend on `fs-adapter`;
- must not render human output.

### `installer`

Owns global and repository-local installation of version-owned agent skills.

Responsibilities:

- resolve `integrations/skills` from the running source or binary installation;
- enumerate immediate directories containing `SKILL.md`;
- map Codex, Claude Code, OpenCode, and Pi to their global or project locations;
- prefer host-native relative directory links and fall back to managed copies;
- preserve or update managed installations and reject unmanaged conflicts;
- create or extend project-local skill `.gitignore` files.

Rules:

- may use Deno filesystem APIs and host-native path operations;
- must resolve sources from the selected Sigil installation, not the target;
- may inspect only the presence of the `SKILL.md` entrypoint;
- must not overwrite unrelated target files or symlinks.

### `fs-adapter`

Owns concrete Deno filesystem behavior.

Responsibilities:

- implement the `sigil-core` filesystem port;
- read text files;
- test path existence;
- recursively list files under a root;
- skip `.git` directories by default;
- normalize paths consistently with `sigil-core`.

Rules:

- may use Deno filesystem APIs;
- must not parse or resolve Sigil;
- must not apply package or integration filtering to `.sigil` files.

### `output-model`

Owns command result shapes.

Responsibilities:

- define JSON output contracts for each command;
- define diagnostic count summaries;
- define context and render result shapes;
- keep command outputs stable enough for agents and CI.

Rules:

- may depend on `sigil-core` model types;
- must not perform IO;
- must not parse command arguments.

### `formatters`

Owns serialization and human-readable formatting.

Responsibilities:

- serialize JSON with optional pretty printing;
- format concise human diagnostics for `check`;
- format Markdown for `render`;
- avoid making human text the stable API.

Rules:

- may depend on `output-model`;
- must not call `sigil-core`;
- must not inspect source files directly.

### `exit`

Owns process status decisions.

Responsibilities:

- map command result diagnostics to exit code `0` or `1`;
- map usage errors to exit code `2`;
- map host/runtime failures to exit code `3`;
- preserve the rule that warnings alone do not fail.

Rules:

- may depend on output result and diagnostics types;
- must not perform IO;
- must not call `sigil-core`.

### `testing`

Owns CLI test helpers.

Responsibilities:

- invoke command handlers without spawning subprocesses when possible;
- capture stdout, stderr, and exit code;
- provide fixture helpers;
- assert JSON output contracts and exit behavior.

Rules:

- may depend on all CLI modules;
- must not become a runtime dependency of production modules.

## 4. Dependency Direction

Allowed dependency direction:

```text
main
  -> args
  -> commands
  -> core-adapter
  -> fs-adapter
  -> sigil-core

commands
  -> output-model
  -> exit

formatters
  -> output-model
```

More explicitly:

- `args` must be independent from `sigil-core`.
- `fs-adapter` may depend on Deno APIs and `sigil-core` filesystem types.
- `core-adapter` may depend on `sigil-core` and `fs-adapter`.
- `commands` may depend on `core-adapter`, `output-model`, and `exit`.
- `formatters` may depend on `output-model`.
- `main` coordinates modules and owns process IO.
- `testing` may depend on any CLI module.

Forbidden dependencies:

- command handlers must not duplicate parser or resolver logic;
- command handlers must not directly use Deno filesystem APIs;
- formatters must not call `sigil-core`;
- `args` must not call `sigil-core`;
- no module may depend on Codex skill files;
- no module may depend on VS Code APIs;
- no module may depend on LSP transport.

## 5. Command Guidelines

Each command should have:

- a typed request shape;
- a typed result shape;
- one handler function;
- JSON output support;
- clear exit-code behavior;
- tests for success and diagnostic cases.

Commands should keep option behavior boring and explicit.

Do not add interactive prompts in version 0.4.

Do not add mutation or formatting commands in version 0.4.

## 9. Proposed Future Anchor Extension

After ADR-011 approval, `sigil-cli` may depend on `sigil-indexer` through a
separate `indexer-adapter`. Existing Sigil parsing and resolution continue
through `core-adapter`.

```text
anchors argv -> anchors command handler -> indexer-adapter -> sigil-indexer
                                              |
                                              -> fs-adapter atomic sidecar write
```

Rules:

- `args` parses the nested `anchors candidates`, `anchors check`, and `anchors apply` requests;
- anchor command handlers shape results but do not parse ASTs or reconcile locators;
- `indexer-adapter` connects the Deno filesystem, resolved Sigil workspace, and `sigil-indexer`;
- only `anchors apply` may write, and it may write only `.sigil/anchors.json`;
- the write uses a temporary sibling plus atomic rename after complete validation;
- no CLI module invokes a model, imports a Codex skill, or interprets proposal evidence;
- existing 0.2 commands and exit behavior remain backward compatible.

## 6. Output Guidelines

JSON is the stable output contract.

Human text output is allowed but should remain concise.

JSON field names should use camelCase.

Workspace-based JSON outputs should include:

- `workspaceRoot`;
- `configPath`, `sigilVersion`, and `workspaceName`;
- `diagnostics`;
- command-specific data.

Diagnostics must include stable `sigil-core` codes.

Human output may summarize diagnostics, but agents and scripts should use JSON.

## 7. Error Guidelines

Sigil source problems should normally flow through `sigil-core` diagnostics.

Usage problems belong to the CLI and should produce exit code `2`.

Host/runtime failures belong to the CLI and should produce exit code `3`.

Warnings alone should not produce a failing exit code.

## 8. Testing Guidelines

CLI tests should cover command handlers directly where possible.

Subprocess tests may be added for final binary behavior but should not be the
only coverage.

Required scenarios:

- `parse` emits JSON for `examples/promise/promise.sigil`;
- `check` returns `0` for a valid workspace;
- `check` returns `1` for error diagnostics;
- `check` does not return `1` for warnings alone;
- `graph` emits file and expansion edges;
- `context --component Auth` emits deterministic context data;
- `render` emits Markdown for the Slotted example;
- invalid arguments return exit code `2`;
- runtime filesystem failures return exit code `3`;
- JSON output includes stable diagnostic codes.

Tests should snapshot JSON shapes only after the output contract is
intentionally stable.
