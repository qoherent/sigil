# Sigil Design Conversation

Use this procedure whenever material clarification is needed before Sigil can be
proposed or implementation can proceed. It is shared by Greenfield design,
Brownfield reconstruction, established-Sigil review, and implementation work.

The conversation turns an incomplete idea or conflicting evidence into a
coherent contract through small sequential decisions. It is not an exhaustive
questionnaire and does not replace the user's authority.

## Contents

1. Maintain the conversation state
2. Prioritize decisions
3. Run one conversational turn
4. Handle uncertainty and conflict
5. Use checkpoints
6. Finish or block the conversation
7. Limits and examples

## 1. Maintain The Conversation State

Track the current phase as:

- **framing:** establish the intended outcome, users or callers, boundary, and
  relevant evidence;
- **exploring:** discover material decisions, assumptions, conflicts, and
  pitfalls;
- **resolving:** decide the questions that shape the contract;
- **synthesizing:** summarize the coherent design and prepare exact Sigil;
- **awaiting approval:** wait for the user to approve, reject, or revise the
  proposal.

Maintain a lightweight decision ledger in conversation context. Classify every
material decision as:

- **confirmed:** explicitly decided by the user or already established by
  approved Sigil;
- **provisionally assumed:** a conservative, reversible assumption stated to the
  user;
- **intentionally deferred:** not required for the current contract and retained
  visibly for later work;
- **unresolved:** no safe decision exists yet.

Do not create a repository artifact for the ledger unless the user separately
requests one. Preserve its relevant confirmed and deferred outcomes in the
conversation synthesis and proposed Sigil.

## 2. Prioritize Decisions

Classify discovered questions by their effect on:

- purpose and intended outcome;
- users, callers, and repository or component boundary;
- responsibility, ownership, and non-responsibilities;
- public behavior and observable guarantees;
- state, lifecycle, concurrency, ordering, and failure behavior;
- permissions, sensitive data, destructive operations, and recovery;
- binding architecture, persistence, platform, and interoperability;
- acceptance scenarios and verification.

Ask the unresolved question whose answer most strongly shapes later decisions.
Prefer purpose before technology, boundary before decomposition, ownership
before data flow, lifecycle before failure policy, and public behavior before
private implementation detail.

A decision is blocking when leaving it unresolved could materially change a
public contract, ownership, permissions, sensitive or persistent data,
lifecycle, failure behavior, binding architecture, or acceptance criteria. Other
decisions may be provisionally assumed or intentionally deferred when the user
accepts that treatment.

## 3. Run One Conversational Turn

Present one primary design decision per turn unless the user asks for a faster
grouped review. Include tightly coupled subquestions only when separating them
would make the decision misleading or impossible to answer.

Each turn should:

1. acknowledge the user's previous answer and state its effect on the emerging
   contract;
2. briefly explain why the next decision matters and what later choices depend
   on it;
3. ask one direct question in the user's vocabulary;
4. when alternatives exist, offer a small concrete set with their meaningful
   consequences and a reasoned recommendation;
5. make clear that the user may combine, reject, revise, or replace the offered
   choices.

After the answer, update the decision ledger, restate the resulting decision,
and detect any new conflict or dependent question. Do not ask a confirmed
decision again unless new evidence conflicts with it.

If the user requests a faster review, group only closely related decisions and
retain the same explanation, recommendation, acknowledgement, and ledger
behavior. Return to one primary decision when the grouped answers reveal a
conflict or material uncertainty.

## 4. Handle Uncertainty And Conflict

When the user is unsure, explain the uncertainty and recommend a conservative
option with its consequences. A low-risk, reversible choice may become a
provisional assumption after it is stated. A non-blocking choice may be deferred
and must remain visible in the synthesis.

Do not silently default a blocking decision. Ask for the required user decision
or qualified review when security, permissions, destructive behavior, persistent
data, compliance, or another high-impact concern remains ambiguous.

When an answer conflicts with an earlier decision, approved Sigil, repository
evidence, or applicable guidance:

1. stop advancing to unrelated questions;
2. state both conflicting ideas and their evidence or source;
3. explain the contract or implementation consequence;
4. offer concrete resolution choices when possible;
5. ask the user which intent should govern;
6. update the ledger only after the conflict is resolved or explicitly retained
   as blocking.

When the user appears overwhelmed, reduce the scope to the single most
foundational decision, shorten the explanation, and defer non-blocking topics.
Do not lower safety or approval requirements to make the conversation shorter.

## 5. Use Checkpoints

Give a compact checkpoint after several decisions, when the conversation changes
phase, when a conflict changes earlier conclusions, or when the user asks for
status. Report:

- confirmed decisions;
- provisional assumptions;
- intentionally deferred decisions;
- unresolved blockers;
- the next decision and why it is next.

Do not repeat the entire conversation. Keep the checkpoint small enough for the
user to correct the emerging design without losing momentum.

## 6. Finish Or Block The Conversation

Move to synthesis only when no unresolved decision can materially change the
contract being proposed. The synthesis must state:

- intended outcome, users or callers, and boundary;
- component responsibilities, ownership, and important non-responsibilities;
- public behavior, lifecycle, failure, and risk decisions;
- binding architecture or platform decisions;
- confirmed assumptions and accepted tradeoffs;
- intentionally deferred non-blocking decisions;
- any unavailable guidance or uncertainty that still requires acceptance.

Then prepare exact proposed Sigil using the applicable Greenfield, Brownfield,
semantic-review, and implementation-coverage procedures. Conversation is not
approval. Enter the awaiting-approval phase and wait for explicit review.

If a blocking decision remains unresolved, report it and continue the focused
conversation. Do not synthesize speculative Sigil or begin implementation.

## 7. Limits And Examples

Every question must materially improve product intent, public behavior,
ownership, lifecycle, architecture, risk handling, or verification. Do not
pursue immaterial hypothetical edge cases merely for completeness.

### Vague Product Idea

Ask who needs the outcome and what successful behavior looks like before asking
about frameworks, storage, or deployment.

### Competing Delivery Models

Explain the consequences of synchronous, queued, and event-driven delivery,
recommend one based on the confirmed outcome, and ask the user to choose or
describe another direction. Do not combine this with unrelated retention and UI
questions.

### Conflicting Answer

If the user first requires immediate deletion and later requires a complete
audit history, explain the conflict and resolve the retention contract before
continuing to storage design.

### Intentional Deferral

If branding details do not affect the current UI behavior contract, record them
as intentionally deferred and keep them visible in the synthesis without
blocking the proposal.
