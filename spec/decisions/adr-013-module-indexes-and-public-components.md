# ADR-013: Module Indexes And Public Components

**Status:** Accepted

**Owner:** Sigil maintainers

**Last updated:** 2026-07-21

## Context

Sigil 0.1 treated `#module.sigil` as a special project summary valid only at the
workspace root or a declared member root. That made directory imports depend on
workspace membership and prevented internal directories from defining concise,
intentional import entry points.

Sigil components are modeling contracts, not private implementation symbols.
An index therefore needs to control path convenience without inventing export
or visibility semantics.

## Decision

In Sigil 0.2.0, `#module.sigil` is the explicit directory-import index for its
containing directory and may appear at any included path.

Every component declaration is public and remains importable through its
explicit `.sigil` source path. A module index neither grants nor restricts that
visibility.

A directory import resolves a name from:

- a component declared directly in the target `#module.sigil`; or
- a component name successfully resolved by a direct import in that file.

Other files, unnamed dependencies, and components imported only by indexed
files are not added implicitly. Sigil defines no export or re-export form.
Explicit chains of module indexes may make a component resolvable through more
than one directory path.

The resolver preserves both the immediate module-index dependency and the
original component declaration path. Graphs use the immediate path for file
dependency edges and the declaration path for imported-component edges. Editor
definition navigation targets the original declaration.

The former special project-summary concept is removed. For Brownfield adoption,
the workspace root and each declared member still receive meaningful ordinary
summary components in their `#module.sigil` files. This is a workflow convention
derived from configured boundaries, not a parser or resolver rule. Internal
module indexes require no summary.

## Consequences

- Internal directories may provide concise directory imports.
- Explicit file imports keep every component public regardless of index content.
- Workspace membership no longer authorizes or restricts module-index paths.
- Imports-only module indexes are valid.
- Missing directory indexes use the existing unresolved-path diagnostic.
- The two diagnostics enforcing project-root-only indexes are removed.
- Sigil, core, CLI, LSP, editor integration, and skill advance to pre-production
  version 0.2.0.

## Acceptance Scenarios

- `@auth import { Session }` resolves when `auth/#module.sigil` declares or
  directly imports `Session`.
- `@auth/session.sigil import { Session }` resolves even when the module index
  omits `Session`.
- `@auth import { Store }` is unresolved when only `session.sigil` imports
  `Store` and the module index does not name it.
- An imports-only internal `#module.sigil` is valid.
- Definition navigation through a directory import opens the component's real
  declaration file.
- Brownfield workflow proposes ordinary summaries for the configured root and
  declared members before task-specific modeling.
