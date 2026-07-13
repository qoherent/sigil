# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host environment without becoming the shared parser or CLI implementation.

Current integration:

- `codex/sigil-skill`: Codex skill with agent-facing format guidance, standards-aware semantic review, incremental brownfield adoption, proposal and review gates, and implementation colocation.

Proposed integration:

- `codex/sigil-anchor-indexer`: bounded model-assisted anchor proposals over deterministic `sigil-indexer` candidates, with human approval before persistence.

Planned integrations:

- `editor/vscode`: future VS Code extension and editor-native human UI.
