<!-- @sigil implements integrations/skills/sigil/workspace-bootstrap.sigil::SigilWorkspaceBootstrap::GreenfieldWorkflow logic,constraints,cases -->

# Greenfield design

Use this route for a requested responsibility without an existing implementation
that constrains its contract. Establish intended outcomes, callers, public
behavior, ownership, failure/lifecycle boundaries, and relevant constraints from
the user's request and available evidence. Ask about material unresolved decisions;
do not force an interview when the task is already specified.

Choose the smallest cohesive boundary. Separate areas only when deployment,
ownership, or independent reasons to change justify them. A summary source holds
the boundary summary and intentional imports; detailed state and operational
behavior belong beside their owners. Reuse accessible components and Tags.

Write goal and interface first, then material constraints, state, logic, and cases.
Record durable rationale for choices whose reasons cannot be safely reconstructed.
Use [authoring conventions](authoring-conventions.md); inspect applicable external
guidance only where the task needs it. Keep product decisions distinct from
recommendations and unknowns.

Validate with `sigil check`; use [native Design review](design-compilation-review.md)
for current semantic evidence. Repair actual defects and preserve warnings or
unavailable reconstruction honestly. Concept grouping and useful glossary work
are authoring activities, not evaluator stages. Continue authorized implementation
using [implementation design](implementation-design.md).
