# Sigil

Sigil is a structured, section-based language for humans and coding agents, with free-form text inside each section. Its purpose is to keep system knowledge coherent and understandable by breaking a system into components and recording both the public contract and the reasoning behind the implementation.

A Sigil component can describe a product module, service boundary, domain concept, library abstraction, API object, state machine, or other coherent unit. Sigil is not limited to business application features.

Sigil exists to solve a specific problem in AI-assisted development: agents can generate code quickly, but the reason a system exists, how its parts interact, and why decisions were made can disappear into a long session. Sigil keeps that context durable before code generation starts.

The first iteration is not a parser or a full programming language. It is a standard workflow and file format for a Codex skill. A user writes the minimum useful Sigil, then the agent evaluates it against related Sigil files and available code. The agent asks questions, improves coherence, and only starts code generation after the human and agent agree on the specification.

`Slotted` in `examples/slotted/#module.sigil` is only an example project used to test the language. It is not the purpose of this repository.

`Promise` in `examples/promise/promise.sigil` shows how Sigil can describe a programming abstraction with an API, lifecycle states, and transition logic.

## Language Shape

Sigil source files use the `.sigil` extension.

The outer structure is restricted:

- `component Name { ... }` defines the public purpose and boundary of a component.
- `expand Name { ... }` adds deeper detail for an existing component.
- A `component` must contain `goal` and `interface`.
- An `expand` may contain `internal`, `state`, `logic`, `constraints`, and `cases`.

Keep `component` focused on the reusable public contract. Put `internal`, `state`, `logic`, `constraints`, and `cases` in `expand`.

Inside a section, authors are free to use any clear text format: concise English, Markdown, pseudocode, API signatures, math, arrows, host-language-like syntax, domain notation, ASCII sketches, or combinations. The model should help keep the style consistent inside a project.

```sigil
component Box {
  goal {
    why this component and its sub-parts exist
  }

  interface {
    how this component interacts with the world around it
  }
}

expand Box {
  internal {
    private components, dependencies, resources, services, capabilities,
    functions, types, domain vocabulary, and static relationships
  }

  state {
    meaningful configurations that persist or change during execution.
    this is not storage layout.
  }

  logic {
    how the component works
  }

  constraints {
    universal truths over all valid executions
  }

  cases {
    representative externally observable situations, acceptance criteria,
    and edge cases
  }
}
```

The conventional section order for `component` is:

```text
goal
interface
```

The conventional section order for `expand` is:

```text
internal
state
logic
constraints
cases
```

This order is only a readability convention. It has no semantic effect.

## Section Meaning

### `component`

A `component` is the reusable public description of a system part. It should be understandable without reading the implementation details.

### `goal`

`goal` explains why the component exists. It should describe the responsibility, user/system need, and reason this component is separate from others.

### `interface`

`interface` explains how the component interacts with the outside world. This can include inputs, outputs, public operations, events, dependencies consumed from other components, or guarantees other components rely on.

For API-like components, `interface` may contain constructors, methods, functions, return values, static helpers, and other public signatures.

### `expand`

`expand` adds detail to a component without changing the public shape of the component itself. It is where the author records internal structure, state, rules, decisions, and examples that would otherwise be lost during implementation.

An `expand Name` should normally refer to a matching `component Name`.

The intended reuse model is:

- Other components should depend on the public `component` description first.
- `expand` is used when deeper implementation context is needed.
- A component may have more than one `expand` in the future, but the rules for selecting, merging, or scoping multiple expands are still an open design question.

### `internal`

`internal` names private things that exist inside the component: private sub-components, dependencies, resources, services, capabilities, functions, types, domain vocabulary, and static relationships.

### `state`

`state` describes meaningful configurations that persist or change during execution. It is not storage layout. Database schema belongs here only if the schema itself is part of the domain meaning.

### `logic`

`logic` describes how the component works: flows, algorithms, policies, transformations, and decision paths.

For state-machine-like components, `logic` should describe transitions and what happens when public operations are called in each state.

### `constraints`

`constraints` describes rules that must remain true across valid executions or implementations.

Architecture documents can be summarized in `constraints` when they define rules the implementation must obey, such as module boundaries, layering, dependency direction, or allowed infrastructure. Large architecture explanations should stay in a separate document and be referenced or summarized here as enforceable rules.

### `cases`

`cases` describes representative externally observable situations, acceptance criteria, examples, and edge cases.

## Semantic Lines

Inside each section, a new line separates semantically distinct ideas. Each non-empty semantic line is a source unit, interpretation unit, diff unit, review unit, and possible source-mapping target.

Blank lines are allowed for readability. They do not create semantic units.

Sigil does not require semicolons or a universal type grammar inside sections.

## Examples

### Programming abstraction

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
  internal {
    resolve
    reject
    held reactions
    PromiseLike value
  }

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

### Stack as a constraint

```sigil
expand Slotted {
  constraints {
    Stack is Next.js, Neon Postgres, and Drizzle ORM.
    The system ships as a single Next.js app.
    Database access goes through Drizzle.
  }
}
```

## Root Level

The root-level Sigil file is currently called `#module.sigil`.

The `#` prefix may change later if it creates friction for shells, URLs, editors, or tooling. For now, tools and agents should tolerate it.

## Current MVP

The MVP is a Codex skill that can:

- read all relevant `.sigil` files;
- compare them with available code;
- detect missing, conflicting, or vague information;
- ask the user targeted questions;
- update or propose improved Sigil text;
- use the agreed Sigil as context for code generation.

Parsing, validation tooling, and strict grammar enforcement are intentionally deferred.

## Open Design Questions

- If a component has multiple `expand` blocks, how should an agent choose which one applies?
- Can expands be named or scoped, for example by feature, layer, implementation, or environment?
- Should reusable components expose only `component`, or can other components explicitly depend on selected `expand` details?
- Should `#module.sigil` remain the root filename?
