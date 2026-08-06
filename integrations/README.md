# Integrations

This directory contains host-specific adapters for Sigil.

Integrations adapt the Sigil language, workflow, or platform to a host
environment without becoming the shared parser or CLI implementation.

Current integrations:

- `skills/sigil`: host-neutral coding-agent skill with format guidance,
  standards-aware semantic review, incremental brownfield adoption, proposal and
  review gates, concept-identifier proposal workflow, and implementation
  colocation. Version 0.7.1 is distributed as a standalone repository skill
  bundled with native CLI releases and installable globally or per project with
  `sigil skill install`.
- `editor/vscode`: implemented pre-production VS Code extension and
  editor-native human UI with syntax highlighting, bundled LSP features, and
  component previews.

Rejected historical design material:

- `skills/sigil-anchor-indexer`: a rejected proposal for bounded model-assisted
  anchor proposals over deterministic indexer candidates. Its Markdown is
  retained for design history but it has no active Sigil contract.
