# Sigil 0.2 API

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
- `resolveSigilWorkspace(workspace)` resolves explicit-file and directory-index
  imports, components, expansions, and graph projections;
- `componentContracts` and `collectedExpansionFor` expose reusable projections.

Workspace results expose `root`, `configPath`, `config`, declared `memberRoots`,
files, and diagnostics. A `#module.sigil` may appear in any included directory.
Directory imports resolve local declarations and successfully resolved direct
imports from that index. Every component remains public through its explicit
`.sigil` source path.

Resolved import names expose the component declaration and its original file.
Graph file edges target the immediate imported file or module index, while
imported-component edges target the original component declaration file.

Sigil source/config problems are diagnostics. Filesystem inability propagates to
the host.

## CLI

Workspace JSON includes `workspaceRoot`, `configPath`, `sigilVersion`,
`workspaceName`, diagnostics, and command data. `parse` returns `document: null`
when configuration prevents parsing.

Exit codes are 0 for success or warnings, 1 for configuration/Sigil errors, 2
for usage, and 3 for host failures.

## LSP

`@qoherent/sigil-lsp` 0.2.0 implements Language Server Protocol 3.18 over
standard input and output. It provides lifecycle handling, full-document
synchronization, overlay-backed workspace resolution, diagnostics, hierarchical
document symbols, definition navigation, Markdown hover content, and
full-document semantic tokens for resolver-backed component names.

Definition navigation through a directory module index opens the component's
original declaration file. The server uses `@qoherent/sigil-core` for all Sigil
parsing, configuration, workspace, import, component, expansion, and diagnostic
semantics.
