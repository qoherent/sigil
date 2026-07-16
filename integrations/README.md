# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host environment without becoming the shared parser or CLI implementation.

Current integration:

- `skills/sigil`: Codex skill with agent-facing format guidance, standards-aware semantic review, incremental brownfield adoption, proposal and review gates, and implementation colocation.
  Version 0.1.0 is distributed as a standalone repository skill and can be installed from its GitHub path with `$skill-installer`.

Proposed integration:

- `skills/sigil-anchor-indexer`: bounded model-assisted anchor proposals over deterministic `sigil-indexer` candidates, with human approval before persistence.

Planned integrations:

- `editor/vscode`: future VS Code extension and editor-native human UI.
