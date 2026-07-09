# Sigil Open Questions

This file tracks unresolved language and workflow decisions.

## Language

- Should reusable components expose only `component`, or can other components explicitly depend on collected `expand` details?
- Should `#module.sigil` remain the root filename?
- How strict should future parsing and validation become while preserving authoring speed?
- How should conflicts between collected expands be represented, detected, and resolved?

## Project Organization

- How should projects organize Sigil files as they grow?
- Should each product module own its own `.sigil` file?
- Should shared abstractions live beside their implementation or in a central specification folder?
- Should root-level Sigil describe the whole product, the deployable unit, or the current bounded context?

## Tooling

- Should the first parser validate only top-level form and section shape?
- Should semantic lines become addressable source locations for review comments and implementation traces?
- Should Sigil tooling support generated diagrams or dependency maps?
- Should future tooling detect code/spec drift automatically?

## Workflow

- How should approved Sigil be marked?
- Should implementation sessions record which Sigil version they used?
- How should rejected or superseded Sigil decisions be preserved?
- Should the Codex skill update implementation plans from Sigil automatically, or only after explicit user approval?
