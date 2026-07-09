# Sigil Format Reference

This is a concise agent-facing reference for Sigil.
The canonical language specification lives at repository path `spec/sigil-language.md`.

Use this file when you need a quick reminder of syntax, section placement, or review heuristics during a Codex session.

## Source Files

Sigil source files use `.sigil`.

The current tolerated root module filename is `#module.sigil`.
The name is provisional and may change if it causes tooling friction.

## Top-Level Forms

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

`@sub/folder import { ComponentName }` imports from `sub/folder/#module.sigil`.
`@sub/folder/auth.sigil import { Auth }` imports from `sub/folder/auth.sigil`.

Importing `Name` makes `component Name` and all matching `expand Name` blocks available to the current file.

Keep `component` focused on the reusable public contract.
Put state, behavior, constraints, and representative cases in `expand`.

## Required And Optional Sections

`component` requires:

- `goal`
- `interface`

`expand` may contain:

- `state`
- `logic`
- `constraints`
- `cases`

Conventional `component` order:

```text
goal
interface
```

Conventional `expand` order:

```text
state
logic
constraints
cases
```

The order is only a readability convention.

## Imports

Import syntax:

```sigil
@path import { Name }
@path import { Name, OtherName }
```

A path without a `.sigil` filename resolves to `#module.sigil` inside that path.
A path with a `.sigil` filename resolves to that exact file.
The `@` prefix resolves from the Sigil workspace root.

Imported names must resolve to matching `component` declarations.
Imported names are case-sensitive.
All matching expands for the imported component are collective.

## Section Placement

Use `goal` for why the component exists.

Use `interface` for public interactions: inputs, outputs, public operations, events, guarantees, and dependencies visible to other components.

For API-like components, `interface` may contain signatures such as constructors, methods, functions, return values, and static helpers.

Use `state` for meaningful configurations during execution.
It is not storage layout unless the storage shape carries domain meaning.

Use `logic` for behavior: flows, policies, algorithms, transformations, decision paths, and lifecycle transitions.

For state-machine-like components, `logic` should describe transitions and what happens when public operations are called in each state.

Use `constraints` for binding decisions and rules.
Architecture, ownership, dependency direction, stack choices, persistence rules, and technology decisions belong here.

Use `cases` for examples and acceptance criteria that can be observed from outside the component.

## Semantic Lines

Each non-empty line inside a section is a semantic unit and possible future anchor target.
Blank lines are allowed for readability.

Prefer one distinct idea per line.
Avoid burying multiple decisions in a paragraph when they may need separate review, diffing, or source mapping.

## Review Checks

When reviewing Sigil, check:

- Does every component explain why it exists?
- Does every component expose how callers, users, modules, or other parts interact with it?
- Does each imported name resolve to a matching component in the imported Sigil source?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they are part of the contract?
- Are roles, states, permissions, and lifecycle transitions explicit enough to test?
- For abstractions and APIs, are constructor/functions, return values, settlement/lifecycle behavior, and error behavior explicit?
- Are examples in `cases` externally observable?

Multiple `expand Name` blocks for the same component are collective.
When using expanded detail for `Name`, read all matching expands as one collected expansion.
If collected expands contradict each other, treat that as a specification issue to resolve with the user.

## Examples

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
