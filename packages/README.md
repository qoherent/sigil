# Packages

This directory contains buildable or distributable Sigil platform units.
Package docs describe package-level product and implementation responsibilities.

Current packages:

- `sigil-core`: implemented shared parser, workspace loader, resolver, graph, diagnostics, filesystem boundary, and projection logic.
- `sigil-cli`: implemented Deno command-line interface over `sigil-core` with native GitHub releases and `parse`, `check`, `graph`, `context`, and `render` commands.
- `sigil-lsp`: implemented pre-production editor-facing language server over `sigil-core`.

The `indexer/` directory contains historical design material only. It is not an
active package or configured Sigil workspace member.

Host-specific adapters belong under `integrations/`, not here.
