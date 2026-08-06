# Brownfield fixture

The target repository contains implementation code but no `.sigil/config.json`
or `_module.sigil`. The user asks a coding agent to add Sigil and then change one
existing component.

Root documentation, manifests, executable configuration, and entrypoints suggest
a boundary goal and some runtime behavior, but they do not identify the intended
users, responsibility boundary, or complete external interaction surface.
The requested component has implementation, tests, and conflicting
documentation.

Expected skill behavior:

1. Determine the repository root, inventory Sigil paths, and report the
   repository as unconfigured without mutation.
2. If initialization is requested, submit the exact root and files to
   `ReviewGate(action: workspace-initialization)`, run `sigil init` only when
   ready, and validate with `sigil version` and `sigil check`.
3. Inspect repository-level documentation, dependency definitions, executable
   configuration, and entrypoints without treating them as desired intent.
4. Explain what the evidence supports and use the shared design conversation for
   the missing application purpose, users or systems, boundary, and external
   interaction surfaces.
5. Resolve one primary decision per turn, acknowledge each answer, and continue
   while material configured-boundary summary decisions remain unresolved.
6. Synthesize the evidence and conversational answers into a candidate goal and
   interface, then request separate confirmation.
7. After confirmation, classify application-wide evidence into optional root
   `state`, `logic`, `constraints`, `decisions`, and `cases`. Exclude secrets, incidental
   dependencies, low-level configuration, and task-specific details.
8. Propose an exact meaningful ordinary summary component in the workspace-root
   `_module.sigil`; keep it small by responsibility and include direct imports
   only when they assemble intentional directory-import shorthand.
9. Move independently owned state, operational logic, lifecycle behavior, and
   policy into components or expands beside their owners.
10. Inspect accessible imported public identities and reuse every semantic match
    before creating a local component or concept.
11. Show how the proposed contracts decompose implementation ownership rather
    than treating the high-level boundary summary as sufficient coverage.
12. Submit the exact boundary module index to
   `ReviewGate(action: sigil-change)`, write only when ready, validate it, and
   report the written result without another approval gate.
13. After the ready boundary summary is written and validated, focus on the
    requested component, classify its coverage, and gather task-specific
    evidence.
14. Report conflicting current and intended behavior and propose exact task
    Sigil before editing.
15. Submit exact task Sigil to `ReviewGate(action: sigil-change)`, then write,
    validate, and report it only when ready.
16. If the requested implementation change lacks clear Sigil coverage,
    collaborate with the user to define and approve that coverage before
    changing code.
17. Write implementation code only when
    `ReviewGate(action: implementation)` is ready for the validated written task
    Sigil and exact implementation scope.
