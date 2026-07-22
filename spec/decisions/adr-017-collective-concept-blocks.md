# ADR-017: Collective Concept Blocks

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-22

## Context

A concept may affect several parts of a component contract. Its public meaning,
state, behavior, constraints, and cases belong in different Sigil sections, and
implementation-specific detail may be distributed across matching expand
declarations.

Requiring all content for a concept to live in one block would either collapse
section meanings or prevent a concept from being reused throughout the
contract.

## Decision

Concept blocks with the same resolved identifier are collective within one
component context.

The component declaration and every matching expand share one concept
namespace. Repeating an identifier in their sections reuses the same concept
identity. Every occurrence contributes semantic lines without overriding or
shadowing another occurrence.

```sigil
component Account {
  interface {
    Session {
      Represents authenticated access.
    }
  }
}

expand Account {
  state {
    Session {
      Pending

      Active
    }
  }

  cases {
    Session {
      Closing an active session makes it unavailable.
    }
  }
}
```

The three `Session` blocks retain their interface, state, and cases locations
while resolving to one concept identity.

Imported concept reuse remains contextual under ADR-016. Collective blocks in
an importing component do not add their content to the provider's upstream
contract.

## Reasons

- One reusable concept may have public, stateful, behavioral, policy, and case
  dimensions.
- Section meanings remain disciplined instead of being collapsed into a new
  concept-specific section model.
- Matching expands can add implementation rationale without redeclaring or
  replacing the concept.
- Preserving every occurrence supports source-aware review and editor features.

## Consequences

- Core retains a concept identity separately from its ordered source
  occurrences.
- Projections collect every applicable occurrence while preserving component,
  expand, section, file, and source-range information.
- LSP hover and context views may present a concept grouped by section and
  source.
- Contradictory collective content is a semantic-review issue rather than an
  override rule.
- Removing one occurrence does not remove the concept while other occurrences
  remain in the same component context.

## Alternatives Considered

### One block per concept

Rejected because it would prevent section-specific reuse or force unrelated
section meanings into one block.

### Later blocks override earlier blocks

Rejected because file order and expand order should not silently change a
concept's meaning.

### Each block creates a new identity

Rejected because repeated identifiers are intended to group and reuse the same
concept throughout the contract.

## Revisit Conditions

Revisit this decision if collective occurrences cannot be presented clearly,
or if practical authoring shows that repeated blocks create contradictions that
cannot be handled through normal semantic review.
