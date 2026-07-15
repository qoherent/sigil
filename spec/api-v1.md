# Sigil 1.0 API

## Core

`@qoherent/sigil-core` exports immutable model types and these main operations:

- `parseSigilConfig(source, filePath?)` validates config schema and supported
  versions;
- `parseSigilDocument(filePath, source, { sigilVersion })` parses one source
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

Workspace JSON includes `workspaceRoot`, `configPath`, `sigilVersion`,
`workspaceName`, diagnostics, and command data. `parse` returns
`document: null` when configuration prevents parsing.

Exit codes are 0 for success or warnings, 1 for configuration/Sigil errors, 2
for usage, and 3 for host failures.

## LSP

`@qoherent/sigil-lsp` 0.1.0 implements Language Server Protocol 3.18 over standard input
and output. It provides lifecycle handling, full-document synchronization,
overlay-backed workspace resolution, diagnostics, hierarchical document
symbols, definition navigation, Markdown hover content, and full-document
semantic tokens for resolver-backed component names.

The server advertises UTF-16 positions and uses `@qoherent/sigil-core` for all Sigil
parsing, configuration, workspace, import, component, expansion, and diagnostic
semantics. Its first release supports file URIs and one selected workspace.
