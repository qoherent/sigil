# Sigil pre-release status

Sigil platform artifacts and Sigil skill 0.7.1 are work-in-progress
pre-production releases over Sigil Language 0.7.0. They do not claim production
readiness or a stable 1.0 contract.

Included contracts:

- Sigil Language 0.7.0;
- `.sigil/config.json` schema 0.7.0;
- `@qoherent/sigil-core` 0.7.1;
- `@qoherent/sigil` 0.7.1;
- standalone host-neutral Sigil skill 0.7.1 with reviewed glossary workflows,
  implementation-component discovery, decision-rationale coverage, correction
  conversations, semantic-readiness gates, coverage review, and proposal-only
  concept-identifier delegation;
- language, configuration, API, migration, workflow, and compatibility
  documentation.

The initial 0.x scope includes `@qoherent/sigil-lsp` 0.7.1 as the shared
editor-neutral language-server boundary over `@qoherent/sigil-core`.

The initial 0.x scope also includes the Sigil VS Code extension 0.7.1 as the
first concrete human authoring and review surface over `@qoherent/sigil-lsp`.

Each contract follows semantic versioning independently. The compatibility
matrix records supported combinations.

Artifact release 0.7.1 intentionally excludes the rejected historical anchors,
Receipts, and `sigil-indexer` implementation, editor integrations other than VS
Code, plugin packaging, semantic search, interactive CLI workflows beyond
explicit formatting, generated diagrams, and persistent approval records. Human approval
is session-scoped.

Pre-release acceptance requires formatting, lint, type checks, core, CLI, LSP,
and VS Code extension tests, skill validation, JSR dry runs, VSIX packaging, and
the documented brownfield pilot to pass.

Native CLI release acceptance also requires all five supported archives to
compile, contain the compatible Sigil skill selected for that release, and be
covered by the published SHA-256 manifest. GitHub-hosted VS Code releases
require a version-matched installable VSIX; Marketplace publication remains
deferred.
