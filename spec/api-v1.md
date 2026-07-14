# Sigil 1.0 API

## Core

`@sigil/core` exports immutable model types and these main operations:

- `parseSigilConfig(source, filePath?)` validates config schema and supported
  versions;
- `parseSigilDocument(filePath, source, { languageVersion })` parses one source
  explicitly;
- `discoverSigilWorkspace(filesystem, options)` selects and validates one root
  config;
- `loadSigilWorkspace(filesystem, options)` applies discovery globs and parses
  matching files;
- `resolveSigilWorkspace(workspace)` resolves imports, components, expansions,
  and graph projections;
- `componentContracts` and `collectedExpansionFor` expose reusable projections.

Workspace results expose `root`, `configPath`, `config`, declared
`memberRoots`, files, and diagnostics. The workspace root identifies the root
project; `memberRoots` contains only roots declared by `workspace.members`.
Graph results expose component nodes, file edges, imported-component edges, and
component-expansion edges. Resolved expansion entries include their source file.

`SIGIL_INVALID_ROOT_MODULE` reports `#module.sigil` outside a project or
declared workspace-member root. `SIGIL_INVALID_DIRECTORY_IMPORT` reports a
directory import to such an invalid location.

Sigil source/config problems are diagnostics. Filesystem inability propagates to
the host.

## CLI

Workspace JSON includes `workspaceRoot`, `configPath`, `configVersion`,
`languageVersion`, `workspaceName`, diagnostics, and command data. `parse` returns
`document: null` when configuration prevents parsing.

Exit codes are 0 for success or warnings, 1 for configuration/Sigil errors, 2
for usage, and 3 for host failures.
