# Sigil Format Reference

This is a compact agent-facing reference for Sigil syntax, section placement,
and review heuristics during a coding-agent session.

The author-facing canon is the Sigil authoring guide at repository path
`spec/sigil-language.md`. The normative specification is
`spec/sigil-reference.md`, with its grammar in `spec/sigil.ebnf`. This file
restates that material for quick recall and does not add language rules. It
describes Sigil language version `0.8.0`.

## CLI Assistance

When a `sigil` command is available on `PATH`, prefer it for mechanical parsing,
validation, graph, context, and render operations.

An installed skill does not include the Sigil platform repository's
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

Run `sigil version . --format json --pretty` before `check`. A source requires a
tool that supports its configured language version; do not apply this reference
to an unsupported workspace version.

Use CLI diagnostics as stable coded findings. Use CLI context output as a
starting point, then read source files before editing them.

## Source Files

Sigil source files use `.sigil`.

A strict JSON `.sigil/config.json` is mandatory at the workspace root. It selects
the Sigil version, provides `workspace.name`, optionally declares
`workspace.members`, and defines file include and exclude globs. The workspace
root is the directory containing `.sigil`; an explicit root must contain
`.sigil/config.json` directly. A nested config defines an independent workspace
only when its entire subtree is excluded by each configured parent; otherwise it
is invalid.

`_module.sigil` is an ordinary source filename that may hold a project summary.
It has no import-resolution, directory-index, export, or re-export behavior.
Imports use explicit included `.sigil` paths, regardless of directory
membership.

Keep Sigil files as near as practical to the code they describe. Keep a
configured-boundary summary source at the workspace root or declared-member
boundary; put implementation-specific Facets beside the code they explain.
Update affected imports and relative links after any placement-only move.

### Module summaries

Each configured workspace boundary receives an ordinary summary component in its
summary source. Its `goal` and `interface` describe that boundary; other
contracts carry boundary-wide architecture, constraints, and durable design
decisions. This summary has no special parser or resolver status.

As an authoring convention, keep every summary small by responsibility. Use it
to describe the boundary and retain only boundary-wide architectural constraints
and durable design decisions. Put material state, operational logic, detailed
lifecycle behavior, and independently changing policy in narrower components
beside their owners.

Before creating local components or Concepts, inspect every accessible imported
Tag and reuse each semantic match. Similar wording does not justify reuse when
the underlying responsibility or meaning differs.

Exclude secrets, incidental dependencies, low-level configuration, and
module-specific implementation details from boundary summaries. `.sigil/config.json`
remains the workspace marker and sole workspace-membership authority. Package
manifests and directory structure alone do not declare additional Brownfield
summary boundaries. An excluded nested directory with its own config is an
independent workspace, not a parent workspace member.

## Top-Level Forms

```sigil
@providers/worker.sigil from Worker import { Running, Idle }

component Name {
  goal {
    why this component exists
  }

  interface {
    PublicBehavior {
      how this component interacts with the outside world
    }
  }

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

      Design issues addressed: Concurrent writers require transactional consistency.
    }
  }

  cases {
    externally observable examples, acceptance criteria, and edge cases
  }
}
```

There are two top-level forms: a Tag import and a component. A component owns one
bounded responsibility with one workspace-unique name and holds all seven
contracts inside its single declaration. Each contract appears at most once.
`component` is the only declaration form; there is no separate operational
detail form.

A Tag import selects Tags owned by one component in an explicit `.sigil` source.
The provider component is not itself imported and no namespace is introduced.

A component's responsibility is relative to its dependents. A component may
represent a product surface, domain module, programming abstraction, internal
API, state machine, screen, view, or reusable UI surface even when it is not
externally visible. Do not mechanically create a component for every code symbol
or visual element; use cohesive responsibility and a relied-upon contract as the
boundary. A component can describe code in multiple implementation files without
splitting its declaration.

## Required And Optional Sections

A component requires:

- `goal`
- `interface`

`goal` describes why the component exists, the responsibility it owns, and its
intended outcome. `interface` contains only the operations, data, events,
results, errors, and observable promises available to dependents. Each required
contract must contain at least one Facet, directly or inside a Concept.

A component may also contain:

- `state`
- `logic`
- `constraints`
- `decisions`
- `cases`

Conventional section order:

```text
goal
interface
state
logic
constraints
decisions
cases
```

The order is only a readability convention.

## Concepts

Concept syntax:

```sigil
interface {
  SessionLifecycle {
    open(credentials) returns Session.

    close(sessionId).
  }
}
```

A Concept (`tag_group`) is a bare `tag_name` heading with a braced body that
gathers related Facets. Its `group_open` header identifies and groups Facets but
is not itself a Facet. Concepts are flat, nonempty, and cannot nest. Direct,
grouped, and mixed Facets are valid in every contract.

A heading introduces or reuses a local Tag. Reuse the same exact Concept across
contracts when its Facets address one concern; this gathers them into one
cross-contract Concept without merging their contract roles. Copy its spelling
and case exactly. A Concept need not occur in all seven contracts, and its
identity does not require a matching class or function in code.

Tag names are nonempty, may contain multiple words, and are case-sensitive;
commas, braces, and asterisks are not name content. Accessible Tag names must
resolve unambiguously. PascalCase without hyphens or underscores is the preferred
formatting, not a validity rule.

Concepts are encouraged when they organize the several concerns commonly found
in a component and connect their Facets across contracts. They are optional in
every contract: smaller components may not need them, and ungrouped Facets can
freely mix with grouped Facets. Preserve meaningful groups; avoid mechanical
wrappers. Give a distinct concern its own Concept rather than one catch-all
block, and keep shared guarantees and standalone Facets direct where clearer.
For concrete use-or-skip guidance, see
[Concepts](authoring-conventions.md#concepts).

Every Tag a component introduces, inline or as a heading, is owned by that
component and may be selected by a Tag import. Headings never receive their
identity from imports.

Known whole-word Tag names inside semantic content resolve as references for
navigation and highlighting. Unknown words remain ordinary free-form content
without unresolved-reference diagnostics. Sigil provides no dotted Tag notation,
aliases, local shadowing, or nested Concepts.

## Imports

Import syntax:

```sigil
@providers/worker.sigil from Worker import { Running }
@providers/worker.sigil from Worker import { Running, Idle }
```

A path without a `.sigil` filename is not a directory shorthand; a directory
path does not resolve through `_module.sigil`. The path resolves from the
workspace root selected by the single ancestor `.sigil/config.json`. An explicit
root must contain `.sigil/config.json` directly. Resolve source, provider
component, and selected Tags separately. Imported names are case-sensitive and
must resolve to Tags owned by the named component in that exact source.

Imports are the dependency declarations between Sigil components. Do not
restate an import as an `interface` Facet.

Every resolved selected Tag must have a qualifying exact-case bare reference
somewhere in the importing source. Any contract counts, including `goal` and
`decisions`. Introductions to Embedded Facets count; headings, fenced content,
complete Inline Links, and mere provider-component mentions do not count. An
unused selection is an error reported as `SIGIL_UNUSED_TAG_IMPORT`.

Only selected provider identities enter the importing source's accessible
vocabulary; all components in that source see the same imports. Importing a Tag
neither copies provider obligations into the consumer nor creates a re-export.
Duplicate selections, unknown or ambiguous selections, and local/imported name
collisions are errors. Import cycles are allowed; a cycle supplies no missing
definition and changes no ownership.

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

Use the optional `decisions` section for durable rationale behind a material
selected choice. Language syntax does not require Concepts or labeled fields,
but the Sigil skill uses this convention:

```sigil
decisions {
  PersistenceChoice {
    Decision: Use PostgreSQL.

    Scope: Governs payment persistence and transaction handling. Analytics storage is excluded.

    Assumptions: Managed PostgreSQL is available.

    Trade-offs: Strong consistency is preferred over simpler local persistence.

    Design issues addressed: Prevents conflicting writes and ambiguous recovery.

    Discarded alternatives: SQLite was rejected because multi-writer operation is required.

    Consequences: Persistence changes must preserve transaction boundaries.

    Revisit when: Deployment or concurrency requirements change.
  }
}
```

For a material decision, record its choice and scope as Facets. A Concept is
optional and useful only when its identity connects related contributions
across contracts. `Decision` and `Scope` labels may improve clarity but are not
mandatory syntax. Scope states the governed boundary and important exclusions
without enumerating every current dependent. Add `Assumptions`, `Trade-offs`,
`Design issues addressed`, `Discarded alternatives`, `Consequences`, and
`Revisit when` when materially applicable, and omit inapplicable labels.

Keep the binding selected outcome in `constraints`. Reuse an accessible Tag when
a contextual decision concerns the same semantic idea, but keep Scope local: Tag
reuse does not make the decision transitively binding. Imports select vocabulary,
not a provider's private decision rationale. Treat direct-dependency decisions
supplied by agent context as scoped rationale, and inspect the provider and its
component explicitly for transitive decisions or other operational detail.

Do not store prompts, raw session transcripts, or hidden reasoning.
Responsibility, accountability, approver, and handoff metadata are outside the
initial convention.

Use `cases` for examples and acceptance criteria that can be observed from
outside the component. Cases expose decisions rather than merely declaring
success: a Case is a situation plus an observation.

## Facets

Each blank-line-delimited prose paragraph inside a section is one Facet.
Adjacent physical lines belong to that unit, so prose may be rewrapped without
changing semantic identity. Separate distinct ideas with blank lines. Blank
lines terminate Facets and do not create them. Structural boundaries also
terminate them.

A Concept heading identifies and groups Facets but is not itself a Facet. Each
paragraph inside the Concept records that heading's Tag.

Prefer one distinct idea per Facet. Avoid burying multiple decisions in a
paragraph when they may need separate review, diffing, or source mapping.

Ordinary prose has a 79-character content width. Leading indentation does not
count. Run `sigil fmt [path]` to wrap selected valid sources, or add `--check`
to verify canonical formatting without writing.

Use a directly attached typed fenced content for multiline code, JSON,
configuration, pseudocode, Markdown lists and tables, diagrams, or other
layout-sensitive content:

````sigil
The service uses this configuration:
```json
{
  "enabled": true
}
```
````

Do not put a blank line between introducing prose and its opening fence. The
opener uses at least three backticks and an optional type matching
`[A-Za-z][A-Za-z0-9_+.-]*`; the closing fence has at least the opener's length
and no other content. Literal bodies preserve blank lines, braces, and relative
indentation. They are excluded from width checks and semantic-reference,
import-use, glossary, and ownership scanning.

## Review Checks

When reviewing Sigil, check:

- Does every component explain why it exists?
- Does each summary source stay a concise architectural summary and an
  intentional boundary description rather than an operational dumping ground?
- Are material state, operational logic, lifecycle behavior, and independently
  changing policy colocated with narrower owners?
- Does every component expose how callers, users, modules, or other parts
  interact with it?
- Have the component's distinct concerns been identified and usefully connected
  across contracts, while preserving clear ungrouped and mixed Facets?
- Are repeated Concepts coherent, flat, nonempty, and unambiguous across the
  accessible import graph?
- Were semantically matching imported Tags reused before local synonyms or
  duplicate contracts were introduced?
- Were coherent internal abstractions and UI surfaces considered as components
  rather than hidden beneath only high-level project or service contracts?
- Can the component decomposition guide implementation into cohesive modules
  whose entrypoints only assemble the approved surface?
- Does each imported Tag resolve to a matching component-owned Tag in the
  imported Sigil source?
- Does each resolved imported Tag have a qualifying use outside headings,
  fenced content, and complete Inline Links?
- Are ordinary prose lines at most 79 content characters excluding indentation?
- Does every fenced content immediately follow its introducing prose?
- Are architecture and stack decisions expressed as constraints?
- Do material skill-authored decisions record Decision, Scope, and applicable
  rationale without treating Tag reuse as transitive authority?
- Are implementation-hiding rules and forbidden internal access in constraints
  unless they define an externally observable promise?
- Are roles, states, permissions, and lifecycle transitions explicit enough to
  test?
- For abstractions and APIs, are constructors/functions, return values,
  settlement/lifecycle behavior, and error behavior explicit?
- For UI components, are visible regions, actions, navigation, feedback, and
  applicable loading, empty, error, disabled, responsive, keyboard, and
  accessibility behavior clear?
- Are required visual references accessible, and is their intended role clear
  when different interpretations would change implementation?
- Are examples in `cases` externally observable?

A component's repeated Concepts are collective: read all Facets under one exact
Concept as gathered contributions. If they contradict each other, treat that as
a specification issue to resolve with the user.

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

Stack as a constraint (a component-body fragment):

```sigil
constraints {
  Stack is Next.js, Neon Postgres, and Drizzle ORM.

  The system ships as a single Next.js app.

  Database access goes through Drizzle.
}
```
