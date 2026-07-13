# Sigil Open Questions

This file tracks unresolved language and workflow decisions.

## Language

- Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?
- Should `#module.sigil` remain the workspace root marker after project configuration exists?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?
- Should Sigil introduce `sigil.config` or another project configuration file to replace or override `#module.sigil` as the workspace root marker?
- Should imports support aliases, re-exports, or wildcard imports beyond the implemented cycle diagnostics?

## Project Organization

- Should each product module own a nested `#module.sigil` file, or only colocated component and expand files as needed?
- How should shared abstractions be placed when they do not have one obvious implementation location?
- Should workspace-root Sigil describe the whole product, the deployable unit, or the current bounded context?

## Platform

- Which additional semantic checks, if any, should move from host integrations into deterministic core diagnostics?
- Should Sigil platform packages support generated diagrams or dependency maps?
- Which source-language adapter should follow the proposed TypeScript anchor adapter?
- How should non-AST targets such as SQL migrations and generated artifacts be indexed?
- Should anchor checks offer a strict CI mode that fails on structurally changed targets?
- How should editors display many-to-many anchor relationships?
- When should obsolete anchor evidence be removed rather than retained?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should rejected or superseded Sigil decisions be preserved?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
- How should evidence from brownfield reconciliation remain traceable without becoming Sigil syntax?
- Should standards sources remain in review summaries or gain a durable repository representation?
- How should multiple hosts produce comparable semantic-readiness findings without sharing one model or prompt?

The broader readiness and model-boundary questions are tracked in [ADR-009](decisions/adr-009-sigil-readiness-and-model-boundary.md).
The proposed anchor architecture and its deferred questions are tracked in [ADR-010](decisions/adr-010-ast-anchors-and-model-assisted-indexing.md).
