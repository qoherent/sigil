# Interpreting a compact design

## Establish the meaning

Read the selected component and the context that can change its interpretation.
A component owns a responsibility and all its contracts. A **Facet** is an
authored contribution: retain its source anchor, component owner, and contract
role even when it refers to imported vocabulary.

| Contract | Read it as |
| --- | --- |
| `goal` | Purpose, responsibility, and intended outcomes. |
| `interface` | Offered interactions and observable promises. |
| `state` | Meaningful data, modes, and conditions. |
| `logic` | Behavior, flows, guards, and transitions. |
| `constraints` | Binding invariants, prohibitions, bounds, and architecture choices. |
| `decisions` | Rationale, assumptions, alternatives, trade-offs, and revisit conditions. |
| `cases` | Starting situations, actions, and expected observations in examples or families. |

Goal and Interface require content. Other contracts are optional. Rationale does
not convert a rejected alternative or unaccepted proposal into a commitment.
A binding technology or architecture choice belongs in Constraints. A case does
not silently quantify over all inputs. Section order does not override another
contribution; compatible reuse is additive and contradictions remain visible.

## Resolve identity without inventing architecture

An inline `*Tag name*` or a grouping heading introduces a component-owned Tag.
A grouping heading may reuse a local identity; an exact name permits only one
inline definition in its owner. Bare eligible prose refers to accessible Tags.
Multiword names compare exactly on one physical line: do not collapse internal
spaces, change case, or split a name when explaining or revising it. Consult the
[normative Tag rules](language/sigil-reference.md#tags-and-references) for delimiter
boundaries, recognition regions, collisions, and overlapping names.

`@path.sigil from Component import { query, search results }` selects exactly
those Tags from their owner in an explicit workspace-root-relative file. Every
selected Tag needs an eligible prose reference somewhere in the importing
source. All components in that source see its imports; another component's
unimported local Tags are not automatically accessible. All owner contracts can
supply selected Tags: there is no public/private contract namespace. Imports do
not introduce provider namespaces, re-export identities, transfer Facet
ownership, or establish a runtime call. `_module.sigil` is an ordinary filename;
`expand` and directory imports are not 0.8 forms.

Follow relevant provider contributions and Inline Links when their content is
needed for the meaning in scope. Local Inline Links resolve from the linking
source's directory, unlike import paths. A complete link and its target do not
introduce Tags into the linking source. Report unavailable material with the
specific interpretation it leaves uncertain; do not infer the missing policy.

## Compact example

These complete sources belong in a temporary workspace for evaluation. They are
0.8 design examples, not evidence that current tooling accepts them.

`search/service.sigil`:

```sigil
component SearchService {
  goal {
    Find records matching a supplied query.
  }
  interface {
    Accept a *query* as search text and return *search results* as matching records.
  }
}
```

`search/panel.sigil`:

```sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }
  interface {
    Display search results for the current search.
  }
  constraints {
    Only the active request may publish search results.
  }
}
```

SearchService owns query and search results. SearchPanel owns its display promise
and active-request constraint; using those Tags does not make it their owner or
specify a network call. The active-request invariant rules out publication by a
superseded request without needing a list of late-response orderings. Request
identifiers, cancellation helpers, and storage structures are implementation
choices insofar as they preserve that invariant. The design says nothing about
retention duration; do not invent one or demand it unless the requested behavior
makes that decision consequential.

## Keep evidence categories distinct

- **Authored commitment:** identify the source statement and its contract role.
- **Derived conclusion:** state the consequence and the supplied commitments or
  applicable laws supporting it; do not present it as authored text.
- **Unresolved intent:** identify a consequential choice or unavailable evidence
  and explain what cannot be determined from the available material.
- **Implementation choice:** leave room for alternatives that satisfy the design.

Saturation derives consequences supported by supplied design, implementation,
and applicable laws. It cannot invent unstated policy. Design understanding and
advisory review alone do not establish saturated coherence, test results, or
software conformance. Report which sources were actually read and any unavailable
validation when that limits the conclusion.
