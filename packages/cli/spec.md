# sigil-cli Requirements

**Status:** Language 0.8 migration **Last updated:** 2026-09-15

This document defines the 0.8 product requirements for `sigil-cli`.

`sigil-cli` is the command-line interface over `sigil-core`. It exists for
agents, CI, scripts, debugging, and review/documentation workflows. It is not
the primary human authoring UI.

## 1. Purpose

`sigil-cli` gives users and automation a stable way to inspect, validate, and
extract information from Sigil workspaces.

It should make the shared `sigil-core` model usable from a terminal without
reinterpreting Sigil independently.

## 2. Version 0.8 Scope

Version 0.8 must provide commands to:

- parse one Sigil file;
- check a file or workspace for diagnostics;
- resolve a workspace and expose graph data;
- produce deterministic agent-oriented context output;
- render a simple Markdown review view.
- initialize a non-interactive versioned workspace config;
- report CLI, core, and Sigil versions.
- surface Tag diagnostics and owner-qualified Tag namespaces.
- export the complete structural Design bundle for direct native `sigilc` use.

Version 0.8 should favor predictable, machine-readable behavior over rich
terminal UI.

## 3. Out Of Scope

Version 0.8 must not implement:

- editor UI;
- LSP transport;
- VS Code APIs;
- Codex-specific prompt behavior;
- embeddings or semantic search;
- interactive terminal workflows;
- watch mode;
- generated diagrams;
- anchors or code/spec synchronization;
- mutation of implementation files or automatic source migration. Explicit `fmt`
  remains the supported authored-source formatting command.

The rejected anchor proposal below remains historical and inactive.

## 4. Runtime And Dependency Requirements

The source package is implemented in TypeScript and Deno modules. Standalone
archives ship the compiled `sigil` language CLI beside the native `sigilc`
binary; archive consumers do not need a separately installed TypeScript or
egglog runtime.

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

`--help` at the top level or after any recognized command path must print help
for that path and exit with code `0` without validating required operands,
discovering a workspace, or executing the command. Path-scoped help must show
that path's usage, operands, options, and immediate subcommands.

Empty, unknown, incomplete, or invalid invocations must exit with code `2`,
leave stdout empty, and write both the specific problem and help for the longest
recognized command path to stderr.

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

Warnings alone should not produce exit code `1`. Ungrouped Facets and mixed
ungrouped/Tag-grouped contracts are valid and produce no grouping warning.

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

Catalog and installation results include declared language/tool requirements,
language compatibility, and `runtimeValidation: "not-run"`. The retained legacy
skill requirements remain frozen and incompatible with the new language
toolchain.

### `sigil export design [path]`

Emit raw schema-2 Design JSON for language 0.8.0 without a command envelope.
Preserve original source bytes through strict UTF-8 capture and byte-ranged
structural records. Representable language errors stay in the bundle and exit 1.
Malformed UTF-8 emits no bundle; diagnostics go to stderr and exit 1. Runtime
failures exit 3 without partial transport. Native semantic operations remain
direct `sigilc` invocations by the caller.

### `sigil parse <file>`

Parses one Sigil source file and returns the parsed document plus diagnostics.

Default output should be JSON.

Required output data:

- file path;
- imports;
- components;
- Tag groups, inline definitions, references and links;
- Facets;
- diagnostics with stage, related evidence and original UTF-8 byte ranges.

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

### `sigil fmt [path] [--check]`

Loads the workspace, selects the requested file or included `.sigil` sources
beneath the requested directory, and delegates canonical rendering to
`sigil-core`.

Formatting wraps ordinary prose at 79 content characters without counting
leading indentation. It preserves Facet identity and embedded-content content,
exact Tag recognition and link targets. Width-only diagnostics may be repaired;
any other error prevents writing. Formatting uses the captured provider
vocabulary, then validates all proposed replacements together before writing.

Without `--check`, the command writes only changed selected sources. With
`--check`, it performs no writes and exits `1` when any selected source is
noncanonical. Output identifies formatted, unchanged, noncanonical, and failed
sources. The command does not automatically select the whole repository unless
the user explicitly selects its workspace root.

### `sigil glossary [path]`

Loads the workspace glossary through `sigil-core` and reports its deterministic
projection.

Required output data:

- workspace metadata and glossary path;
- glossary schema version;
- workspace and bounded-context entries;
- resolved context for each loaded Sigil source;
- canonical term, matched spelling, owner, and exact range for each occurrence;
- glossary and workspace diagnostics.

Absence of `.sigil/glossary.json` is successful and reports an absent glossary.
Invalid schema, overlapping contexts, and spelling collisions exit with code
`1`. The command is read-only and does not extract or propose definitions.

### `sigil graph [path]`

Loads and resolves a workspace or target path and emits graph data from
`sigil-core`.

Required output data:

- workspace root;
- file dependency edges;
- selected provider Tag edges and actual reference uses;
- diagnostics.

The command should not generate diagrams in version 0.8.

### `sigil context`

Produces deterministic agent-oriented context data from resolved Sigil.

Version 0.8 should use graph and exact-match signals only.

Supported selectors:

- `--component <name>`;
- `--file <path>`.

Required output data:

- workspace root;
- selected components;
- component contracts;
- complete owner declarations and Facet provenance;
- owner-qualified Tag namespaces;
- related file paths;
- a scoped glossary context containing accepted terms, aliases, definitions,
  resolved bounded contexts, and occurrences from those related files, or `null`
  when GlossaryFile is absent;
- diagnostics.

The scoped glossary context excludes accepted vocabulary that does not occur in
the selected component or file and its direct provider context.

Version 0.8 must not implement embeddings, opaque ranking, or full semantic
search.

### `sigil render [path]`

Produces a simple Markdown review view.

Required output:

- component contracts;
- complete owner declarations and Facet provenance;
- diagnostics summary;
- source file references.

This command is for review and documentation workflows. It is not the primary
human authoring UI.

### `sigil init [path]`

Creates `.sigil/config.json` without prompting. `--name` selects the stable
workspace identifier, while repeated `--include` and `--exclude` options replace
the 0.2 file-rule defaults. The directory basename is the default name. The
command must never overwrite an existing config.

### `sigil version [path]`

Reports CLI and core package versions and—when a workspace resolves—the
workspace name and configured Sigil version.

### `sigil export design [path]`

Use core's `loadDesignInput` to emit the raw closed structural JSON bundle. The
optional path locates the complete workspace; use native `--scope` for focus.
Preserve captured source/config/glossary text and diagnostics without
display-path rewriting or a CLI envelope. Support `--root`, `--pretty` and
`--format json`; reject quiet suppression and non-JSON formats. Language errors
return 1 with the bundle; runtime failures return 3 without partial output.
Export invokes no model or semantic compiler. Use `sigilc` directly for semantic
operations.

The legacy `sigil semantic` group is removed, including beam/accepted-world,
managed-view, retained handoff, receipt and TS7 verification commands.
Invocation returns ordinary invalid usage, with no forwarding or migration
route.

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
- list only config.json, local.json and glossary.json inside metadata
  directories;
- ignore `.git` directories by default.

The adapter should not skip authored `.sigil` files based on package or
integration boundaries. This language CLI performs no semantic artifact writes;
models/operators invoke sigilc directly for preparation, ingestion and gates.

## 10. Acceptance Scenarios

Version 0.8 is acceptable when tests or scripted checks demonstrate that
`sigil-cli` can:

- parse `examples/promise/promise.sigil` and emit JSON;
- check the repository workspace from the mandatory root `.sigil/config.json`;
- resolve `examples/slotted/auth.sigil` imports from the independent Slotted
  workspace root;
- report diagnostics with stable codes;
- return exit code `1` when error diagnostics exist;
- return exit code `0` when only warnings or no diagnostics exist;
- accept ungrouped and mixed Tag-grouped Interface Facets without warnings;
- emit graph JSON with file imports and selected Tag edges;
- emit context JSON for `--component Auth`;
- emit resolved Tag namespaces in context JSON;
- emit each direct provider's complete contracts, selections and actual consumer
  references in context JSON without inferring transitive or runtime
  dependencies;
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

Commands remain non-interactive. Model interaction and orchestration are
external. Init creates missing workspace metadata, fmt explicitly formats
authored source, and skill installation writes the selected skill destinations.
Semantic commands, provider/profile authoring, migrations, compiler events and
runtime doctor are removed, with no forwarding command. Init writes an empty
tools object; normal workspace configuration discovery, validation and version
reporting remain.

## 12. Historical Anchor Command Proposal

The following rejected design is retained for history. Version 0.7 has no
`sigil-indexer` dependency or `anchors` command group.

### `sigil anchors candidates [path] --component <name>`

Read-only. Returns the selected component, collected expansions, Facet locators,
and no more than twenty deterministically ordered TypeScript candidates per
line. Each candidate reports inspectable ordering signals. The command does not
invoke a model.

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
