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
describes Sigil version `0.4.0`; do not apply it to an
unsupported workspace version.

Use CLI diagnostics as stable coded findings. Use CLI context output as a
starting point, then read source files before editing them.

## Source Files

Sigil source files use `.sigil`.

The directory-index filename is `#module.sigil`. It may appear in any included
directory and must declare at least one local component. Its local components
and successfully resolved direct import names form that directory's import
surface. An imports-only index produces `SIGIL_MODULE_WITHOUT_COMPONENT`.

A strict JSON `.sigil/config.json` is mandatory at the workspace root. It selects
Sigil version, provides `workspace.name`, declares
optional `workspace.members`, and defines file include and exclude globs. A nested config defines an independent workspace only
when its entire subtree is excluded by each configured parent; otherwise it is
invalid.

Sigil files should live as near as practical to the code they describe.
Configured workspace boundaries use ordinary summary components in the
workspace-root and declared-member `#module.sigil` files. Internal contracts
use descriptive `.sigil` filenames, while internal directories may add a module
index when they need import shorthand. If the main `component` must live
elsewhere, a nearby `expand Name` may live beside the code it explains.

When implementation establishes a clear owner directory, relocate a temporary
Sigil file beside that implementation and update affected imports. Keep the
configured-boundary `#module.sigil` in place. Internal module indexes may move
with their owning directories. If a shared component contract cannot move,
colocate its implementation-specific `expand Name` instead.

### Module indexes and boundary summaries

Every component is public and may be imported through its explicit `.sigil`
source path whether or not a module index names it. `#module.sigil` controls
only which names resolve through a directory import. Sigil has no export or
re-export form.

For Brownfield adoption, each configured workspace boundary receives an
ordinary summary component in its `#module.sigil`. Its `goal` and `interface`
describe that boundary, and a matching expand uses the general section meanings.
This summary has no special parser or resolver status.

Exclude secrets, incidental dependencies, low-level configuration, and
module-specific implementation details from configured-boundary summaries.
`.sigil/config.json` remains the workspace marker and sole workspace-membership
authority. Package manifests and directory structure alone do not declare
additional Brownfield summary boundaries. An excluded nested directory with its
own config is an independent workspace, not a parent workspace member.

## Top-Level Forms

```sigil
@packages/member import { ComponentName }
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

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

`@packages/member import { ComponentName }` imports from that directory's
`#module.sigil`, regardless of whether the directory is a declared member.
`@sub/folder/auth.sigil import { Auth }` imports from `sub/folder/auth.sigil`.

Importing `Name` makes the component's public `goal`, `interface`, and public
interface concepts available to the current file. Matching expands remain
private and are available only when the provider is explicitly selected for
review or implementation.

`component` defines the reusable public contract of a coherent system part
through its public `goal` and `interface`. `expand` adds collective operational detail
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

`goal` publicly describes why the component exists, the responsibility it owns,
and its intended outcome. `interface` contains only the operations, data,
events, results, errors, and observable promises publicly available to
dependents.

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

## Concept Blocks

Concept block syntax:

```sigil
interface {
  SessionLifecycle {
    open(credentials) returns Session.

    close(sessionId).
  }
}
```

`SessionLifecycle` is a reusable concept identifier. A block may contain one
heavily reused idea or several related semantic lines. Concept blocks are flat,
nonempty, and cannot nest.

Identifiers match `[A-Za-z][A-Za-z0-9_-]*`. References are case-sensitive, but
accessible namespace uniqueness is case-insensitive. PascalCase without
hyphens or underscores is preferred formatting rather than a validity rule.

Each contiguous ungrouped `interface` region produces
`SIGIL_MISSING_CONCEPT_IDENTIFIER` as a warning. Ungrouped content remains
parseable. `state`, `logic`, `constraints`, and `cases` use concept blocks only
when cross-section reuse is valuable.

A component and all matching expands share one flat namespace. Repeated blocks
are collective and retain their section and source locations. A concept is
public when it occurs in `interface`; otherwise it remains private.

Imports expose public concepts as bare identifiers. Reusing an imported concept
keeps its originating identity while consumer lines remain contextual to the
consumer. Reusing it in `interface` re-exposes the same identity downstream.
Provider context never gains consumer lines. Sigil provides no dotted concept
notation, aliases, local shadowing, or nested concept blocks.

Known whole-word identifiers inside semantic content resolve as references for
navigation and highlighting. Unknown words remain ordinary free-form content
without unresolved-reference diagnostics.

## Imports

Import syntax:

```sigil
@path import { Name }
@path import { Name, OtherName }
```

A path without a `.sigil` filename resolves to `#module.sigil` in the target
directory. A name resolves from that index's local components or successfully
resolved direct imports. Components omitted from the index remain public through
their explicit `.sigil` filenames. The `@` prefix resolves from the workspace
root selected by the single ancestor `.sigil/config.json`. An explicit root must
contain `.sigil/config.json` directly.

Imported names must resolve to matching `component` declarations. Imported names
are case-sensitive. Dependents receive only public goal, interface, and public
concept information. Matching expands remain collective private detail when the
provider itself is selected.

Imports are the dependency declarations between Sigil components. Do not repeat
an imported-component dependency in `interface`.

## Section Placement

Use `goal` for why the component exists.

Use `interface` for public interactions: inputs, outputs, operations, events,
results, errors, and observable promises available to dependents.

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

Implementation-hiding rules and forbidden internal access belong in
`constraints` unless they define an externally observable promise.

Use `cases` for examples and acceptance criteria that can be observed from
outside the component.

## Semantic Lines

Each non-empty line inside a section is a semantic unit and possible future
anchor target. Separate distinct prose-level ideas with blank lines in every
section. Blank lines do not create semantic units. Keep lines in one compact
free-form construct adjacent when separation would reduce readability.

A concept-block header identifies and groups semantic lines but is not itself a
semantic line. Each non-empty line inside the block remains a distinct semantic
unit and records its concept identifier.

Prefer one distinct idea per line. Avoid burying multiple decisions in a
paragraph when they may need separate review, diffing, or source mapping.

ASCII content should avoid unmatched `{` or `}` characters because the current
parser uses braces to track section boundaries.

## Review Checks

When reviewing Sigil, check:

- Does every component explain why it exists?
- Does every `#module.sigil` declare at least one local component?
- Does every component expose how callers, users, modules, or other parts
  interact with it?
- Is every interface region grouped under one or more concept identifiers?
- Are repeated concept blocks coherent, flat, nonempty, and unambiguous across
  the accessible import graph?
- Do imported dependency views exclude private concepts and expands?
- Were coherent internal abstractions and UI surfaces considered as components
  rather than hidden beneath only high-level project or service contracts?
- Does each imported name resolve to a matching component in the imported Sigil
  source?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in
  `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation-hiding rules and forbidden internal access in constraints
  unless they define an externally observable promise?
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
