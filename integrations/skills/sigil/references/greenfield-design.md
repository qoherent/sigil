# Greenfield Sigil Design

Use this procedure when the selected behavior or component has no existing
implementation that constrains its intended contract. Treat conversation as a
normal design activity, not merely a response to an unclear prompt.

## Contents

1. Frame the design conversation
2. Explore questions and choices
3. Establish boundaries and contracts
4. Review and synthesize proposed Sigil
5. Apply an approved proposal
6. Limits and examples

## 1. Frame The Design Conversation

Start by understanding what should exist before deciding how to implement it.
Ask about the problem, intended users or callers, desired outcomes, important
non-goals, and constraints that materially shape the contract.

Do not merely encode the first idea. A request may sound concrete while hiding
unresolved ownership, lifecycle, failure, security, persistence, compatibility,
or verification decisions.

Follow `references/design-conversation.md` for conversation phases, decision
states, prioritization, one-primary-decision turns, recommendations,
checkpoints, conflict handling, and the synthesis exit condition. Conversation
is a normal design activity even when the initial request appears clear.

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

For each proposed component identify:

- its responsibility and intended outcome;
- who or what uses it;
- the public interface and observable guarantees;
- the state or policy it owns;
- important non-responsibilities;
- dependencies on other public contracts.

Draft `goal` and `interface` first. Then add only operational detail that helps
implementation and review:

- `state` for meaningful runtime or domain configurations;
- `logic` for behavior, flows, decisions, and transitions;
- `constraints` for invariants, policy, architecture, and binding choices;
- `cases` for externally observable outcomes and edge conditions.

Use one semantic idea per non-empty line. Keep private algorithms and storage
layout out of public interfaces unless they are deliberate guarantees.

When implementation shape is material and already clear, follow
`references/implementation-design.md` and include implementation components,
implementation-specific expands, and the coverage map in the same proposal.
Otherwise complete implementation design after the higher-level contract is
approved and use a separate Sigil review cycle.

## 4. Review And Synthesize Proposed Sigil

Apply `references/standards-review.md` before asking for final approval. Review
semantic readiness, applicable guidance, cross-Sigil coherence, modularity,
constraint-derived cases, and evidence or uncertainty.

Then present:

### Conversation Synthesis

Summarize the agreed goal, users or callers, boundaries, major choices,
tradeoffs accepted, and deliberately deferred questions.

### Proposed Boundaries And Ownership

Describe each component's responsibility, public dependents, owned state or
policy, and important non-responsibilities.

### Proposed Sigil

Show the exact components, expands, and imports that would be written. Do not
replace exact text with a high-level description.

### Proposed Locations And Imports

List each target path, why it owns the contract or expand, and every import that
will be added or updated.

### Conflicts And Open Decisions

Report unresolved conflicts, unavailable guidance, intentionally deferred
choices, and any uncertainty that blocks implementation.

### Approval Request

Ask the user to approve, reject, or revise the synthesis, boundaries, choices,
locations, imports, and exact semantic lines. Conversation is not approval;
approval applies to the synthesized proposal.

## 5. Apply An Approved Proposal

After explicit approval:

1. create or update only the approved Sigil files;
2. run `sigil check` on the workspace;
3. use `sigil graph` or `sigil context` when relationships changed;
4. reread the written files and repeat semantic, coherence, and modularity
   review;
5. stop at the Sigil review gate and report changed files, captured decisions,
   open questions, and validation results.

Do not write implementation code in the same pass. After the user approves the
written Sigil and explicitly requests implementation, run the implementation
coverage procedure if it was not already completed. Implement only after every
material implementation concern has an approved component, expand, or
intentional omit decision, and colocate implementation-specific Sigil with its
owner.

If implementation reveals a missing material decision, return to conversation,
update the Sigil proposal, and repeat the review gate.

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
