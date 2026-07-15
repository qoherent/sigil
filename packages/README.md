# Packages

This directory contains buildable or distributable Sigil platform units.
Package docs describe package-level product and implementation responsibilities.

Current packages:

- `sigil-core`: implemented shared parser, workspace loader, resolver, graph, diagnostics, filesystem boundary, and projection logic.
- `sigil-cli`: implemented Deno command-line interface over `sigil-core` with `parse`, `check`, `graph`, `context`, and `render` commands.
- `sigil-indexer`: proposed vNext deterministic source AST indexer and reviewed-anchor subsystem.
- `sigil-lsp`: implemented v1 editor-facing language server over `sigil-core`.

Host-specific adapters belong under `integrations/`, not here.
