# Sigil

sigil is shared free form language between human and machine to keep the system knowlege cohirent and understand able by breaking system to component and discribe why and how. in component we define why it work and how to interact with it and in expand we expose the detail.
the way we will work for first draft (standard SKILL for agent) is user first discribe the minimal information in the sigil and agent evaluate the coherensi and information with all related sigils and avalible code and try to improve the information until we they both agree and start the code generation.


## Language Shape
Sigil source files use `.sigil`.

```sigil

component Box {
  goal {
    why this part and sub part exist
  }

  interface {
    how this interact with world around it
  }

}

expand Box {
  internal {
    names private things that exist inside the component: private components, dependencies, resources, services, capabilities, functions, types, domain vocabulary, and static relationships.
  }

  state {
     meaningful configurations that persist or change during execution. It is not storage layout.
  }

  logic {
    this part discrib how it work
  }

  constraints {
    are universal truths over all valid executions.
  }

  cases {
    are representative externally observable situations and acceptance criteria and edge cases
  }
}
```

The conventional section order for component is:

```text
goal
interface
```

The conventional section order for expand is:

```text
internal
state
logic
constraints
cases
```

This order is only a readability convention. It has no semantic effect.

The mandatory semantic units are `component`, `goal`, and `interface`.

expand has Optional sections:

- `internal`
- `state`
- `logic`
- `constraints`
- `cases`

## Section Meaning



## Semantic Lines

Inside each section, authors may use whatever notation best expresses the idea: concise English, pseudocode, math, arrows, host-language-like syntax, domain notation, ASCII sketches, or combinations.

A new line separates semantically distinct things. Each non-empty semantic line is a source unit, breakpoint location, interpretation unit, diff unit, and source mapping target.

Sigil does not require semicolons or a universal type grammar inside sections.

## Root level 

the root level sigil called #module.sigil