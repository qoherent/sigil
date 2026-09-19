# Sigil Authoring Guide

Sigil is for describing architecture: the important parts of a system, the
relationships between them, and the promises they make. It borrows useful ideas
from UML and software-engineering practice, but keeps the medium light—natural
language for intent, with just enough structure to make names and relationships
reliable.

## Semantics

| Term | Meaning | Syntax/placement |
|---|---|---|
| Component | One bounded responsibility with one workspace-unique name | `component Name { ... }` |
| Contract | One architectural question answered about a component | `goal`, `interface`, `state`, `logic`, `constraints`, `decisions`, `cases` |
| Facet | The smallest independently reviewable unit within a contract | Blank-line-separated paragraph; wrapping does not split it |
| Embedded Facet | Prose accompanied by one immediately adjacent representation | No blank line before the fence; the fence closes the Facet |
| Tag | Umbrella term for Inline Tags and Concepts | Both are component-owned identifiers |
| Inline Tag | A reusable component-owned identifier introduced in prose | Define once as `*name*`, then reuse as `name`; a bare word does not define one |
| Concept | A flat, nonempty Tag heading that gathers related Facets; the same exact Concept can gather Facets across contracts | `name { ... }`; the header is not a Facet |
| Inline Link | A link whose role—binding, suggestion, or rationale—is clear in its prose | `[label](destination)`; relative paths resolve from the source file |
| Tag import | File-scoped selection of Tags, inline or Concepts, from a component | `@path/file.sigil from Component import { a, b }` |

Minimal valid component:

```sigil
component SearchPanel {
  goal {
    Help a user find records.
  }

  interface {
    Accept *search text*, the words the user wants to find, and display
    *matches*, the records that answer that search.
  }
}
```

`goal` and `interface` must be nonempty in every component. Other
contracts are optional; each allowed contract appears at most once per
declaration, inside that declaration. A component need not equal a file,
class, process, API, or screen.
Do not create components merely for long prose; separate responsibilities or
independent change reasons. Keep the contract architectural: name meaningful
boundaries and behavior, not wire formats, storage layouts, framework calls, or
other implementation details.

## Contract map

| Contract | Question | Use |
|---|---|---|
| `goal` | Why does this responsibility exist? | Purpose and boundary |
| `interface` | What promise is offered? | Interactions, visible concepts, actions, regions, and adoption promises |
| `state` | What meaningful data or modes matter? | User-visible modes and domain state, without prescribing storage |
| `logic` | What happens, and in what order? | Interaction behavior and transitions |
| `constraints` | What must remain true or is forbidden? | Invariants, prohibitions, accessibility, responsive, and other binding rules |
| `decisions` | Why this course? | Rationale and trade-offs |
| `cases` | What occurs in this situation? | Situation plus observable outcome |

The same concern may appear in several contracts when each Facet has a
different role. `interface` states the promise, `logic` explains behavior,
`constraints` bind all relevant paths, and `decisions` explain why. Do not
repeat one sentence merely to fill sections. For an interface, place visible
concepts, regions, actions, and adoption promises in `interface`; meaningful
modes and domain data in `state`; interaction behavior and transitions in
`logic`; binding UI rules in `constraints`; and observable user situations in
`cases`.

State may describe meaningful domain data or modes without prescribing storage.

Cases expose decisions rather than merely declaring success. Weak: “Cancellation
works.” Better: “A response arrives after cancellation; it does not change the
display.” A Case is a situation plus an observation. It does not automatically
become a universal rule; distinguish required outcomes from permitted ones.

## Names and composition

- Tag names are case-sensitive, exact, and not whitespace/Unicode-normalized.
  Introduce a local Inline Tag exactly once, at its first meaningful occurrence,
  as `*name*`; every later mention is bare `name`. A bare first mention is ordinary
  prose, and repeating `*name*` is not reuse. A definition is recognized only with
  the required outer boundary characters; `* name *` and fenced payloads do not
  define one.
- Tag semantic units aggressively: when prose introduces an identifiable thing,
  state, event, role, outcome, or decision, define it as an Inline Tag at its
  first meaningful occurrence, regardless of contract. Reuse the bare name
  afterward. Leave only genuinely incidental wording untagged; a `goal` may
  remain ordinary prose when it states purpose rather than naming a unit.
- Keep each complete Inline Tag name on one physical line, even when the prose
  around it wraps. A multiword Tag may wrap its surrounding sentence, never the
  name itself.
- Treat an Inline Tag span as formatting-atomic: compactness and line wrapping
  never justify splitting its asterisks or name.
- Prose resolves the longest accessible Tag name. Unknown words stay prose;
  `order` does not match `pre-order` or `order.status`. Links and fences are
  opaque to Inline Tag scanning, so mention needed names in surrounding prose.
- A Concept heading creates or reuses a local Tag. Groups are flat and nonempty;
  direct and grouped Facets may coexist. Reuse the same exact Concept heading
  across contracts when Facets address the same concern; this gathers them into
  one cross-contract concept without merging their contract roles. Copy its
  spelling and case exactly; do not turn a reused Concept into a title-cased
  variant. An imported Tag cannot be a local heading.
- A component owns its local Tag vocabulary. A bare Tag from another declaration is
  unavailable until imported.
- Let `interface` introduce the concepts other components need to recognize,
  with a brief description of how each is adopted. If a concept introduced in
  another contract must be visible externally, give it the same named entry in
  `interface`.
- Reusing a Concept across contracts adds Facets to one exact Concept while
  preserving each contract's role:

  ```sigil
  interface {
    search lifecycle {
      Offer a way to begin or cancel a search.
    }
  }

  logic {
    search lifecycle {
      A cancelled search does not publish its response.
    }
  }
  ```

  Sharing a Concept does not make the resources or actions in those Facets
  identical. Match the heading's spelling and case exactly.

## Imports

Import statements are top-level, before component declarations, and are file-scoped:
every declaration in that source sees the same imports. Tag imports select named Tags
from the stated owning component source. Imports name declarations in `.sigil` files,
never Markdown guides or evaluation notes. A selected Tag must be referenced in prose;
link labels and fenced payloads do not count.
Duplicate imports, unused selections, local/imported name collisions, and
colliding imported names are errors. There are no aliases, wildcards,
qualified references, re-exports, or inherited provider imports. Importing a name
supplies vocabulary; describe runtime interactions in `interface`/`logic`.

Tags introduced in `state` are importable like Tags from any other contract.
For example, a consumer may import a provider-owned `Running` Tag and say that
its activity indicator appears while the provider reports `Running`. The import
supplies shared vocabulary, not runtime access to private state; the interaction
still belongs in the consumer's `interface` or `logic`.

```sigil
@providers/worker.sigil from Worker import { Running }

component StatusPanel {
  goal {
    Show whether work is active.
  }

  interface {
    Show an activity indicator while the worker reports Running.
  }
}
```

`_module.sigil` is an ordinary source filename. It may hold a project summary
component, but it has no import-resolution, directory-index, export, or
re-export behavior. Import its Tags through its explicit path and declared
component.

## Representations and links

Sigil describes architecture, not implementation. Do not lock an exact JSON
response, schema, class signature, storage layout, framework API, or low-level
program into a contract. Prefer the most compressed, elegant representation
that makes the architectural idea clear: concise prose, AIMA-like pseudocode
for an algorithm, Mermaid for flow, or ASCII-box diagrams for structure. Keep
pseudocode declarative and algorithmic: avoid framework calls, assignments,
typed records, and implementation-shaped conditionals. A fenced payload is one
representation, not an excuse to specify implementation.

When a semantic unit could use two representations, draft both, compare them,
and keep only the clearer one. Any notation is welcome if it stays at the
architectural level. Express relationships and outcomes declaratively; do not
turn an architectural statement into `if`/`else` control flow merely to make a
case observable.

Attach one retained fenced payload directly to its introducing prose. Payload
labels and content do not define Tags. Reuse distinctive words from the request
when they carry useful intent or style; do not replace the author's vocabulary
with needless jargon.

For example, a lifecycle can stay architectural and readable:

````sigil
logic {
  A *request lifecycle* moves from pending to one terminal outcome:
  ```mermaid
  stateDiagram-v2
    [*] --> Pending
    Pending --> Completed
    Pending --> Cancelled
    Pending --> Superseded
  ```
}
````

Mermaid shows an architectural relationship, not executable behavior. Its
labels and payload do not create Tags; introduce any needed Tags in the prose
around the fence.

Callable notation may also be the clearest architectural shorthand. Introduce the
whole notation once as `*callable(arg1, arg2)*`, only after `arg1` and `arg2` are
already defined Tags; reuse it bare as `callable(arg1, arg2)`. It describes an
interaction, not an executable signature or implementation call.

An ASCII box can communicate a layout without becoming a pixel specification:

````sigil
interface {
  Place *date navigation* above the *room calendar*:
  ```text
  +--------------------------------------+
  | Previous | Room calendar | Next      |
  +--------------------------------------+
  | Room     | Confirmed bookings         |
  +--------------------------------------+
  ```
}
````

The same role distinction applies to links: “must satisfy” adopts a
requirement, “follow” offers guidance, and “explains why” records rationale.
The prose—not the label or destination—determines the role.

`[label](destination)` is an Inline Link. Relative targets resolve from the
source file; import paths resolve from the workspace root; query strings and
fragments select within a target. State whether a link is binding, suggestive,
or explanatory/rationale. Adopt architecture or standards material, not a
framework API as an accidental implementation contract. When a standard is
linked, adopt its architectural rule—not its endpoint names, method calls, or
invocation surface. An adopted link must state the rule the architecture takes
on; merely citing a platform or framework API as context is not adoption and
cannot be binding. Prefer domain and architecture standards; platform/framework
links remain explanatory only. Do not claim a standard establishes an
application rule unless the requirement or the linked source actually supports
that adoption. Links are not version-pinned, and embedded code is not execution
evidence.

## Uncertainty and revision

Use ordinary prose such as `Open question:`, `Proposal:`, and `Assumption to
verify:`; these are not keywords or requirements. On acceptance, update the
affected contracts and retain durable rationale in `decisions`. Remove obsolete
questions. Never turn an inferred implementation preference into a binding rule.

Proposals and assumptions remain unresolved merely because they appear in the
document. Once a choice is accepted, update the affected `interface`, `logic`,
`constraints`, and `cases` together, then keep its durable reason in
`decisions`.

When revising, preserve the existing contract and meaningful Facet boundaries;
reuse existing Inline Tags, and check longer-name matching. Preserve Concept
ownership and check imports after moving files. Keep Cases, diagrams, links,
decisions, and related Concepts aligned with the revised behavior. Moving a source
requires updating imports and relative links.

## Review

Confirm: one bounded responsibility; architectural inputs, outcomes,
transitions, and material failures; distinct rules/reasons/examples/proposals;
valid Tag ownership; elegant representations; available provider/link context;
explicit unresolved choices; and agreement among contracts, Cases, links, and
related Concepts. Optional contracts, Tags, Concepts, links, and detail may be
absent. Report actual checks.

When an authoring task supplies a requirement, return the architecture itself:
`.sigil` source declarations plus any brief mapping needed to review them. Do
not return a rewritten requirement, checklist, or explanation in place of the
source. Treat the supplied requirement as authoritative: preserve its actors,
nouns, vocabulary, and unresolved choices. Do not substitute a plausible
domain, invent a parallel example, or add policy merely to fill a contract,
link, or representation slot. Write Facets in the same language and tone as
the requirement, as if its author wrote the Sigil source. Preserve words with
useful nuance; do not replace them with generic architectural boilerplate.
