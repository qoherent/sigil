# ADR-015: Flat Concept Identifier Namespace

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-22

## Context

Sigil concept identifiers group one or more related semantic lines under a
reusable name. A component and all of its matching expands share one concept
namespace. Importing a component makes the concepts exposed by its interface
available as bare identifiers.

Allowing one concept block to contain another would introduce hierarchical
concept identities. Those identities would require either dotted references or
implicit rules for resolving nested names through imports. Both choices would
make concept reuse and namespace diagnostics harder to understand.

## Decision

Concept blocks are flat and cannot contain other concept blocks.

Each concept identifier belongs directly to the shared namespace of its
component and matching expands. An imported public concept is available by its
bare identifier without component qualification or dotted notation.

Related concepts that require independent reuse use separate concise
identifiers rather than nested blocks.

```sigil
interface {
  SessionLifecycle {
    open(credentials) returns Session.

    close(sessionId).
  }

  Session {
    Represents authenticated access.
  }
}
```

This nested form is invalid:

```sigil
interface {
  SessionLifecycle {
    Opening {
      open(credentials) returns Session.
    }
  }
}
```

## Reasons

- Sigil should not require dotted notation such as
  `SessionLifecycle.Opening` or `Account.Session`.
- A flat namespace keeps imported concepts available as simple bare names.
- Flat identities make reuse across interface, state, logic, constraints, and
  cases consistent.
- Ambiguous identifiers can be diagnosed directly instead of resolved through
  shadowing or qualification rules.
- Avoiding hierarchy keeps concept highlighting, navigation, and authoring
  behavior understandable.

## Consequences

- Concept blocks cannot express parent-child ownership structurally.
- Authors use separate concise names when two related ideas need independent
  identities.
- A component cannot resolve collisions through nesting, dotted qualification,
  or local shadowing; conflicting concepts must be renamed.
- Core, CLI, and LSP diagnostics must reject nested concept blocks.
- The language remains free to group multiple semantic lines inside one flat
  concept block.

## Alternatives Considered

### Nested concepts with dotted references

Rejected because it would introduce the dotted notation this decision intends
to avoid and would complicate imported namespace resolution.

### Nested concepts with bare leaf names

Rejected because identical leaf names under different parents would be
ambiguous after import and would require hidden qualification or shadowing
rules.
