# Sigil Format Reference

Sigil source files use `.sigil`.

The outer structure is restricted, but section bodies are free-form text.

Use Sigil for any coherent component-like unit: product modules, domain concepts, services, APIs, library abstractions, state machines, or architecture boundaries.

```sigil
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

Keep `component` focused on the reusable public contract. Put state, behavior, constraints, and representative cases in `expand`.

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

## Section Placement

Use `goal` for why the component exists.

Use `interface` for public interactions: inputs, outputs, public operations, events, guarantees, and dependencies visible to other components.

For API-like components, `interface` may contain signatures such as constructors, methods, functions, return values, and static helpers.

Use `state` for meaningful configurations during execution. It is not storage layout unless the storage shape carries domain meaning.

Use `logic` for behavior: flows, policies, algorithms, and decision paths.

For state-machine-like components, `logic` should describe transitions and what happens when public operations are called in each state.

Use `constraints` for binding decisions and rules. Stack choices belong here when they constrain implementation.

Use `cases` for examples and acceptance criteria that can be observed from outside the component.

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

Architecture rules as constraints:

```sigil
constraints {
    Architecture style is a modular monolith with layered, domain-oriented modules.
    Modules communicate through explicit contracts, not direct access to another module's database tables or private logic.
    Domain logic should be testable with zero mocks and zero I/O.
}
```

Component reuse:

```sigil
component Auth {
    goal {
        Manages identity and access for the app.
    }

    interface {
        accepts credentials
        exposes current user
        exposes permission checks
    }
}
```

Other components should depend on the public `component` description first. Use `expand` only when deeper implementation context is needed.

## Semantic Lines

Each non-empty line inside a section is a semantic unit. Blank lines are allowed for readability.

Prefer one distinct idea per line. Avoid burying multiple decisions in a paragraph when they may need separate review, diffing, or source mapping.

## Open Language Decisions

Multiple `expand` blocks for the same component are not fully defined yet. If you find them, ask whether they should be merged, scoped by feature/layer/environment, or selected by context.

The root-level Sigil file is currently tolerated as `#module.sigil`. The name may change later if it causes tooling friction.
