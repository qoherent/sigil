# sigil-cli Requirements

**Status:** Accepted for 0.1.0 **Last updated:** 2026-07-13

This document defines the 0.1 product requirements for `sigil-cli`.

`sigil-cli` is the command-line interface over `sigil-core`. It exists for
agents, CI, scripts, debugging, and review/documentation workflows. It is not
the primary human authoring UI.

## 1. Purpose

`sigil-cli` gives users and automation a stable way to inspect, validate, and
extract information from Sigil workspaces.

It should make the shared `sigil-core` model usable from a terminal without
reinterpreting Sigil independently.

## 2. Version 0.1 Scope

Version 0.1 must provide commands to:

- parse one Sigil file;
- check a file or workspace for diagnostics;
- resolve a workspace and expose graph data;
- produce deterministic agent-oriented context output;
- render a simple Markdown review view.
- initialize a non-interactive versioned workspace config;
- report CLI, core, and Sigil versions.

Version 0.1 should favor predictable, machine-readable behavior over rich terminal UI.

## 3. Out Of Scope

Version 0.1 must not implement:

- editor UI;
- LSP transport;
- VS Code APIs;
- Codex-specific prompt behavior;
- embeddings or semantic search;
- interactive terminal workflows;
- watch mode;
- generated diagrams;
- anchors or code/spec synchronization;
- mutation or formatting of `.sigil` files.

Anchors remain outside the implemented 0.1 surface. The proposed future anchor
surface is defined below and does not change the 0.1 acceptance criteria.

## 4. Runtime And Dependency Requirements

`sigil-cli` should use Deno TypeScript.

`sigil-cli` must depend on `sigil-core` for:

- parsing;
- workspace discovery;
- import resolution;
- graph construction;
- diagnostics;
- primitive projections.

`sigil-cli` may own:

- argument parsing;
- process exit codes;
- stdout and stderr formatting;
- concrete filesystem adapter for Deno;
- command-specific output shaping.

`sigil-cli` must not duplicate parser, resolver, graph, or diagnostic logic from
`sigil-core`.

## 5. Global Behavior

All commands should support:

- `--root <path>` to supply an explicit workspace root;
- `--format json` for machine-readable output where the command returns
  structured data;
- `--pretty` for human-readable JSON indentation;
- `--quiet` for commands where only exit status matters.

All machine-readable outputs that depend on workspace behavior must include:

- resolved workspace root;
- config path, Sigil version, and workspace name;
- diagnostics;
- command-specific data.

Diagnostic output must include stable diagnostic codes from `sigil-core`.

## 6. Exit Codes

Exit codes should be stable:

- `0`: command completed with no error diagnostics;
- `1`: command completed and found one or more error diagnostics;
- `2`: command usage error, invalid arguments, or unsupported option;
- `3`: host/runtime failure such as unreadable input outside normal Sigil
  diagnostics.

Warnings alone should not produce exit code `1`.

## 7. Commands

### `sigil skill list` and `sigil skill install`

`skill list` enumerates immediate directories containing `SKILL.md` in the
running Sigil installation's `integrations/skills` directory without changing
the filesystem.

`skill install` installs globally by default. Codex, OpenCode, and Pi share
`~/.agents/skills`; Claude Code uses `~/.claude/skills`. `--project` selects the
equivalent locations under the current repository. `--agent` limits the target
to one supported agent.

Project installation creates skill-directory `.gitignore` entries. Existing
unrelated ignore rules are preserved. Installation records managed destinations
so a later selected CLI version can update them while refusing to replace
unmanaged files, directories, or links. Relative directory links are preferred;
a managed copy is used when the host does not permit directory links.

The installed skill source is resolved from the running CLI installation, not
from the target repository. A versioned binary distribution should place the
binary at `<version>/bin/sigil` and its skills at
`<version>/integrations/skills`. Source-based development installs may resolve
the repository's top-level `integrations/skills` directory.

Skill commands accept no positional path beyond `list` or `install` and do not
accept `--root`. CLI workspace discovery does not traverse symlink entries, so
linked project skills are not loaded as duplicate workspace sources.

### `sigil parse <file>`

Parses one Sigil source file and returns the parsed document plus diagnostics.

Default output should be JSON.

Required output data:

- file path;
- imports;
- components;
- expands;
- semantic lines;
- diagnostics.

This command should not load or resolve a full workspace unless a later option
explicitly asks for it.

### `sigil check [path]`

Loads and resolves a Sigil workspace or target path and reports diagnostics.

If `path` is omitted, the command should use the current working directory as
the command target.

Required output data for JSON:

- workspace root;
- config path and selected Sigil version;
- workspace name;
- diagnostic list;
- diagnostic counts by severity.

Default human output may be concise text, but JSON must remain available.

### `sigil graph [path]`

Loads and resolves a workspace or target path and emits graph data from
`sigil-core`.

Required output data:

- workspace root;
- file dependency edges;
- component-to-expansion edges;
- diagnostics.

The command should not generate diagrams in version 0.1.

### `sigil context`

Produces deterministic agent-oriented context data from resolved Sigil.

Version 0.1 should use graph and exact-match signals only.

Supported selectors:

- `--component <name>`;
- `--file <path>`.

Required output data:

- workspace root;
- selected components;
- component contracts;
- collected expansions;
- related file paths;
- diagnostics.

Version 0.1 must not implement embeddings, opaque ranking, or full semantic search.

### `sigil render [path]`

Produces a simple Markdown review view.

Required output:

- component contracts;
- collected expansions;
- diagnostics summary;
- source file references.

This command is for review and documentation workflows. It is not the primary
human authoring UI.

### `sigil init [path]`

Creates `.sigil/config.json` without prompting. `--name` selects the stable
workspace identifier, while repeated `--include` and `--exclude` options replace
the 0.1 file-rule defaults. The directory basename is the default name. The
command must never overwrite an existing config.

### `sigil version [path]`

Reports CLI and core package versions and—when a workspace resolves—the
workspace name and configured Sigil version.

## 8. Output Contracts

JSON output should be stable enough for agents, CI, and snapshot tests.

JSON field names should use camelCase.

JSON output should avoid host-specific absolute paths unless the user supplied
absolute paths.

Human text output should be readable but not treated as a stable API.

Agents and scripts should use JSON output.

## 9. Filesystem Behavior

`sigil-cli` owns the concrete Deno filesystem adapter for `sigil-core`.

The adapter should:

- read text files;
- check path existence;
- list files recursively under the workspace root;
- normalize paths consistently with `sigil-core` expectations;
- ignore `.git` directories by default.

The adapter should not skip `.sigil` files based on package or integration
boundaries.

## 10. Acceptance Scenarios

Version 0.1 is acceptable when tests or scripted checks demonstrate that `sigil-cli` can:

- parse `examples/promise/promise.sigil` and emit JSON;
- check the repository workspace from the mandatory root `.sigil/config.json`;
- resolve `examples/slotted/auth.sigil` imports from the independent Slotted
  workspace root;
- report diagnostics with stable codes;
- return exit code `1` when error diagnostics exist;
- return exit code `0` when only warnings or no diagnostics exist;
- emit graph JSON with file and expansion edges;
- emit context JSON for `--component Auth`;
- render Markdown for the Slotted example;
- avoid duplicating parser or resolver behavior outside `sigil-core`.

## 11. Implementation Notes

The current implementation is a thin CLI with explicit argument parsing, command
handlers, output models, formatting, filesystem adaptation, and exit status
decisions over `sigil-core`.

Keep command modules explicit rather than consolidating behavior into one large
entrypoint as commands grow.

Keep command shaping separate from `sigil-core` data models so the core API
remains reusable by LSP and editor integrations.

Do not add interactive prompts in version 0.1.

## 12. Proposed Future Anchor Commands

After ADR-011 and the AnchorIndexer Sigil contract are approved, the CLI may
depend on `sigil-indexer` and add a nested `anchors` command group.

### `sigil anchors candidates [path] --component <name>`

Read-only. Returns the selected component, collected expansions, semantic-line
locators, and no more than twenty deterministically ordered TypeScript
candidates per line. Each candidate reports inspectable ordering signals. The
command does not invoke a model.

### `sigil anchors check [path]`

Read-only. Loads `.sigil/anchors.json`, validates schema and workspace paths,
and resolves every accepted source target. It returns `resolved`, `changed`,
`ambiguous`, or `missing` for each anchor.

Invalid schema, paths outside the workspace, ambiguity, and missing targets are
error diagnostics. Unique structural changes are warnings. Warnings alone
preserve exit code `0`.

### `sigil anchors apply <proposal-file>`

Mutating and non-interactive. Validates proposal schema, current Sigil and
source fingerprints, target resolution, accepted outcome, duplicates, and
workspace containment before atomically updating `.sigil/anchors.json`.

The command rejects `ambiguous`, `no-match`, stale, or partially invalid input
without writing. Host workflows must obtain explicit human approval before
invocation.

All three commands support `--format json` and `--pretty`. Machine-readable
output includes workspace root, diagnostics, schema version, and command data.
No command calls a model or contains Codex-specific behavior.
