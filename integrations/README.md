# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host
environment without becoming the shared parser or CLI implementation.

Current integrations:

- `skills/sigil`: Codex skill with agent-facing format guidance, standards-aware
  semantic review, incremental brownfield adoption, proposal and review gates,
  and implementation colocation. Version 0.1.0 is distributed as a standalone
  repository skill bundled with native CLI releases and installable globally
  or per project with `sigil skill install`.
- `editor/vscode`: implemented pre-production VS Code extension and
  editor-native human UI with syntax highlighting, bundled LSP features, and
  component previews.

Proposed integration:

- `skills/sigil-anchor-indexer`: bounded model-assisted anchor proposals over
  deterministic `sigil-indexer` candidates, with human approval before
  persistence.
