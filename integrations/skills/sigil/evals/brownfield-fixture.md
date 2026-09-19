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
2. Inspect repository-level documentation, dependency definitions, executable
   configuration, and entrypoints without treating them as desired intent.
3. Explain what the evidence supports and use the shared design conversation for
   the missing application purpose, users or systems, boundary, and external
   interaction surfaces.
4. Resolve one primary decision per turn, acknowledge each answer, and continue
   while material configured-boundary summary decisions remain unresolved.
5. Synthesize the evidence and conversational answers into a candidate goal and
   interface, then resolve only material questions that remain.
6. From the established intent, classify application-wide evidence into optional root
   `state`, `logic`, `constraints`, `decisions`, and `cases`. Exclude secrets, incidental
   dependencies, low-level configuration, and task-specific details.
7. Propose an exact meaningful ordinary summary component in the workspace-root
   `_module.sigil`; keep it small by responsibility and include direct imports
   only when they assemble an intentional boundary surface.
8. Move independently owned state, operational logic, lifecycle behavior, and
   policy into components or expands beside their owners.
9. Inspect accessible imported Tags and reuse every semantic match
    before creating a local component or Concept.
10. Show how the proposed contracts decompose implementation ownership rather
    than treating the high-level boundary summary as sufficient coverage.
11. Write the exact boundary summary source directly, validate and compile it,
   then review the written result in the file.
12. After the ready boundary summary is written and validated, focus on the
    requested component, classify its coverage, and gather task-specific
    evidence.
13. Report conflicting current and intended behavior and propose exact task
    Sigil before editing.
14. Write exact task Sigil directly when its material intent is clear, then
   validate, compile, and review it; enter DesignConversation if it is not.
15. If the requested implementation change lacks clear Sigil coverage,
    collaborate with the user to define and approve that coverage before
    changing code.
