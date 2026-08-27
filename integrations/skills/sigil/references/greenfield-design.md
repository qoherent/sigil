<!--
@sigil implements integrations/skills/sigil/workspace-bootstrap.sigil::SigilWorkspaceBootstrap::GreenfieldWorkflow logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ConceptIdentifierWorkflow interface,logic,constraints
-->

# Greenfield Sigil Design

Use this procedure when the selected behavior or component has no existing
implementation that constrains its intended contract. Treat conversation as a
normal design activity, not merely a response to an unclear prompt.

## Contents

1. Frame the design conversation
2. Explore questions and choices
3. Establish boundaries and contracts
4. Review and synthesize scoped Sigil edits
5. Write and validate the scoped Sigil
6. Limits and examples

## 1. Frame The Design Conversation

Start by understanding what should exist before deciding how to implement it.
Ask about the problem, intended users or callers, desired outcomes, important
non-goals, and constraints that materially shape the contract.

Do not merely encode the first idea. A request may sound concrete while hiding
unresolved ownership, lifecycle, failure, security, persistence, compatibility,
or verification decisions.

Follow `references/design-conversation.md` for conversation phases, decision
states, exploration and correction modes, DesignContext, prioritization,
one-primary-decision turns, recommendations, checkpoints, conflict handling,
and the synthesis exit condition. Greenfield design is explicit design work, so
conversation applies even when the initial request appears clear.

After the intended outcome, affected users or callers, responsibility boundary,
external surface, and known risk constraints are sufficiently framed, follow
`references/external-guidance-evidence.md`. Assess applicability and acquire
required or recommended authoritative evidence before the design conversation
presents affected alternatives, pitfalls, or recommendations.

Use the shared protocol to resolve Greenfield decisions about:

- product purpose and intended outcome;
- users, callers, or adjacent systems;
- public operations, events, and interaction surfaces;
- ownership, boundaries, and non-responsibilities;
- state, lifecycle, concurrency, ordering, and failure behavior;
- permissions, sensitive data, destructive behavior, and recovery;
- binding architecture, platform, persistence, and interoperability choices;
- observable acceptance scenarios and verification needs.

## 2. Explore Questions And Choices

Use the shared design conversation to surface hidden assumptions, conflicting
goals, missing failure behavior, and decisions that could make the resulting
system weaker than intended. Greenfield choices should explain the product,
ownership, compatibility, complexity, lifecycle, and operational consequences
that materially distinguish the alternatives.

Continue until no unresolved Greenfield decision can materially change the
contract. Carry confirmed decisions, provisional assumptions, and intentionally
deferred non-blocking decisions into the conversation synthesis. Do not invent a
Sigil line for a deferred decision.

## 3. Establish Boundaries And Contracts

Choose the smallest coherent component boundary supported by the conversation.
Model stable responsibilities rather than mechanically mirroring anticipated
files, classes, tables, screens, or framework layers. A programming abstraction,
internal API, state machine, screen, view, or reusable UI surface is still a
component when it owns a coherent responsibility and exposes a stable contract
relied upon by dependents.

Do not combine independently changing responsibilities beneath one high-level
component. Separate a responsibility when it owns a distinct relied-upon
contract, mutable state, lifecycle, policy, or durable reason to change. The
resulting Sigil architecture must be modular enough to guide implementation
into corresponding cohesive owners.

When the design includes a `ModuleIndexFile`, keep it as a concise local summary
and intentional namespace-assembly surface. Place boundary-wide architectural
constraints and durable decisions there, then colocate operational detail with
its narrower component or expand owner.

For each proposed component identify:

- its responsibility and intended outcome;
- who or what uses it;
- the public interface and observable guarantees;
- the state or policy it owns;
- important non-responsibilities, recorded in `scope`;
- dependencies on other public contracts.

Before creating local components or concepts, inspect accessible imported public
identities and reuse every semantic match. Preserve distinct identities when
the responsibilities or meanings differ.

Draft `goal` and `interface` first. Then add only operational detail that helps
implementation and review:

- `state` for meaningful runtime or domain configurations;
- `logic` for behavior, flows, decisions, and transitions;
- `constraints` for invariants, policy, architecture, and binding choices;
- `decisions` for durable rationale behind material selected choices;
- `cases` for externally observable outcomes and edge conditions.

Use one semantic idea per non-empty line. Keep private algorithms and storage
layout out of public interfaces unless they are deliberate guarantees.

When implementation shape is material and already clear, follow
`references/implementation-design.md` and include implementation components,
implementation-specific expands, and the coverage map in the same scoped write.
Otherwise complete implementation design after the higher-level contract is
validated and use a separate Sigil review cycle.

## 4. Review And Synthesize Scoped Sigil

Apply `references/standards-review.md` before asking for final approval. Verify
the currency and applicability of evidence packets created during design
conversation, then review semantic readiness, applicable guidance, cross-Sigil
coherence, modularity, constraint-derived cases, and evidence or uncertainty.

Review the exact ungrouped written change first. If semantic readiness is
`correction required`, enter DesignConversation in correction mode and stop
before concept grouping. Investigate a suspected finding before assigning that
state. Only after readiness appears aligned may
`references/authoring-conventions.md` group interface concepts. Repeat semantic
review on the grouped write before file review.

Before approval, inventory every material selected choice in the proposed
contract and include its matching decision record or justified omission in the
decision-rationale coverage map.

Then present:

### Conversation Synthesis

Summarize the agreed goal, users or callers, boundaries, major choices,
tradeoffs accepted, and deliberately deferred questions.

### Proposed Boundaries And Ownership

Describe each component's responsibility, public dependents, owned state or
policy, and important non-responsibilities.

### Written Sigil

Write the scoped components, expands, and imports directly to their target
files. Use those files as the review artifact; do not duplicate their full text
in chat.

### Proposed Locations And Imports

List each target path, why it owns the contract or expand, and every import that
will be added or updated.

### Conflicts And Open Decisions

Report unresolved conflicts, unavailable guidance, intentionally deferred
choices, and any uncertainty that blocks implementation.

### Written-File Review

Report the target workspace root, changed paths, exact scope, semantic change
set, and evidence. The user reviews the written files before implementation.

## 5. Validate Written Sigil

After writing the scoped Sigil:

1. create or update only the scoped Sigil files;
3. run `sigil check` on the workspace;
4. use `sigil retrieve --purpose architecture` when relationships changed; use
   `graph` or `context` only for missing detail;
5. reread the written files and repeat semantic, coherence, and modularity
   review;
6. repeat the decision-rationale coverage audit against the written semantic
   lines and return to proposal review when coverage is missing;
7. if concept grouping is still required, write it to the scoped Sigil, then
   rerun deterministic and semantic review;
8. perform glossary candidate extraction only after the final semantic review
   appears aligned;
9. report changed files, captured decisions, open questions, and validation
   results without creating another approval gate.

Do not write implementation code in the same pass. When implementation is
requested, run the implementation coverage procedure if it was not already
completed and submit the validated written Sigil and exact implementation scope
together to `ReviewGate(action: implementation)`. Implement only when it
returns ready and every material implementation concern has established
coverage or an intentional omit decision.

If implementation reveals a missing material decision, return to conversation,
update and validate the written Sigil before resuming implementation review.

## 6. Limits And Examples

Do not ask questions merely to appear thorough. Each question or choice should
materially improve product intent, public behavior, ownership, lifecycle,
architecture, risk handling, or verification.

Use the shared conversation protocol instead of presenting every possible
concern at once.

### Competing Designs

A user asks for notifications. Explore recipients, delivery guarantees,
preferences, retries, ordering, and failure visibility. If synchronous delivery,
queued delivery, and event-driven delivery are all plausible, present their
contract-level consequences and a recommendation before drafting Sigil.

### Weak Initial Assumption

A user asks for one component to own authentication, billing, and reporting.
Explain the ownership and change-coupling consequences, offer cohesive boundary
choices, and let the user revise or retain the original direction knowingly.

### Apparently Clear Request

A user asks for a REST endpoint with an exact path and payload. Still explore
caller identity, validation, errors, idempotency, lifecycle effects, and
compatibility when those decisions materially affect the contract.
