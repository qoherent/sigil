# Sigil pre-release status

Sigil 0.2.0 is a work-in-progress pre-production release of the language,
platform, and agent workflow. It does not claim production readiness or a
stable 1.0 contract.

Included contracts:

- Sigil Language 0.2.0;
- `.sigil/config.json` schema 0.2.0;
- `@qoherent/sigil-core` 0.2.0;
- `@qoherent/sigil` 0.2.0;
- standalone Codex Sigil skill 0.2.0 with implementation-component discovery
  and coverage review;
- language, configuration, API, migration, workflow, and compatibility
  documentation.

The initial 0.x scope includes `@qoherent/sigil-lsp` 0.2.0 as the shared
editor-neutral language-server boundary over `@qoherent/sigil-core`.

The initial 0.x scope also includes the Sigil VS Code extension 0.2.0 as the
first concrete human authoring and review surface over `@qoherent/sigil-lsp`.

Each contract follows semantic versioning independently. The compatibility
matrix records supported combinations.

Version 0.2.0 intentionally excludes anchors and `sigil-indexer` implementation,
editor integrations other than VS Code, plugin packaging, semantic search,
interactive CLI workflows, `.sigil` mutation, generated diagrams, and
persistent approval records. Human approval is session-scoped.

Pre-release acceptance requires formatting, lint, type checks, core, CLI, LSP, and
VS Code extension tests, skill validation, JSR dry runs, VSIX packaging, and the
documented brownfield pilot to pass.

Native CLI release acceptance also requires all five supported archives to
compile, contain the version-matched Sigil skill, pass SHA-256 verification, and
run a native executable smoke test. GitHub-hosted VS Code releases require a
version-matched installable VSIX; Marketplace publication remains deferred.
