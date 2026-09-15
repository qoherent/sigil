# Sigil Open Questions

> Historical 0.7 planning context. For current 0.8 authoring and implementation,
> use the [language guide](sigil-language.md), [reference](sigil-reference.md),
> [migration guide](migrating-to-0.8.md) and colocated component contracts.
> Legacy expand, visibility and directory-index descriptions below are not
> current language rules.

This file tracks unresolved language and workflow decisions.

## Language

- Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?
- Should imports support aliases, re-exports, or wildcard imports beyond the implemented cycle diagnostics?

## Project Organization

- How should shared abstractions be placed when they do not have one obvious implementation location?

## Platform

- Which additional semantic checks, if any, should move from host integrations into deterministic core diagnostics?
- Should Sigil platform packages support generated diagrams or dependency maps?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should superseded Sigil decisions be preserved beyond the rationale and
  discarded alternatives retained in `decisions`?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
- How should evidence from brownfield reconciliation remain traceable without becoming Sigil syntax?
- Should standards sources remain in review summaries or gain a durable repository representation?
- How should external hosts assess reconstruction fidelity while preserving the native three-input Implementation boundary?
- How should a host turn a native Design `Disjoint` report and its assertion
  provenance into a user-facing correction conversation with impact and concrete
  resolution options?

The rejected Receipt, anchor, and generated evidence-record architecture is
preserved for historical analysis in
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
