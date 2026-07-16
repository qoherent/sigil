# Sigil Language Specification

**Sigil version:** 0.1.0
**Status:** Accepted
**Released:** 2026-07-13

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

The project summary filename is `#module.sigil`.
It is reserved for the root project at the workspace root or a workspace member
at a member root declared by `workspace.members`, and every file with that name
follows the `RootSigil` contract.
Do not use `#module.sigil` for ordinary internal directories, features,
components, or implementation modules.

A strict JSON `.sigil/config.json` is required at the workspace root.
It selects the Sigil version and defines workspace file discovery. The config
contract is defined in [sigil-config.md](sigil-config.md).

Sigil files are plain text.
The outer structure is restricted, but section bodies are free-form text.

Sigil files should live as near as practical to the code they describe.
The default placement is beside the corresponding module, feature, abstraction, or implementation files.

When the public `component` must live in a root, shared, or contract-oriented Sigil file, colocated `expand Name` blocks may still live beside the code they explain.
Because expands are collective, nearby expands can add implementation-specific rationale without moving the main component contract.

Use the workspace-root `#module.sigil` for the `RootSigil` project summary.
In a monorepo workspace, a declared workspace member may also have a
`RootSigil` at its member root. Internal contracts use descriptive `.sigil`
filenames colocated with their implementation and are imported by explicit
filename.

### RootSigil

`RootSigil` defines the role of `#module.sigil` for one project. The
workspace-root file describes the root project. A member-root file describes a
workspace member explicitly declared by `workspace.members` in `.sigil/config.json`.
Package manifests and directory structure alone do not authorize a RootSigil
location.

The file contains a project-named component representing that project.

In that project component:

- `goal` describes why the project exists and its intended outcome;
- `interface` describes how users and external systems interact with the
  project, such as through a web app, mobile app, API, CLI, or library.

Its matching `expand` uses the general `state`, `logic`, `constraints`, and
`cases` meanings at project scope. `RootSigil` narrows the scope to project-wide
concerns; it does not redefine those sections.

Root summaries exclude secrets, incidental dependencies, low-level
configuration, and module-specific implementation details. `.sigil/config.json`
defines the workspace root; `RootSigil` summarizes the project without gaining
workspace-discovery authority.

An excluded nested directory with its own `.sigil/config.json` is an independent
workspace. It describes its own root project and is not a workspace member of
the parent.

### Workspace and project vocabulary

A **Sigil workspace** is the tooling boundary controlled by one
`.sigil/config.json`. The **workspace root** is the directory containing that file.

A **project** is a coherent app, service, library, package, or other system
described by a `RootSigil`. A **project root** is a directory where
`#module.sigil` is permitted. The workspace root is the **root project**
location.

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
    how this component interacts with the outside world
  }
}

expand Name {
  state {
    meaningful configurations that persist or change during execution
  }

  logic {
    behavior, flows, algorithms, transformations, decision paths, and lifecycle transitions
  }

  constraints {
    rules, policies, invariants, and decisions the implementation must obey
  }

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

`import` makes named components from another Sigil file available to the current file.
`component` defines the public purpose and boundary of a system part.
`expand` adds deeper operational detail for an existing component.

## 4. Imports

An `import` declares that the current Sigil file depends on named components
from another Sigil source. It makes their public contracts and matching
collected expands available to the importer.

Import syntax:

```sigil
@path import { Name }
@path import { Name, OtherName }
```

Import paths begin with `@`.
The `@` prefix resolves from the Sigil workspace root.

Tools discover the workspace by walking upward from the current file or command target and selecting the nearest ancestor `.sigil/config.json` whose root is excluded by every higher configured workspace.
An explicit root must contain `.sigil/config.json` directly.
Missing configs and configs nested inside included paths are errors. Configs inside excluded subtrees define independent workspaces, and tools do not fall back to `#module.sigil` discovery.

A directory import is reserved for a valid `RootSigil` location and resolves to
the root project's or declared workspace member's `#module.sigil`.

```sigil
@packages/cli import { SigilCli }
```

Given this file layout:

```text
packages/cli/#module.sigil
packages/cli/deno.json
```

Because `packages/cli` is declared in `workspace.members`,
`@packages/cli import { SigilCli }` resolves through its `#module.sigil`.
Package manifests and directory structure alone are not enough to make another
directory importable this way.

A file import resolves to the exact `.sigil` file.

```sigil
@sub/folder/auth.sigil import { Auth }
```

`@sub/folder/auth.sigil import { Auth }` resolves through `sub/folder/auth.sigil`.

Importing `Name` makes the public `component Name` available to the importing file.
It also makes all matching `expand Name` blocks from the imported file available as collected expanded detail.

Imported names are case-sensitive and should match the spelling of the component declaration.

Imports are explicit dependency edges between Sigil files.
They do not copy text into the importing file.
They make the referenced component contract and collected expansion available for interpretation, review, and implementation context.

An imported name must resolve to a `component Name` in the resolved import source.
An import that resolves only to `expand Name` without `component Name` is unresolved.

## 5. Components

A `component` is the reusable public description of a system part.
It should be understandable without reading implementation details.

Its `goal` describes why the component exists, the responsibility it owns, and
its intended outcome. Its `interface` describes how users, callers, external
systems, or other components interact with it through its observable public
contract.

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
Put state, behavior, constraints, examples, architecture rules, and implementation rationale in `expand`.

Other components should depend on the public `component` description first.
They should depend on `expand` details only when deeper implementation context is necessary.

## 6. Expands

An `expand` adds collective operational detail to a component without changing
or overriding its public contract.
It is where authors record state, behavior, rules, decisions, edge cases, and examples that would otherwise be lost during implementation.

An `expand Name` should normally refer to a matching `component Name`.

An `expand` may contain:

- `state`
- `logic`
- `constraints`
- `cases`

The conventional section order is:

```text
state
logic
constraints
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

`goal` explains why the component exists.

It should describe the responsibility, user or system need, and reason this component is separate from others.

### `interface`

`interface` explains how the component interacts with the outside world.

It may include:

- inputs;
- outputs;
- public operations;
- events;
- dependencies consumed from other components;
- guarantees other components rely on.

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
```

### `state`

`state` describes meaningful configurations that persist or change during execution.

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

### `cases`

`cases` describes representative externally observable situations.

It may include:

- acceptance criteria;
- examples;
- edge cases;
- externally visible failure behavior;
- regression scenarios.

Prefer cases that can be observed by users, callers, tests, or adjacent components.

## 8. Semantic Lines

Inside each section, each non-empty line is a semantic unit.

A semantic line is a:

- source unit;
- interpretation unit;
- diff unit;
- review unit;
- possible anchor target.

Blank lines are allowed for readability.
Blank lines do not create semantic units.

Prefer one distinct idea per line.
Avoid burying multiple decisions in a paragraph when those decisions may need separate review, diffing, or source mapping.

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

The notation should remain coherent inside a project.
ASCII content should avoid unmatched `{` or `}` characters because the current parser uses braces to track section boundaries.

## 9. Validity Rules

A valid Sigil source file may contain one or more top-level forms.

An `import` must specify a path and one or more names.

An import path without a `.sigil` filename may target only a valid `RootSigil`
location: the workspace root or a member root declared by `workspace.members`.
It resolves to `#module.sigil` inside that path.

An import path with a `.sigil` filename resolves to that exact file.

Import paths resolve from the Sigil workspace root.

The Sigil workspace root is the directory containing the nearest applicable `.sigil/config.json`.
Missing or unexcluded nested configs are invalid, and an explicit root must contain its config directly.

An imported name must resolve to a matching `component Name`.

A `component` must contain `goal` and `interface`.

An `expand` may contain `state`, `logic`, `constraints`, and `cases`.

An `expand Name` should normally have a matching `component Name`.

Section names are fixed.

Section bodies are free-form text.

The conventional section order is recommended but not semantically required.

Implementation details should not appear in a `component` unless they are part of the public contract.

Architecture, stack, ownership, and dependency decisions belong in `constraints`.

Runtime configurations, lifecycle states, and meaningful domain modes belong in `state`.

Behavior, transitions, algorithms, transformations, and decision paths belong
in `logic`.

Rules, policies, invariants, architecture decisions, and technology choices
belong in `constraints`.

Examples, acceptance criteria, and externally observable edge cases belong in `cases`.

## 10. Recommended Style

Write concise, reviewable lines.

Keep each non-empty line focused on one idea.

Use blank lines to improve readability without changing meaning.

Name components after the concept other parts of the system depend on.

Keep public contracts small enough to understand without reading the expand.

Move internal rationale out of `component` and into `expand`.

Prefer concrete states, transitions, inputs, outputs, and guarantees over vague descriptions.

When a decision is binding, place it in `constraints`.

When a decision is unresolved, record it as an open question instead of hiding it in ambiguous prose.

Place Sigil files near the corresponding code by default.

If the main `component` cannot live near the code, prefer placing an `expand` for that component near the code.

## 11. Examples

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
    new Promise<T>(executor)
    then(onResolved, onRejected?) returns Promise
    catch(onRejected) returns Promise
    Promise.resolve(value)
    Promise.reject(reason)
    Promise.try(handler)
  }
}

expand Promise {
  state {
    Pending
    Resolved(value)
    Rejected(reason)
  }

  logic {
    A new Promise starts Pending and runs executor with resolve and reject.
    then returns an after Promise immediately.
    If then or catch is called while Pending, hold the reaction until settlement.
    Resolving with a PromiseLike value adopts its eventual result.
    Rejecting with a PromiseLike value does not unwrap it.
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
- `examples/slotted/#module.sigil`
- `examples/slotted/auth.sigil`
- `examples/slotted/user-profile.sigil`

## 12. Proposed Platform Capability: Anchors

Anchors are a proposed future platform concept for connecting Sigil semantic lines to implementation evidence.

An anchor would not change the meaning of a Sigil line.
It would record traceability between specification intent and implementation evidence.

The proposed storage model is the committed workspace sidecar `.sigil/anchors.json`, not inline syntax in `.sigil` files.
Generated AST indexes remain disposable.
This keeps Sigil readable while allowing tools to map a component, section, or semantic line to related files, symbols, tests, migrations, or generated code.

Source AST nodes provide structural evidence and recovery signals, but they are not permanent identities.
Accepted anchors use stable relationship IDs plus Sigil and source locator snapshots.
Initial and ambiguous mappings require human approval.
Deterministic platform tools own indexing, validation, persistence, and reconciliation; optional host models may propose natural-language matches from bounded candidates.

Anchors are intended to provide:

- guard rails for assistants when changing code;
- context for humans reviewing why code exists;
- signals when code and Sigil drift apart;
- support for future code/spec synchronization workflows.

The proposed design and remaining decisions are recorded in [ADR-010](decisions/adr-010-ast-anchors-and-model-assisted-indexing.md).
The capability remains unavailable until that ADR and the colocated Sigil contracts pass review and implementation is complete.

## 13. Unresolved Language Questions

Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?

How strict should future parsing and validation become while preserving authoring speed?

How should conflicts between collected expands be represented, detected, and resolved?

Should imports support aliases, re-exports, or wildcard imports beyond the implemented cycle diagnostics?

How should future language adapters represent targets that do not have stable AST symbols?

How should editors present multiple anchors for one line and one target shared by multiple lines?

When should a changed anchor remain reviewable evidence versus be removed as obsolete?
