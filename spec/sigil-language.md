# Sigil Language Specification

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
- an architecture boundary;
- any other coherent unit whose intent should survive code generation.

Sigil is not limited to business application features.
It can describe programming abstractions, user-facing modules, infrastructure boundaries, workflows, policies, or internal architecture.

## 2. Source Files

Sigil source files use the `.sigil` extension.

The current module summary filename is `#module.sigil`.
This filename is provisional because the `#` prefix may create friction for shells, URLs, editors, or future platform packages.

Until Sigil introduces a project configuration file such as `sigil.config`, the topmost discovered `#module.sigil` defines the root of a Sigil workspace.
Nested `#module.sigil` files define importable module directories inside that workspace.

Sigil files are plain text.
The outer structure is restricted, but section bodies are free-form text.

Sigil files should live as near as practical to the code they describe.
The default placement is beside the corresponding module, feature, abstraction, or implementation files.

When the public `component` must live in a root, shared, or contract-oriented Sigil file, colocated `expand Name` blocks may still live beside the code they explain.
Because expands are collective, nearby expands can add implementation-specific rationale without moving the main component contract.

Use `#module.sigil` at the workspace root for product, deployable, bounded-context, or cross-cutting summaries.
Use nested `#module.sigil` files for importable module directory summaries.
Use imports to connect nearby Sigil files instead of moving all specifications into a central folder.

## 3. Top-Level Forms

Sigil currently defines three top-level forms:

```sigil
@sub/folder import { ComponentName }
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
    flows, algorithms, policies, transformations, and decision paths
  }

  constraints {
    rules and decisions the implementation must obey
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

An `import` declares that the current Sigil file depends on named components from another Sigil file or module directory.

Import syntax:

```sigil
@path import { Name }
@path import { Name, OtherName }
```

Import paths begin with `@`.
The `@` prefix resolves from the Sigil workspace root.

Until Sigil has project configuration, tools and agents should discover candidate roots by walking upward from the current file or command target and collecting ancestor directories that contain `#module.sigil`.
The workspace root is the topmost discovered candidate unless an explicit tool invocation supplies another root.
If no ancestor `#module.sigil` exists, tools may fall back to the current working directory and should report that the workspace root is inferred.

A directory import resolves to that directory's `#module.sigil`.

```sigil
@sub/folder import { ComponentName }
```

Given this file layout:

```text
sub/folder/#module.sigil
sub/folder/auth.sigil
```

`@sub/folder import { ComponentName }` resolves through `sub/folder/#module.sigil`.

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

An `expand` adds operational detail to a component without changing the public shape of the component itself.
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

### `state`

`state` describes meaningful configurations that persist or change during execution.

It is not storage layout.
Database schema belongs in `state` only when the schema itself carries domain meaning.

### `logic`

`logic` describes how the component works.

It may include:

- flows;
- algorithms;
- policies;
- transformations;
- decision paths;
- lifecycle transitions.

For state-machine-like components, `logic` should describe transitions and what happens when public operations are called in each state.

### `constraints`

`constraints` describes rules that must remain true across valid executions or implementations.

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

## 9. Validity Rules

A valid Sigil source file may contain one or more top-level forms.

An `import` must specify a path and one or more names.

An import path without a `.sigil` filename resolves to `#module.sigil` inside that path.

An import path with a `.sigil` filename resolves to that exact file.

Import paths resolve from the Sigil workspace root.

Until project configuration exists, the Sigil workspace root is the topmost ancestor directory containing `#module.sigil`, unless an explicit tool invocation supplies another root.
If no ancestor `#module.sigil` exists, tools may infer the current working directory as the workspace root and should surface that inference.

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

Behavior, transitions, algorithms, and policies belong in `logic`.

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

## 12. Future Platform Capability: Anchors

Anchors are a deferred platform concept for connecting Sigil semantic lines to corresponding code locations.

An anchor would not change the meaning of a Sigil line.
It would record traceability between specification intent and implementation evidence.

The likely storage model is an internal middle table or index maintained by platform packages, not inline syntax in `.sigil` files.
This keeps Sigil readable while allowing tools to map a component, section, or semantic line to related files, symbols, tests, migrations, or generated code.

Anchors are intended to provide:

- guard rails for assistants when changing code;
- context for humans reviewing why code exists;
- signals when code and Sigil drift apart;
- support for future code/spec synchronization workflows.

Anchors are intentionally postponed.
They require decisions about parsing, stable semantic-line identity, code indexing, refactor tracking, synchronization policy, and conflict handling.

## 13. Unresolved Language Questions

Should dependencies on collected `expand` details be explicit in Sigil, or should expands remain review and implementation context only?

Should `#module.sigil` remain the workspace root marker after project configuration exists?

How strict should future parsing and validation become while preserving authoring speed?

How should conflicts between collected expands be represented, detected, and resolved?

Should Sigil introduce `sigil.config` or another project configuration file to replace or override `#module.sigil` as the workspace root marker?

Should imports support aliases, re-exports, wildcard imports, or cycle detection rules?

How should anchors identify stable Sigil semantic lines as files are edited?

Should anchors be stored outside `.sigil` files, generated from code, or reviewed as part of the repository?

What should the platform do when anchored code changes but the corresponding Sigil line does not?
