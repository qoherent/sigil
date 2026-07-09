# Packages

This directory is reserved for buildable or distributable Sigil platform units.
Package docs describe package-level product and implementation responsibilities.

Planned packages:

- `sigil-core`: shared parser, resolver, graph, diagnostics, and projection logic.
- `sigil-cli`: command-line interface over `sigil-core`.
- `sigil-lsp`: future editor-facing language server over `sigil-core`.

Host-specific adapters belong under `integrations/`, not here.
