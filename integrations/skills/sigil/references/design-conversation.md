<!-- @sigil implements integrations/skills/sigil/design-conversation.sigil::SigilDesignConversation::DesignConversation interface,state,logic,constraints,cases -->

# Sigil Design Conversation

Use this procedure for explicit design, review, or improvement work or when
inspected evidence exposes a material decision that requires user judgment. It
is shared by Greenfield design, Brownfield reconstruction, established-Sigil
review, and implementation work.

Do not enter design conversation merely because a request uses Sigil, triggers
preflight, or asks an ordinary status, explanation, diagnosis, or mechanical
change with no material design choice.

The conversation guides incomplete intent and existing contracts toward
coherent, modular, and improvable designs. It is not an exhaustive questionnaire
and does not replace the user's authority.

## Contents

1. Decide whether conversation applies
2. Build DesignContext
3. Maintain conversation state and mode
4. Prioritize decisions
5. Use external guidance evidence
6. Run one conversational turn
7. Handle uncertainty, findings, and conflicts
8. Use checkpoints
9. Finish or block the conversation
10. Limits and examples

## 1. Decide Whether Conversation Applies

Enter DesignConversation when at least one of these applies:

- the user explicitly requests design, architecture, review, or improvement;
- product or contract intent is incomplete and a material decision remains;
- review exposes a suspected or confirmed material problem that requires user
  judgment;
- a coherent existing contract has a credible improvement opportunity that
  requires a project choice;
- external guidance exposes a material conflict, alternative, or improvement
  that cannot be adopted without user authority.

Do not enter for:

- ordinary read-only status, explanation, or diagnosis;
- deterministic validation by itself;
- a mechanical implementation change with established coverage and no material
  design choice;
- an already coherent request whose relevant decisions and Sigil remain
  established;
- immaterial preferences or hypothetical edge cases.

Conversation applicability is a routing decision, not an approval gate.

## 2. Build DesignContext

Before asking a material architectural or design question, consume the component
picture produced by semantic and modularity review. DesignContext includes, when
applicable:

- the selected component and exact goal and interface;
- matching expands;
- imported and importing contracts;
- relevant workspace-root or declared-member summaries;
- nearby Sigil that owns related state, policy, lifecycle, or behavior;
- repository implementation, tests, documentation, and configuration evidence;
- observed behavior, user-confirmed intent, unresolved ambiguity, improvement
  opportunities, suspected findings, and confirmed problems;
- applicable glossary context and external-guidance evidence.

Use `sigil context` and `sigil graph` through the established-Sigil and
standards-review procedures. DesignConversation consumes this context; it does
not redefine graph discovery or evidence classification.

Context is sufficient when the affected contract, related ownership and
dependencies, repository evidence, and material review findings are available
for the current decision. Refresh affected related-Sigil evidence after a
material decision and before proposal synthesis.

For Greenfield work with no related contract, record that absence and inspect
available boundary summaries and neighboring contracts instead of inventing
relationships.

## 3. Maintain Conversation State And Mode

Track the current phase as:

- **framing:** establish intended outcome, users or callers, boundary, and
  relevant evidence;
- **exploring:** discover material decisions, assumptions, conflicts,
  improvements, and pitfalls;
- **resolving:** decide the questions that shape the contract;
- **synthesizing:** summarize the coherent design and prepare exact Sigil;
- **awaiting approval:** wait for the user to approve, reject, or revise the
  proposal.

Track one conversation mode:

- **exploration:** intent or contract design is materially incomplete;
- **improvement:** the existing contract is coherent, but credible evidence
  indicates an optional material improvement;
- **correction:** evidence confirms a material semantic, architectural, or
  design problem.

A suspected finding remains under investigation. It does not automatically
enter correction mode or block unrelated user work. Correction mode begins only
after evidence confirms that the affected ideas cannot form a coherent or
acceptably safe contract as written.

Maintain a lightweight decision ledger in conversation context. Classify each
material decision as:

- **confirmed:** explicitly decided by the user or established by approved
  Sigil;
- **provisionally assumed:** a conservative, reversible assumption stated to
  the user;
- **intentionally deferred:** not required for the current contract and retained
  visibly;
- **unresolved:** no safe decision exists yet.

Existing or approved Sigil is evidence of current intent, not proof that the
design cannot be improved. Reopen a confirmed decision when new evidence
materially conflicts with it or indicates a material improvement opportunity.

Do not create a repository artifact for the ledger unless the user separately
requests one.

## 4. Prioritize Decisions

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
lifecycle, failure behavior, binding architecture, or acceptance criteria.
Other decisions may be provisionally assumed or intentionally deferred when the
user accepts that treatment.

An optional improvement is not blocking merely because it could make the design
better. State its evidence, consequences, and recommendation, and let the user
accept, revise, reject, or defer it.

## 5. Use External Guidance Evidence

After sufficient framing, request ApplicabilityAssessment from
`references/external-guidance-evidence.md` for every design or review scope.
That procedure solely owns the required, recommended, or not-material
disposition and evidence acquisition.

Acquire required or recommended evidence before presenting affected
alternatives, pitfalls, improvement opportunities, or recommendations. Research
may improve a coherent written contract; it does not require a known conflict
or prior proof that a binding decision will change.

Use the evidence packet to:

- discover alternatives and pitfalls that repository evidence alone may omit;
- explain consequences, uncertainty, and environment or version limits;
- identify architecture, modularity, security, reliability, accessibility,
  interoperability, lifecycle, and platform improvements;
- distinguish binding authority, normative standards, official operational
  guidance, and advisory practice;
- support recommendations with directly relevant source identity and links.

Evidence remains nonbinding. The user retains decision authority, and research
never determines a ReviewGate result.

When authoritative sources disagree before a project decision exists, record
the disagreement as unresolved design evidence. Enter correction mode only when
applicable evidence confirms a material conflict with approved Sigil or a
confirmed decision.

Incomplete evidence may support a stated conservative provisional option only
for a low-risk reversible decision. Require missing evidence or qualified review
before recommending a definitive high-risk or compliance-critical choice.

Reuse a valid packet while its question, boundary, environment, risk, source
status, and applicability assumptions remain unchanged. Avoid irrelevant,
filler, and repeated research.

## 6. Run One Conversational Turn

Present one primary design decision per turn unless the user asks for a faster
grouped review. Include tightly coupled subquestions only when separating them
would make the decision misleading or impossible to answer.

Each turn should:

1. acknowledge the user's previous answer and state its effect on the emerging
   contract;
2. state the current conversation mode when it materially affects expectations;
3. briefly explain why the next decision matters and what later choices depend
   on it;
4. ask one direct question in the user's vocabulary;
5. when alternatives exist, offer a small concrete set with meaningful
   consequences and a reasoned evidence-informed recommendation;
6. make clear that the user may combine, reject, revise, or replace the offered
   choices.

After the answer, update the decision ledger, restate the resulting decision,
and detect dependent questions, improvements, or conflicts.

If the user requests a faster review, group only closely related decisions.
Return to one primary decision when grouped answers reveal conflict or material
uncertainty.

## 7. Handle Uncertainty, Findings, And Conflicts

When the user is unsure, explain the uncertainty and recommend a conservative
option with its consequences. A low-risk reversible choice may become
provisional after it is stated. A non-blocking choice may be deferred and must
remain visible in synthesis.

Do not silently default a blocking decision. Ask for user direction or
qualified review when security, permissions, destructive behavior, persistent
data, compliance, or another high-impact concern remains ambiguous.

### Suspected Findings

Investigate a suspected finding proportionally:

1. identify the exact affected wording and available evidence;
2. separate Sigil evidence, repository evidence, external guidance, and
   inference;
3. determine whether scope or governing intent can confirm or dismiss it;
4. ask a focused question only when user authority is required.

A suspicion does not automatically become correction, prevent unrelated work,
or imply that the existing contract is wrong. It may keep only the affected
material decision unresolved when missing evidence makes synthesis unsafe.

### Improvement Mode

Use improvement mode when the existing contract is coherent but credible
evidence supports a materially better alternative. Explain:

- what already works;
- the improvement and supporting evidence;
- consequences and trade-offs;
- whether it is optional or affects a binding requirement;
- the recommendation and decision requested.

Rejected or deferred optional improvements do not become defects.

### Correction Mode

Enter correction mode only for a confirmed material problem. In each correction
turn:

1. identify the exact file, component, section, and problematic idea;
2. separate exact Sigil evidence, repository evidence, applicable guidance, and
   inference;
3. explain the contract, ownership, lifecycle, security, persistence,
   interoperability, verification, or implementation consequence;
4. explain why the finding is confirmed and material;
5. offer concrete corrections with trade-offs and a reasoned recommendation;
6. ask one focused decision in the user's vocabulary.

Preserve affected Sigil while the user decides. A confirmed material problem
cannot be deferred, treated as provisional, or bypassed for implementation.
Resume exploration or improvement only after the confirmed problem is resolved.
Resolution is evidence and still requires
`ReviewGate(action: sigil-change)` for the exact proposal.

### Conflicting Answers Or Evidence

When an answer conflicts with an earlier decision, approved Sigil, repository
evidence, or applicable guidance:

1. stop advancing to unrelated design questions when the conflict is confirmed
   and material;
2. state both ideas and their evidence;
3. explain the contract or implementation consequence;
4. offer concrete resolution choices;
5. ask which intent should govern;
6. update the ledger only after resolution or explicit blocking status.

When the user appears overwhelmed, reduce scope to the single most foundational
decision and defer non-blocking topics.

## 8. Use Checkpoints

Give a compact checkpoint after several decisions, when mode or phase changes,
when a conflict changes earlier conclusions, or when the user asks for status.
Report:

- current mode;
- confirmed decisions;
- provisional assumptions;
- intentionally deferred decisions and improvements;
- unresolved blockers;
- material external-guidance findings or limitations;
- the next decision and why it is next.

Do not repeat the entire conversation.

## 9. Finish Or Block The Conversation

Move to synthesis only when no blocking unresolved decision or confirmed
material problem remains. Before synthesis, refresh affected related-Sigil
evidence and verify that the emerging decision preserves coherence and
modularity.

The synthesis must state:

- intended outcome, users or callers, and boundary;
- component responsibilities, ownership, and non-responsibilities;
- public behavior, lifecycle, failure, and risk decisions;
- binding architecture or platform decisions;
- accepted improvements and retained existing choices;
- confirmed assumptions and trade-offs;
- intentionally deferred non-blocking decisions and improvements;
- evidence-informed decisions and directly relevant source identity;
- unavailable, partially assessed, or conflicting evidence requiring
  acceptance.

Then prepare exact proposed Sigil through the applicable semantic-review and
implementation-coverage procedures. Conversation is evidence, not approval.
Submit the exact scope and change set to
`ReviewGate(action: sigil-change)`.

If a blocking decision remains unresolved, continue the focused conversation.
Do not synthesize speculative Sigil or begin implementation.

## 10. Limits And Examples

Every question must materially improve product intent, public behavior,
ownership, lifecycle, architecture, risk handling, or verification.

### Unrelated Request

A request for validation status with no material design question is answered
without entering DesignConversation.

### Vague Product Idea

Enter exploration mode and ask who needs the outcome and what successful
behavior looks like before asking about frameworks, storage, or deployment.

### Existing Coherent Contract

Enter improvement mode when current evidence reveals a materially simpler,
safer, or more modular alternative. Present it as optional unless it conflicts
with a binding requirement.

### Suspected Ownership Problem

Inspect both ownership claims and their dependents before classifying the
finding. Do not enter correction merely because ownership looks unusual.

### Confirmed Ownership Conflict

Enter correction mode when two applicable contracts both claim the same mutable
state. Explain the lifecycle and consistency risk and resolve ownership before
synthesis.

### Intentional Deferral

If branding details do not affect the current UI behavior contract, retain them
as intentionally deferred without blocking the proposal.
