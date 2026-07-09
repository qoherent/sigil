# Sigil Open Questions

This file tracks unresolved language and workflow decisions.

## Language

- Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?
- Should `#module.sigil` remain the root filename?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?
- Should Sigil introduce a project configuration file or marker to define the workspace root for `@` imports?
- Should imports support aliases, re-exports, wildcard imports, or cycle detection rules?

## Project Organization

- Should each product module own a root `.sigil` file, or only colocated component and expand files as needed?
- How should shared abstractions be placed when they do not have one obvious implementation location?
- Should root-level Sigil describe the whole product, the deployable unit, or the current bounded context?

## Tooling

- Should the first parser validate only top-level form and section shape?
- What stable addressing scheme should anchors use for semantic lines?
- Should Sigil tooling support generated diagrams or dependency maps?
- How should anchors identify stable Sigil semantic lines as files are edited?
- Should anchors be stored outside `.sigil` files, generated from code, or reviewed as part of the repository?
- What should tooling do when anchored code changes but the corresponding Sigil line does not?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should rejected or superseded Sigil decisions be preserved?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
