# Integrations

This directory contains the editor integration for Sigil.

- `editor/vscode`: implemented pre-production VS Code extension and
  editor-native human UI with syntax highlighting, bundled LSP features, and
  component previews.

The Sigil agent skills live in the repository's root [`skills/`](../skills)
folder, not here. Every supported coding agent reads that folder through its own
plugin system; see the [install guides](../docs/install/README.md).
