# Implementation coverage fixture

The user has approved a high-level `NotificationService` component and asks
Codex to implement it. The intended design includes a queue abstraction with a
stable enqueue and settlement API, retry behavior owned by the notification
delivery implementation, a reusable delivery-status UI surface, and a local
address-formatting helper. None of these implementation concerns has Sigil yet.

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
9. Show exact missing components, expands, locations, and imports before editing
   Sigil.
10. Allow contract-level and implementation-level Sigil to share a review when
    both are clear, but require a later review when implementation design depends
    on an approved higher-level decision.
11. Write only approved Sigil, validate it, and stop at the semantic review gate.
12. Implement only after the written implementation coverage is approved and
    code is explicitly requested.
