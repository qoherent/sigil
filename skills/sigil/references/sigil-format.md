# Sigil Format Reference

Sigil source files use `.sigil`.

The outer structure is restricted, but section bodies are free-form text.

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
    internal {
        private sub-components, dependencies, services, types, resources, and domain vocabulary
    }

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

## Required And Optional Sections

`component` requires:

- `goal`
- `interface`

`expand` may contain:

- `internal`
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
internal
state
logic
constraints
cases
```

The order is only a readability convention.

## Section Placement

Use `goal` for why the component exists.

Use `interface` for public interactions: inputs, outputs, public operations, events, guarantees, and dependencies visible to other components.

Use `internal` for private things that exist inside the component: modules, services, dependencies, libraries, resources, functions, types, and vocabulary.

Use `state` for meaningful configurations during execution. It is not storage layout unless the storage shape carries domain meaning.

Use `logic` for behavior: flows, policies, algorithms, and decision paths.

Use `constraints` for binding decisions and rules. Stack choices belong here when they constrain implementation.

Use `cases` for examples and acceptance criteria that can be observed from outside the component.

## Examples

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
    Modules communicate through explicit contracts, not direct access to another module's database tables or internal logic.
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

## Open Language Decisions

Multiple `expand` blocks for the same component are not fully defined yet. If you find them, ask whether they should be merged, scoped by feature/layer/environment, or selected by context.

The root-level Sigil file is currently tolerated as `#module.sigil`. The name may change later if it causes tooling friction.
