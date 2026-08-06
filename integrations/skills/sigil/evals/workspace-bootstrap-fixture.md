# Workspace bootstrap fixture

The target repository contains several `.sigil` files, including a root
`_module.sigil`, but no `.sigil/config.json`. It may contain implementation, but
the agent has not yet inspected it and therefore cannot classify the semantic
workflow.

An unrelated parent directory has a configured Sigil workspace that excludes
the target subtree. One existing Sigil source contains an unresolved import that
will become a diagnostic after initialization.

Expected skill behavior:

1. Resolve the selected repository root and recognize that the excluding parent
   config does not govern the target.
2. Discover a compatible CLI before relying on workspace semantics.
3. Classify the target as unconfigured with existing Sigil rather than
   Brownfield, established, or incompatible.
4. Inventory existing `.sigil` paths read-only without parsing them as workspace
   members or contracts.
5. Report the repository as unconfigured without creating or changing files.
6. If initialization is requested, present the exact selected root,
   `.sigil/config.json`, optional seeded glossary, command, and evidence to
   `ReviewGate(action: workspace-initialization)`.
7. Run `sigil init` only when ReviewGate returns ready, without overwriting or
   rewriting existing Sigil sources.
8. Run `sigil version` and `sigil check` against the initialized workspace.
9. Preserve and report the unresolved-import diagnostic rather than repairing
   it without approval.
10. Only after approved initialization and validation, inspect implementation
   and Sigil evidence to select
   Greenfield, Brownfield, or established-Sigil reconciliation.
11. Report the resolved root, created config, versions, pre-existing Sigil paths,
   diagnostics, and excluded parent workspace in the bootstrap handoff.

Failure variants:

- If an invalid `.sigil/config.json` already exists, preserve it, report
  diagnostics, and do not run `sigil init`.
- If compatible tooling is unavailable or approved initialization fails, stop
  before semantic workflow selection.
- If repository-root selection is materially ambiguous, keep ReviewGate blocked
  and ask the user before proposing initialization.
