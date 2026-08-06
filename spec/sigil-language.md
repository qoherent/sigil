# Sigil Language Specification

**Sigil version:** 0.7.0
**Status:** Accepted
**Released:** 2026-08-04

Sigil is a lightweight, rationale-oriented modeling language for software systems.
It records what a system part is, why it exists, how it interacts with its surroundings, and which decisions should guide implementation.

Sigil is intentionally readable by humans and coding agents.
The language favors durable understanding over strict syntax.

## 1. Purpose

Sigil captures component-level rationale before, during, and after implementation.
It is designed to preserve the understanding that can otherwise disappear during long agent-assisted coding sessions.
The goal is not only to describe what code should do, but to keep reasons, boundaries, and review context durable enough for humans to stay accountable for the system.

A Sigil component can describe:

- a product module;
- a service boundary;
- a domain concept;
- a library abstraction;
- an API object;
- a state machine;
- a screen, view, or reusable user-interface surface;
- an architecture boundary;
- any other coherent unit whose intent should survive code generation.

Sigil is not limited to business application features.
It can describe programming abstractions, user-facing modules, infrastructure boundaries, workflows, policies, or internal architecture.

## 2. Source Files

Sigil source files use the `.sigil` extension.

The directory-index filename is `_module.sigil`.
It may appear in any directory where the file itself is selected by the
workspace configuration and defines the component names that resolve through
directory-import shorthand for that directory.
It does not grant or restrict component visibility.
Every `_module.sigil` must declare at least one local component; an imports-only
index is invalid.
The legacy `#module.sigil` filename is an ordinary Sigil source and is selected
only by an explicit file import.

A strict JSON `.sigil/config.json` is required at the workspace root.
It selects the Sigil version and defines workspace file discovery. The config
contract is defined in [sigil-config.md](sigil-config.md).

Sigil files are plain text.
The outer structure is restricted, but section bodies are free-form text.

Sigil files should live as near as practical to the code they describe.
The default placement is beside the corresponding module, feature, abstraction, or implementation files.

When the public `component` must live in a root, shared, or contract-oriented Sigil file, colocated `expand Name` blocks may still live beside the code they explain.
Because expands are collective, nearby expands can add implementation-specific rationale without moving the main component contract.

Every component declaration is public and may be imported through its explicit
`.sigil` source path whether or not a module index names it. A module index only
selects the names available through a directory import. It may declare
components itself and may name components through direct imports. Sigil has no
export or re-export form.

At configured workspace boundaries, the Brownfield workflow maintains ordinary
project-summary components in the workspace-root and declared-member
`_module.sigil` files. Those summaries use normal component and expand semantics;
they have no special parser or resolver status. Internal directories may use
`_module.sigil` as an index without a project summary, but the index still
declares at least one local component.

### Module indexes

A directory import resolves to `_module.sigil` in the target directory. Its
directory-import surface consists of:

- components declared directly in that `_module.sigil`;
- component names successfully resolved by direct imports in that file.

An imports-only `_module.sigil` produces
`SIGIL_MODULE_WITHOUT_COMPONENT` while retaining independently resolved names
in its partial directory-import surface.

Other files beneath the directory, unnamed dependencies of indexed components,
and components imported only by those indexed files are not added implicitly.
They remain public through explicit file imports. Explicit chains of module
indexes converge to a least fixed point, including through cycles. Contributions
of the same declaration identity deduplicate. A name contributed by distinct
declarations is absent from the exposed surface while unaffected names remain
available.

### Workspace and project vocabulary

A **Sigil workspace** is the tooling boundary controlled by one
`.sigil/config.json`. The **workspace root** is the directory containing that file.

A **project** is a coherent app, service, library, package, or other system
represented by an ordinary summary component at a configured workspace
boundary. The workspace root is the **root project** location.

A **workspace member** is an additional project explicitly declared by
`workspace.members`. Its declared directory is its **member root**. A workspace
with one or more members is a **monorepo workspace**.

An **independent workspace** is an excluded nested directory containing its own
`.sigil/config.json`. It is not a workspace member of its parent.

## 3. Top-Level Forms

Sigil currently defines three top-level forms:

```sigil
@packages/cli import { SigilCli }
@sub/folder/auth.sigil import { Auth }

component Name {
  goal {
    why this component exists
  }

  interface {
    PublicBehavior {
      how this component interacts with the outside world
    }
  }
}

expand Name {
  state {
    RuntimeState {
      meaningful configurations that persist or change during execution
    }
  }

  logic {
    behavior, flows, algorithms, transformations, decision paths, and lifecycle transitions
  }

  constraints {
    rules, policies, invariants, and decisions the implementation must obey
  }

  decisions {
    PersistenceChoice {
      Decision: Use PostgreSQL.

      Scope: Governs payment persistence and transaction handling.
    }
  }

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

`import` makes named components from another Sigil file available to the current file.
`component` defines the public goal and interface of a system part.
`expand` adds deeper operational detail for an existing component.

## 4. Imports

An `import` declares that the current Sigil file depends on named components
from another Sigil source. It makes their public goals, interfaces, and public
concept identifiers available to the importer. Matching expands remain private
to the provider unless that provider is itself selected for review or
implementation.

Import syntax:

```sigil
@path import { Name }
@path import { Name, OtherName }
```

Import paths begin with `@`.
The `@` prefix resolves from the Sigil workspace root.

Tools discover the workspace by walking upward from the current file or command target and selecting the nearest ancestor `.sigil/config.json` whose root is excluded by every higher configured workspace.
An explicit root must contain `.sigil/config.json` directly.
Missing configs and configs nested inside included paths are errors. Configs inside excluded subtrees define independent workspaces, and tools do not fall back to `_module.sigil` discovery.

A directory import resolves to `_module.sigil` in the target directory.

```sigil
@packages/cli import { SigilCli }
```

Given this file layout:

```text
packages/cli/_module.sigil
packages/cli/deno.json
```

`@packages/cli import { SigilCli }` resolves through its `_module.sigil`.
The directory does not need to be declared in `workspace.members`; the target
module index only needs to be included in the selected workspace.

A file import resolves to the exact `.sigil` file.

```sigil
@sub/folder/auth.sigil import { Auth }
```

`@sub/folder/auth.sigil import { Auth }` resolves through `sub/folder/auth.sigil`.

Importing `Name` from an explicit file resolves a component declared in that
file. Importing it from a directory resolves the name through the target module
index. In both cases it makes only the public component contract and its public
concept identifiers available to the importer.

Imported names are case-sensitive and should match the spelling of the component declaration.

Imports are explicit dependency edges between Sigil files.
They do not copy text into the importing file.
They make the referenced public component contract available for interpretation,
review, and implementation context. Private expansion detail is available only
when the provider is explicitly selected.

An imported name must resolve to a `component Name` in the explicit source or
the directory index's local declarations and direct imports.
An import that resolves only to `expand Name` without `component Name` is unresolved.

Import paths are normalized lexically from the workspace root. Backslashes become
slashes, repeated slashes and `.` segments collapse, and an internal `..` removes
one preceding segment. A leading or excess `..` is outside-workspace traversal and
remains unresolved. A normalized path ending in `.sigil` selects that exact file;
other paths select the directory's `_module.sigil`.

Component names are unique across the workspace. When the same exact name is
declared more than once, every declaration is retained and diagnosed, but that
name binds no import, matching expand, or concept context. Each imported name in
an import list is resolved and checked for use independently, including repeated
entries.

Missing paths are diagnosed in source and import-declaration order before missing
names. Import cycles are then discovered depth first in source-discovery and
import-edge order. Every edge returning to an active source produces one
`SIGIL_IMPORT_CYCLE` diagnostic over the closing import declaration while resolved
edges, names, and declarations outside the cycle remain available.

## 5. Components

A `component` is the reusable public description of a system part.
It should be understandable without reading implementation details.

Its public `goal` describes why the component exists, the responsibility it
owns, and its intended outcome. Its public `interface` contains only the
operations, data, events, results, errors, and observable promises available to
dependents.

A `component` must contain:

- `goal`
- `interface`

The conventional section order is:

```text
goal
interface
```

The order is a readability convention.
It has no semantic effect.

Keep a `component` focused on the public contract.
Put state, behavior, constraints, decision rationale, examples, and
architecture rules in `expand`.

Imports declare dependencies between components; do not repeat imported
dependencies in `interface`.

Other components see only the public `component` description and its public
concept information. They do not see private expansion details through an
import.

## 6. Expands

An `expand` adds collective operational detail to a component without changing
or overriding its public contract.
It is where authors record state, behavior, rules, decision rationale, edge
cases, and examples that would otherwise be lost during implementation.

An `expand Name` should normally refer to a matching `component Name`.

An `expand` may contain:

- `state`
- `logic`
- `constraints`
- `decisions`
- `cases`

The conventional section order is:

```text
state
logic
constraints
decisions
cases
```

The order is a readability convention.
It has no semantic effect.

Multiple `expand Name` blocks for the same component are collective.
When a component is referenced with its expanded detail, all matching `expand Name` blocks contribute to the expanded component.

An `expand` does not select, override, or shadow another `expand` with the same name.
Separate expands may live in different files when authors want to add detail from another feature, layer, implementation concern, environment, or audience.

If collected expands contradict each other, the contradiction is a specification issue that must be resolved by the author or reviewer.

## 7. Sections

### `goal`

`goal` publicly explains why the component exists.

It should describe the responsibility, user or system need, and reason this component is separate from others.

### `interface`

`interface` contains only what dependents can use or observe from the public
contract.

It may include:

- inputs and data;
- outputs and results;
- public operations;
- events;
- errors;
- observable promises other components rely on.

Dependencies belong in imports, not `interface`. Implementation-hiding rules
and forbidden internal access belong in `constraints` unless they define an
externally observable promise.

For API-like components, `interface` may contain constructors, methods, functions, return values, static helpers, and other public signatures.

For UI components, `interface` may describe visible regions, content, user actions, navigation, feedback, and other externally observable behavior.
It may use natural language, ASCII wireframes, Markdown image references to repository assets, or links to external designs such as Figma files.
These representations remain ordinary free-form section content; Sigil defines no visual-reference keywords, authority fields, or special Figma or image syntax.
When different interpretations of a visual could materially change implementation, authors should explain its intended role in their own natural language.

Keep changing UI states in `state`, interaction and transition behavior in `logic`, required responsive or accessibility decisions in `constraints`, and observable UI scenarios in `cases`.

For example:

```sigil
component BookingCalendarView {
  goal {
    Help renters understand room availability and existing bookings for a selected date range.
  }

  interface {
    CalendarNavigation {
      Shows date navigation above a calendar of rooms and bookings.

      Lets the user move to the previous or next date range.

      +------------------------------------------+
      | Previous | July 2026 | Next              |
      +------------------------------------------+
      | Room     | Confirmed bookings            |
      +------------------------------------------+

      Image reference: ![Calendar layout](./booking-calendar-view.svg)

      The image suggests visual grouping; the written interface defines required behavior.

      A project may instead link a design such as https://www.figma.com/design/<file-key>/<file-name>?node-id=<node-id>
    }
  }
}
```

### `state`

`state` describes meaningful runtime or domain data, configurations, modes, and
conditions that exist or change during execution.

It is not storage layout.
Database schema belongs in `state` only when the schema itself carries domain meaning.

### `logic`

`logic` describes how the component works.

It may include:

- flows;
- algorithms;
- transformations;
- decision paths;
- lifecycle transitions.

For state-machine-like components, `logic` should describe transitions and what happens when public operations are called in each state.

### `constraints`

`constraints` describes rules, policies, and invariants that must remain true
across valid executions or implementations.

Use `constraints` for binding decisions such as:

- architecture style;
- module boundaries;
- ownership;
- dependency direction;
- stack choices;
- persistence rules;
- integration limits;
- technology decisions.

Large architecture explanations may live in a separate document.
When they define enforceable rules, summarize those rules in `constraints`.

### `decisions`

`decisions` is an optional expand section containing durable rationale for a
chosen course. It may describe context, scope, assumptions, trade-offs, design
issues addressed, discarded alternatives, consequences, and revisit
conditions.

The section body remains free-form. The language does not require concept
blocks, labeled fields, or a complete rationale schema. Ungrouped decision
content is valid and does not produce
`SIGIL_MISSING_CONCEPT_IDENTIFIER`.

When present, decision scope states the boundary where a chosen course applies
and its important exclusions without attempting to enumerate every current
dependent.

A binding outcome remains in `constraints`; `decisions` explains why that
outcome was selected. When both concern one semantic idea, authors may reuse
the same concept identity across the sections.

Imports expose public concept identities, not a provider's private decision
rationale. A consumer may reuse an accessible public concept in its own
`decisions` section, but that occurrence remains contextual to the consumer and
does not make either decision transitively binding.

Decision rationale should summarize durable conclusions rather than prompts,
raw session transcripts, or hidden reasoning.

### `cases`

`cases` describes representative externally observable situations.

It may include:

- acceptance criteria;
- examples;
- edge cases;
- externally visible failure behavior;
- regression scenarios.

Prefer cases that can be observed by users, callers, tests, or adjacent components.

## 8. Concept Identifiers

A concept identifier gives one semantic idea, or a related group of semantic
lines, a stable and reusable name within a component contract.

Concept block syntax is:

```sigil
interface {
  SessionLifecycle {
    open(credentials) returns Session.

    close(sessionId).
  }
}
```

`SessionLifecycle` identifies the concept described by the semantic units in
the block. A block may represent a single concept with many uses throughout the
contract or group several lines that are reused together.

Concept identifiers:

- match `[A-Za-z][A-Za-z0-9_-]*`;
- contain no spaces;
- are case-sensitive when referenced;
- must be unique case-insensitively throughout the accessible namespace;
- should use concise, unambiguous PascalCase without hyphens or underscores.

The PascalCase convention is an informational formatting recommendation, not a
validity requirement. An overly long name is often evidence that the concept
has not yet been grouped or named clearly.

Concept blocks are flat and nonempty. They cannot nest. A component and every
matching `expand` share one flat concept namespace. Repeated blocks with the
same identifier are collective: they add occurrences in their original
sections and source locations and do not override one another.

Every semantic concept in `interface` should be placed in a concept block. Each
contiguous ungrouped interface region produces one
`SIGIL_MISSING_CONCEPT_IDENTIFIER` warning. The document remains valid and CLI
checks still exit successfully when no error diagnostics exist. Other sections
may introduce concept identifiers when a concept is useful across sections;
they do not require all content to be grouped.

A concept is public when it occurs in `interface`. A concept that occurs only in
`state`, `logic`, `constraints`, `decisions`, or `cases` is private. Imports
expose public concepts only; they never expose private concept occurrences or
collected expansion details.

Imported public concepts enter the consumer's namespace as bare identifiers.
Sigil deliberately provides no dotted notation, aliases, or local shadowing.
Reusing an imported identifier keeps the concept's originating identity only
when the identifier is reused in a matching `expand`. Reusing it in that
expand's `interface` re-exposes the same identity to downstream importers. A
same-named concept declared directly on the importing `component` remains a
distinct local identity and is therefore ambiguous with the imported identity;
Sigil provides neither qualification nor shadowing. Consumer occurrences never
flow backward into the provider.

Known identifiers used as whole words inside semantic content resolve as
concept references for highlighting and navigation. Unknown words remain
ordinary free-form content and do not produce unresolved-reference diagnostics.
Concept identifiers do not define anchor syntax or anchor behavior.

Concept diagnostics include:

- `SIGIL_MISSING_CONCEPT_IDENTIFIER` as a warning for ungrouped interface content;
- `SIGIL_INVALID_CONCEPT_IDENTIFIER` for invalid identifier syntax;
- `SIGIL_EMPTY_CONCEPT_BLOCK` for an empty block;
- `SIGIL_NESTED_CONCEPT_BLOCK` for a nested block;
- `SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER` for case-insensitive namespace collisions;
- `SIGIL_CONCEPT_IDENTIFIER_STYLE` as an informational formatting suggestion.

## 9. Semantic Units

Inside each section, each blank-line-delimited prose paragraph is one semantic
unit. Adjacent physical prose lines belong to the same semantic unit and
normalize to one space between their content. Rewrapping those physical lines
does not change semantic identity.

A concept-block header identifies and groups semantic units but is not itself a
semantic unit. Each paragraph inside the block records the concept identifier.

A semantic unit is a:

- source unit;
- interpretation unit;
- diff unit;
- review unit;
- possible anchor target.

Blank lines are allowed for readability.
Blank lines terminate semantic units and do not create semantic units.

Separate distinct prose-level semantic ideas with blank lines in every section.
Prefer one distinct idea per semantic unit. Avoid burying multiple decisions in
a paragraph when those decisions may need separate review, diffing, or source
mapping.

Section bodies may use clear free-form notation, including:

- concise English;
- Markdown;
- pseudocode;
- API signatures;
- math;
- arrows;
- host-language-like syntax;
- domain notation;
- ASCII sketches.

The notation should remain coherent inside a project. Multiline code,
configuration, data, diagrams, or other content that must preserve physical
layout belongs in an attached literal block:

````sigil
Configuration is represented by this JSON:
```json
{
  "enabled": true
}
```
````

Three or more backticks open a literal block. The opener may be followed by one
optional type matching `[A-Za-z][A-Za-z0-9_+.-]*`. The closing fence contains
at least as many backticks as the opener and no other content.

The opening fence must directly follow its introducing prose with no blank line.
The prose and attached literal block form one semantic unit. Literal bodies
preserve blank lines, braces, apparent Sigil syntax, and relative indentation.
They do not create component, concept, import, glossary, ownership, or other
semantic references.

Ordinary prose is limited to 79 content characters per physical line. Leading
indentation does not count. Structural lines, fence delimiters, and literal
bodies are excluded. Canonical wrapping occurs only at whitespace boundaries.
An indivisible prose token longer than 79 content characters is unformattable.

## 10. Validity Rules

A valid Sigil source file may contain one or more top-level forms.

An `import` must specify a path and one or more names.

An import path without a `.sigil` filename resolves to `_module.sigil` inside
the target directory when that file is selected by workspace configuration.

An import path with a `.sigil` filename resolves to that exact file.

The legacy `#module.sigil` basename has no directory-index behavior and may be
selected only through such an explicit file import.

Import paths resolve from the Sigil workspace root.

The Sigil workspace root is the directory containing the nearest applicable `.sigil/config.json`.
Missing or unexcluded nested configs are invalid, and an explicit root must contain its config directly.

An imported name must resolve to a matching `component Name`.

Each resolved imported name must also have at least one qualifying use in the
source that declares it. The following count independently for each name:

- an exact-case component-name reference in `interface`, `state`, `logic`,
  `constraints`, or `cases`;
- an exact-case reference to one of the imported component's public concepts in
  those sections;
- a local `expand` of the imported component;
- direct exposure by a `_module.sigil` directory surface.

Mentions in `goal`, `decisions`, literal bodies, comments, annotations, other
source files, differently cased words, or identifier substrings do not count.
Each resolved unused name produces `SIGIL_UNUSED_IMPORT`. Unresolved or
ambiguous names do not also produce that diagnostic.

A `_module.sigil` must declare at least one local component.

A `component` must contain `goal` and `interface`.

An `expand` may contain `state`, `logic`, `constraints`, `decisions`, and
`cases`.

An `expand Name` should normally have a matching `component Name`.

Section names are fixed.

Section bodies are free-form text.

Concept blocks must use a valid identifier, contain at least one semantic unit,
remain unnested, and be unambiguous across the component's accessible namespace.

The conventional section order is recommended but not semantically required.

Implementation details should not appear in a `component` unless they are part of the public contract.

Implementation-hiding rules and forbidden internal access belong in
`constraints` unless they define an externally observable promise.

Architecture, stack, ownership, and dependency decisions belong in `constraints`.

Meaningful runtime or domain data, configurations, lifecycle states, modes, and
conditions belong in `state`.

Behavior, transitions, algorithms, transformations, and decision paths belong
in `logic`.

Rules, policies, invariants, architecture decisions, and technology choices
belong in `constraints`.

Examples, acceptance criteria, and externally observable edge cases belong in `cases`.

## 11. Recommended Style

Write concise, reviewable semantic units.

Keep each blank-line-delimited paragraph focused on one idea.

Use blank lines between distinct prose-level ideas without changing meaning.

Use `sigil fmt [path]` to canonically wrap selected valid Sigil prose.
`sigil fmt [path] --check` reports noncanonical sources without writing.

Name components after the concept other parts of the system depend on.

Name reusable concepts with concise, unambiguous PascalCase identifiers.

Keep public contracts small enough to understand without reading the expand.

Move internal rationale out of `component` and into `expand`.

Prefer concrete states, transitions, inputs, outputs, and observable promises over vague descriptions.

When a decision is binding, place it in `constraints`.

When durable rationale matters, explain the selected decision in `decisions`
without removing its binding outcome from `constraints`.

When a decision is unresolved, record it as an open question instead of hiding it in ambiguous prose.

Place Sigil files near the corresponding code by default.

If the main `component` cannot live near the code, prefer placing an `expand` for that component near the code.

## 12. Examples

Import from a module directory:

```sigil
@sub/folder import { ComponentName }
```

Import from a specific file:

```sigil
@sub/folder/auth.sigil import { Auth }
```

Programming abstraction:

```sigil
component Promise {
  goal {
    Represent a value that may resolve now, later, or fail.

    Let callers chain reactions without knowing when the value arrives.
  }

  interface {
    Construction {
      new Promise<T>(executor)

      Promise.resolve(value)

      Promise.reject(reason)

      Promise.try(handler)
    }

    Chaining {
      then(onResolved, onRejected?) returns Promise

      catch(onRejected) returns Promise
    }
  }
}

expand Promise {
  state {
    Settlement {
      Pending

      Resolved(value)

      Rejected(reason)
    }
  }

  logic {
    Construction {
      A new Promise starts Pending and runs executor with resolve and reject.

      Resolving with a PromiseLike value adopts its eventual result.

      Rejecting with a PromiseLike value does not unwrap it.
    }

    Chaining {
      then returns an after Promise immediately.

      If then or catch is called while Pending, hold the reaction until settlement.
    }
  }
}
```

Stack as a constraint:

```sigil
expand Slotted {
  constraints {
    Stack is Next.js, Neon Postgres, and Drizzle ORM.

    The system ships as a single Next.js app.

    Database access goes through Drizzle.
  }
}
```

Decision rationale:

```sigil
expand Payments {
  constraints {
    PersistenceChoice {
      Payment records are stored in PostgreSQL.
    }
  }

  decisions {
    PersistenceChoice {
      Decision: Use PostgreSQL for payment records.

      Scope: Governs payment persistence and transaction handling. Analytics storage is excluded.

      Assumptions: Managed PostgreSQL is available.

      Trade-offs: Strong consistency is preferred over simpler local persistence.

      Design issues addressed: Prevents conflicting writes and ambiguous recovery.

      Discarded alternatives: SQLite was rejected because multi-writer operation is required.

      Consequences: Persistence changes must preserve transaction boundaries.

      Revisit when: Deployment or concurrency requirements change.
    }
  }
}
```

Architecture rules as constraints:

```sigil
constraints {
  Architecture style is a modular monolith with layered, domain-oriented modules.

  Modules communicate through explicit contracts, not direct access to another module's database tables or private logic.

  Domain logic should be testable with zero mocks and zero I/O.
}
```

Larger examples live in:

- `examples/promise/promise.sigil`
- `examples/slotted/_module.sigil`
- `examples/slotted/auth.sigil`
- `examples/slotted/user-profile.sigil`

## 13. Historical Platform Proposal: Anchors

Anchors are a rejected historical platform proposal for connecting Sigil
semantic units to implementation evidence.

An anchor would not change the meaning of a Sigil line.
It would record traceability between specification intent and implementation evidence.

The historical storage proposal used a committed workspace sidecar
`.sigil/anchors.json`, not inline syntax in `.sigil` files.
Generated AST indexes remain disposable.
The proposal would have allowed tools to map a component, section, or semantic
line to related files, symbols, tests, migrations, or generated code.

Source AST nodes would have provided structural evidence and recovery signals
without becoming permanent identities. The design was rejected because those
relationships create a second maintenance lifecycle without proving that
implementation conforms to Sigil.

The rejected anchor design was consolidated with the now-rejected generated
Receipts, readiness, evidence, and review-record design in
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
No active version 0.5 contract authorizes this capability.

## 14. Unresolved Language Questions

Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?

How strict should future parsing and validation become while preserving authoring speed?

How should conflicts between collected expands be represented, detected, and resolved?

Should imports support aliases, re-exports, or wildcard imports beyond the implemented cycle diagnostics?
