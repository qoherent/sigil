# ADR-016: Contextual Imported Concept Reuse

**Status:** Accepted

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-22

## Context

Importing a Sigil component makes the concepts exposed by its interface
available as bare identifiers. An importing component may reuse one of those
identifiers in its own sections and may re-expose the concept by using it in
its interface.

The language must define whether an importing component's concept content
becomes part of the provider's contract globally or remains contextual to the
importing component. Global collection would make a provider's projected
contract depend on its consumers and reverse the declared dependency direction.

## Decision

Reuse of an imported concept is contextual to the importing component.

The reused concept retains its originating identity, while semantic lines added
by the importer describe that importer's use of the concept. They do not extend
or modify the provider's contract upstream.

```sigil
component Account {
  interface {
    Session {
      Represents authenticated access.
    }
  }
}
```

```sigil
@auth import { Account }

component Dashboard {
  interface {
    Session {
      Displays the active session.
    }
  }
}
```

In this example:

- `Account` originates the `Session` identity;
- `Dashboard` reuses and re-exposes that identity;
- Account context excludes Dashboard's semantic line;
- Dashboard context includes the imported Account concept and Dashboard's use;
- a downstream importer of Dashboard receives the same `Session` identity
  through Dashboard.

## Reasons

- Dependency information should flow from providers to consumers, not backward
  from consumers into provider contracts.
- A provider's context should remain stable when a new consumer is added.
- Reuse should preserve identity without merging unrelated consumer behavior
  into the originating component.
- Downstream tools still need to explain how the current component uses an
  imported concept.

## Consequences

- Concept projections are contextual rather than one workspace-global merge of
  every occurrence with the same identity.
- Core resolution must retain both the originating identity and each contextual
  occurrence.
- Context and hover projections distinguish originating contract content from
  importer-specific use.
- Re-exposure through an interface carries the same concept identity and the
  current component's public contextual content downstream.
- Adding or changing a consumer does not change the provider's projected
  contract.

## Alternatives Considered

### Globally collect every occurrence

Rejected for now because consumer-specific lines would appear in provider
context and reverse dependency flow.

### Create a new local identity on every reuse

Rejected because it would defeat concept identity reuse and prevent downstream
tools from recognizing that the contracts refer to the same concept.

### Require qualified imported concepts

Rejected because Sigil intentionally exposes imported interface concepts as
bare identifiers and avoids dotted notation.

## Revisit Conditions

Revisit this decision if contextual projections cannot explain multi-hop
interface exposure clearly, or if a future language feature introduces an
explicit and reviewable way to extend a provider-owned concept.
