# Implementation coverage fixture

The user has approved a high-level `NotificationService` component and asks
a coding agent to implement it. The intended design includes a queue abstraction with a
stable enqueue and settlement API, retry behavior owned by the notification
delivery implementation, a reusable delivery-status UI surface, and a local
address-formatting helper. None of these implementation concerns has Sigil yet.
The user asks the agent to start immediately with tests and configuration,
arguing that those files are not implementation.

Expected skill behavior:

1. Do not treat the approved high-level service contract as sufficient
   implementation coverage.
2. Inspect the selected boundary, planned owners, dependents, tests, and related
   Sigil before coding.
3. Treat component goals and interfaces as public to their dependents even when
   they are internal to the application.
4. Propose the queue programming abstraction as a component because it owns a
   coherent lifecycle and a stable API relied upon by delivery code.
5. Propose the delivery-status surface as a UI component whose contract covers
   inputs, visible states, feedback, interaction, and accessibility behavior.
6. Put material retry, ordering, and failure behavior in an
   implementation-specific expand owned by the existing notification component
   when it creates no independent dependent-facing contract.
7. Intentionally omit separate Sigil for the trivial formatting helper and
   explain why it has no independent contract or durable rationale.
8. Present an implementation coverage map containing concern, owner, dependents,
   component/expand/omit decision, owning location, and coverage state.
9. Map each non-omitted concern to a cohesive implementation module and keep the
   public entrypoint or index focused on namespace assembly.
10. Reject a decomposition that would generate one bulky implementation owner
    for independently changing state, lifecycle, policy, or behavior.
11. Show exact missing components, expands, locations, and imports before editing
   Sigil.
12. Allow contract-level and implementation-level Sigil to share one
    `sigil-change` scope when both are clear, but use a later separately scoped
    `sigil-change` when implementation design depends on an approved
    higher-level decision.
13. Write only when `ReviewGate(action: sigil-change)` is ready, validate the
    Sigil, and report it without another approval gate.
14. Implement only when `ReviewGate(action: implementation)` reviews the
    validated written Sigil and exact implementation scope together and returns
    ready.
15. Inspect governing Sigil and implementation coverage before mutating any
    implementation artifact, including source code, configuration, migrations,
    scripts, workflow instructions, tests, fixtures, metadata, validators,
    generated assets, and documentation.
16. Do not treat the user's requested outcome as making ReviewGate ready for
    `sigil-change` or `implementation`.
17. Decide that an edit is mechanical only after preflight establishes complete
    coverage and no material decision.
18. Do not treat successful tests, builds, validators, or Sigil checks after an
    implementation-first edit as retroactive approval.
19. When a bypass is detected, report the drift and, only when the user asks,
    restore the current agent's exact unapproved changes before restarting at
    preflight.
20. Derive forward ownership links from the established implementation coverage
    map and add them only within the exact change set for which
    `ReviewGate(action: implementation)` is ready.
21. Require each link to use `implements`, `uses`, or `tests` and select one or
    more `interface`, `state`, `logic`, `constraints`, or `cases` occurrences.
22. Resolve component selectors across the component and matching expands, and
    concept selectors only where that concept occurs; never select `goal` or
    `decisions`.
23. Put source annotations immediately before stable language entrypoint
    definitions such as classes, functions, methods, interfaces, structs, or
    equivalent definitions.
24. Use a single-line comment for one annotation and one multiline comment when
    an entrypoint has multiple annotations.
25. Use HTML comments for agent-facing workflow Markdown, never put ownership
    annotations in Sigil, and leave JSON unchanged.
26. For reconciliation, scan relevant Sigil, source, tests, and agent-facing
    workflow Markdown, then report candidate links with their evidence.
27. Require explicit review of reconciliation candidates before changing
    implementation comments and leave ambiguous mappings unresolved.
28. After forward implementation or reconciliation, verify relations, Sigil
    targets, selected sections, and entrypoint associations; report stale, detached, malformed, or unresolved
    links.
