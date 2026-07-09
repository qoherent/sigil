# Sigil Open Questions

This file tracks unresolved language and workflow decisions.

## Language

- Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?
- Should `#module.sigil` remain the workspace root marker after project configuration exists?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?
- Should Sigil introduce `sigil.config` or another project configuration file to replace or override `#module.sigil` as the workspace root marker?
- Should imports support aliases, re-exports, wildcard imports, or cycle detection rules?

## Project Organization

- Should each product module own a nested `#module.sigil` file, or only colocated component and expand files as needed?
- How should shared abstractions be placed when they do not have one obvious implementation location?
- Should workspace-root Sigil describe the whole product, the deployable unit, or the current bounded context?

## Platform

- Should the first parser validate only top-level form and section shape?
- What stable addressing scheme should anchors use for semantic lines?
- Should Sigil platform packages support generated diagrams or dependency maps?
- How should anchors identify stable Sigil semantic lines as files are edited?
- Should anchors be stored outside `.sigil` files, generated from code, or reviewed as part of the repository?
- What should platform packages do when anchored code changes but the corresponding Sigil line does not?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should rejected or superseded Sigil decisions be preserved?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
