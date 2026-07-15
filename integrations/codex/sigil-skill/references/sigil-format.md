# Sigil Format Reference

This is a concise agent-facing reference for Sigil. The canonical language
specification lives at repository path `spec/sigil-language.md`.

Use this file when you need a quick reminder of syntax, section placement, or
review heuristics during a Codex session.

## CLI Assistance

When a `sigil` command is available on `PATH`, prefer it for mechanical parsing,
validation, graph, context, and render operations.

An installed Codex skill does not include the Sigil platform repository's
`packages/` directory. Only use `packages/cli/src/main.ts` when the
current workspace contains that path.

Typical installed command shape:

```bash
sigil check . --format json --pretty
```

Typical repository-local command shape:

```bash
deno run --allow-read packages/cli/src/main.ts check . --format json --pretty
```

Run `sigil version . --format json --pretty` before `check`. This reference
describes Sigil version `0.1.0`; do not apply it to an
unsupported workspace version.

Use CLI diagnostics as stable coded findings. Use CLI context output as a
starting point, then read source files before editing them.

## Source Files

Sigil source files use `.sigil`.

The project summary filename is `#module.sigil`. It is reserved for the root
project or a workspace member explicitly declared by `workspace.members`, and
every file with that name follows the `RootSigil` contract. Do not create it for ordinary internal
directories, features, components, or implementation modules.

A strict JSON `.sigil/config.json` is mandatory at the workspace root. It selects
Sigil version, provides `workspace.name`, declares
optional `workspace.members`, and defines file include and exclude globs. A nested config defines an independent workspace only
when its entire subtree is excluded by each configured parent; otherwise it is
invalid.

Sigil files should live as near as practical to the code they describe. Use the
workspace-root `#module.sigil` for the root-project `RootSigil` summary. A
declared workspace member may have one at its member root. Internal contracts
use descriptive `.sigil` filenames. If the main `component` must live elsewhere,
a nearby `expand Name` may live beside the code it explains.

When implementation establishes a clear owner directory, relocate a temporary
Sigil file beside that implementation and update affected imports. Keep the
workspace-root `#module.sigil` in place. If a shared component contract cannot
move, colocate its implementation-specific `expand Name` instead.

### RootSigil

Each valid `#module.sigil` contains a project-named component. Its
`goal` describes why the overall project exists and its intended outcome. Its
`interface` describes how users and external systems interact with the project,
including applicable web app, mobile app, API, CLI, library, or other surfaces.

The matching root `expand` uses the general `state`, `logic`, `constraints`, and
`cases` meanings at project scope. `RootSigil` narrows scope without redefining
the sections.

Exclude secrets, incidental dependencies, low-level configuration, and
module-specific implementation details. `.sigil/config.json` remains the workspace
marker and sole workspace-membership authority. Package manifests and directory
structure alone do not authorize a member-root `RootSigil`. An excluded nested
directory with its own config is an independent workspace, not a parent
workspace member.

## Top-Level Forms

```sigil
@packages/member import { ComponentName }
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

`@packages/member import { ComponentName }` imports from a declared workspace
member's `#module.sigil`.
`@sub/folder/auth.sigil import { Auth }` imports from `sub/folder/auth.sigil`.

Importing `Name` makes `component Name` and all matching `expand Name` blocks
available to the current file.

`component` defines the reusable public contract of a coherent system part
through its `goal` and `interface`. `expand` adds collective operational detail
without changing or overriding that public contract. Put state, behavior,
constraints, and representative cases in `expand`.

Public is relative to the component's dependents. A component may represent a
product surface, domain module, programming abstraction, internal API, state
machine, screen, view, or reusable UI surface even when it is not externally
visible. Do not mechanically create a component for every code symbol or visual
element; use cohesive responsibility and a relied-upon contract as the boundary.

## Required And Optional Sections

`component` requires:

- `goal`
- `interface`

`goal` describes why the component exists, the responsibility it owns, and its
intended outcome. `interface` describes how users, callers, external systems,
or other components interact with it through its observable public contract.

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

A path without a `.sigil` filename may target only the workspace root or a
member root declared by `workspace.members` and resolves to its `#module.sigil`. Ordinary
internal contracts are imported with an explicit `.sigil` filename. The `@`
prefix resolves from the workspace root selected by the single ancestor
`.sigil/config.json`. An explicit root must contain `.sigil/config.json` directly.

Imported names must resolve to matching `component` declarations. Imported names
are case-sensitive. All matching expands for the imported component are
collective.

## Section Placement

Use `goal` for why the component exists.

Use `interface` for public interactions: inputs, outputs, public operations,
events, guarantees, and dependencies visible to other components.

For API-like components, `interface` may contain signatures such as
constructors, methods, functions, return values, and static helpers.

For UI components, `interface` may describe visible regions, content, user
actions, navigation, feedback, and other observable behavior. Natural language,
ASCII wireframes, Markdown image references to repository assets, and links to
external designs such as Figma files are all allowed free-form content.

Sigil defines no visual-reference keywords or authority fields. When the role
of a visual could materially change implementation, explain that role in any
clear natural language rather than inventing syntax.

Keep changing UI states in `state`, interaction and transition behavior in
`logic`, required responsive or accessibility decisions in `constraints`, and
observable UI scenarios in `cases`.

Use `state` for meaningful configurations during execution. It is not storage
layout unless the storage shape carries domain meaning.

Use `logic` for behavior: flows, algorithms, transformations, decision paths,
and lifecycle transitions.

For state-machine-like components, `logic` should describe transitions and what
happens when public operations are called in each state.

Use `constraints` for rules, policies, invariants, and binding decisions.
Architecture, ownership, dependency direction, stack choices, persistence
rules, and technology decisions belong here.

Use `cases` for examples and acceptance criteria that can be observed from
outside the component.

## Semantic Lines

Each non-empty line inside a section is a semantic unit and possible future
anchor target. Blank lines are allowed for readability.

Prefer one distinct idea per line. Avoid burying multiple decisions in a
paragraph when they may need separate review, diffing, or source mapping.

ASCII content should avoid unmatched `{` or `}` characters because the current
parser uses braces to track section boundaries.

## Review Checks

When reviewing Sigil, check:

- Does every component explain why it exists?
- Does every component expose how callers, users, modules, or other parts
  interact with it?
- Were coherent internal abstractions and UI surfaces considered as components
  rather than hidden beneath only high-level project or service contracts?
- Does each imported name resolve to a matching component in the imported Sigil
  source?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in
  `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they
  are part of the contract?
- Are roles, states, permissions, and lifecycle transitions explicit enough to
  test?
- For abstractions and APIs, are constructor/functions, return values,
  settlement/lifecycle behavior, and error behavior explicit?
- For UI components, are visible regions, actions, navigation, feedback, and
  applicable loading, empty, error, disabled, responsive, keyboard, and
  accessibility behavior clear?
- Are required visual references accessible, and is their intended role clear
  when different interpretations would change implementation?
- Are examples in `cases` externally observable?

Multiple `expand Name` blocks for the same component are collective. When using
expanded detail for `Name`, read all matching expands as one collected
expansion. If collected expands contradict each other, treat that as a
specification issue to resolve with the user.

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
