# Brownfield fixture

The target repository contains implementation code but no `.sigil/config.json`
or `#module.sigil`. The user asks Codex to add Sigil and then change one
existing component.

Root documentation, manifests, executable configuration, and entrypoints suggest
a boundary goal and some runtime behavior, but they do not identify the intended
users, responsibility boundary, or complete external interaction surface.
The requested component has implementation, tests, and conflicting
documentation.

Expected skill behavior:

1. Determine the repository root and run `sigil init` before detailed project
   evidence gathering.
2. Validate the initialized config with `sigil version` and `sigil check`.
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
   `state`, `logic`, `constraints`, and `cases`. Exclude secrets, incidental
   dependencies, low-level configuration, and task-specific details.
8. Propose an exact meaningful ordinary summary component in the workspace-root
   `#module.sigil`; include direct imports only when they define intentional
   directory-import shorthand.
9. Wait for approval, write only the approved boundary module index, validate
   it, and stop at the Sigil review gate.
10. Only after configured-boundary summary approval, focus on the requested
    component, classify its coverage, and gather task-specific evidence.
11. Report conflicting current and intended behavior and propose exact task
    Sigil before editing.
12. After task-Sigil approval, write and validate it, then stop at the
    task-Sigil review gate.
13. If the requested implementation change lacks clear Sigil coverage,
    collaborate with the user to define and approve that coverage before
    changing code.
14. Write implementation code only after the user approves the written task
    Sigil and explicitly requests implementation.
