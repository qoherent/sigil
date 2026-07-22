# ADR-014: Public Contracts And Nonempty Module Indexes

**Status:** Accepted

**Owner:** Sigil maintainers

**Last updated:** 2026-07-22

## Context

Sigil 0.2 allowed an internal `#module.sigil` to contain only imports. Such an
index provided path shorthand without describing any responsibility owned by
its directory. This weakened the rationale-oriented purpose of the special
filename and allowed a module surface with no local public contract.

The 0.2 wording also described `interface` broadly enough that authors repeated
imported dependencies or placed implementation-hiding rules beside public
operations. It did not state as directly as needed that `goal` is public too.

Dense consecutive prose lines were valid but made longer sections harder to
scan. Blank lines already had no semantic meaning and could therefore provide a
consistent readability convention without changing parser structure.

## Decision

Sigil 0.3.0 requires every `#module.sigil` to declare at least one local
component. Imports and expands remain allowed, and directly imported component
names still contribute to the directory-import surface. An index without a
local component produces `SIGIL_MODULE_WITHOUT_COMPONENT` while retaining its
partial parsed document.

A component's `goal` and `interface` are both public to its dependents. The
`goal` states the public purpose, responsibility, and intended outcome. The
`interface` contains only operations, data, events, results, errors, and
observable promises publicly available to dependents.

Imports are the sole declarations of component dependencies. Authors do not
repeat imported-component dependencies in `interface`.

Implementation-hiding rules and forbidden internal access belong in
`constraints` unless they define an externally observable promise.

Authors separate distinct prose-level ideas with blank lines in every section.
Blank lines remain non-semantic. Lines belonging to one compact free-form
construct, such as a type shape or ASCII diagram, may remain adjacent.

## Consequences

- Existing imports-only module indexes must gain a meaningful local component
  or stop using the `#module.sigil` filename.
- Directory imports retain the 0.2 resolution surface after the local-component
  requirement is satisfied.
- Tools gain one stable parser diagnostic for component-free module indexes.
- Public contracts become smaller because dependencies and private architecture
  rules move to imports and expands.
- Existing Sigil may be reformatted with blank lines without changing semantic
  lines or collected meaning.
- The language, core, CLI, LSP, VS Code extension, and skill advance to 0.3.0.

## Acceptance Scenarios

- A `#module.sigil` containing only imports produces
  `SIGIL_MODULE_WITHOUT_COMPONENT`.
- A `#module.sigil` with a local component and direct imports remains valid and
  exposes both sets of names through directory-import shorthand.
- Importing a component declares the dependency without an interface line that
  says `depends on` or `uses`.
- A password-storage privacy rule belongs in `constraints`, while a promise
  that password hashes are never returned may belong in `interface`.
- Blank lines between prose-level ideas do not add semantic lines.
