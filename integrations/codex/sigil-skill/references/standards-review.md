# Standards-Aware Semantic Review

Use this procedure when creating, reviewing, or preparing Sigil for
implementation. It adds host-side semantic review and external research without
changing the Sigil grammar or treating model judgment as core validation.

## Contents

1. Applicability and risk
2. Semantic-readiness review
3. Research and source policy
4. Finding classification
5. Action and approval policy
6. Compliance language
7. Review output
8. Examples

## 1. Applicability And Risk

Assess external-guidance applicability on every Sigil review. Do not browse by
default when no external guidance can materially affect the component.

Consider research when the component involves:

- authentication, authorization, secrets, cryptography, or other security
  boundaries;
- personal, regulated, financial, health, or otherwise sensitive data;
- accessibility or human-interface obligations;
- public APIs, protocols, interoperability, file formats, or versioned
  contracts;
- reliability, availability, recovery, audit, or operational safety;
- a regulated or standards-governed domain;
- framework, platform, database, or vendor behavior that may have changed;
- an explicit organizational, contractual, or user requirement.

Use a qualitative risk level:

- `low`: internal, reversible work with no material public, security, data, or
  compliance effect;
- `standard`: application behavior, module contracts, APIs, persistence, or
  user-visible workflows;
- `high`: security boundaries, permissions, payments, destructive operations,
  migrations, sensitive data, safety, or compliance-critical behavior.

State the chosen risk level and why. Do not turn it into a numeric readiness or
modularity score.

## 2. Semantic-Readiness Review

### Goal Clarity

Check that every goal identifies:

- the responsibility and intended outcome;
- the user, caller, or system need;
- why the component is a separate unit;
- its ownership boundary and important non-responsibilities when ambiguity is
  likely.

Flag vague goals such as “manage data,” “handle users,” or “provide services”
when they do not establish a reviewable boundary.

### Interface Quality

Check every relevant public operation, event, or dependency for:

- inputs and validation expectations;
- outputs, guarantees, and observable side effects;
- failure and error behavior;
- caller identity, authorization, and ownership rules;
- sync, async, settlement, timeout, cancellation, ordering, retry, or
  idempotency behavior when applicable;
- lifecycle and state-transition effects;
- compatibility, versioning, and interoperability constraints when applicable.

Do not require every category mechanically. Require it only when omitting it
could materially change implementation or observable behavior.

For UI components, also check when applicable:

- visible regions, content hierarchy, and navigation;
- user actions and the feedback they produce;
- loading, empty, error, and disabled behavior;
- responsive behavior and supported input methods;
- keyboard operation and accessibility expectations;
- agreement between written lines, ASCII wireframes, repository images, and
  external design references.

Visual material is free-form interface content, not special Sigil syntax. Do
not require keywords or authority fields. Ask what a visual means only when
different interpretations could materially change the public UI contract.
Report a required image or external design that cannot be accessed instead of
guessing its contents.

### Constraint-Derived Cases And Test Points

For each state, policy, and binding constraint, ask what an external caller,
user, adjacent component, test, or operator can observe when it holds or fails.

Suggest `cases` lines for meaningful happy paths, failures, boundary values,
permission denials, invalid transitions, retries, conflicts, and recovery
behavior. Keep private implementation-unit tests out of `cases` unless their
behavior is part of the component contract.

If a constraint cannot be expressed as an observable case, report an explicit
verification point in the review summary instead of forcing it into Sigil.

### Cross-Sigil Coherence

Use `sigil context` and `sigil graph` when available. Read exact source wording
before reporting a conflict.

Check the selected component, all matching expands, imported and importing
contracts, relevant nested module summaries, and the workspace summary for:

- inconsistent names, types, states, transitions, or error behavior;
- conflicting policies or constraints;
- dependencies that expect an interface the provider does not promise;
- duplicated or missing ownership;
- expands that contradict rather than complement one another;
- code or repository facts that disagree with approved Sigil.

Treat code/spec disagreement as drift. Do not assume code or Sigil is correct
without evidence or user direction.

### Modularity Heuristics

Assess modularity qualitatively:

- **Cohesion:** one component owns a coherent responsibility and related state.
- **Ownership:** each important policy and mutable state has one clear owner.
- **Interface size:** the public contract exposes only what dependents need.
- **Information hiding:** private storage and implementation details do not leak
  without becoming deliberate contract decisions.
- **Coupling:** dependencies use explicit contracts instead of private logic or
  another component's storage.
- **Dependency direction:** edges follow the declared architecture and avoid
  accidental cycles or bidirectional ownership.
- **Reasons to change:** unrelated product or technical changes do not routinely
  force one component to change.

Warn about god components, duplicated ownership, chatty or oversized
interfaces, cyclic dependencies, shared mutable state, and implementation-shaped
contracts. Do not assign arbitrary scores or thresholds.

## 3. Research And Source Policy

Use a primary-first source hierarchy:

1. public text from the applicable standards body, regulator, or government;
2. official standards and guidance such as ISO/IEC public material, IETF RFCs,
   W3C recommendations, NIST publications, and OWASP guidance;
3. official framework, platform, protocol, database, or vendor documentation;
4. reputable secondary material only to locate or contextualize primary
   sources.

Do not use a secondary source as the sole evidence for a standards or compliance
finding. Prefer the current applicable version and verify that the source scope
matches the component.

In the review summary record:

- issuer;
- title;
- identifier and version when available;
- publication or update date when available;
- access date;
- direct link;
- relevant scope and any access limitation.

Keep this source record in the review summary only. Do not add source URLs or
compliance claims to Sigil unless the user changes that policy.

For paywalled standards such as many ISO publications, use only accessible
official scope, preview, or supporting material. Do not infer unseen clauses.
Mark the unavailable portion as `not assessable` and explain what qualified or
licensed review remains necessary.

Avoid long quotations. Paraphrase the guidance and link to the primary source.

## 4. Finding Classification

Classify every researched finding:

- **Compatible guidance:** adds detail without contradicting approved Sigil,
  related contracts, repository facts, or an explicit user decision.
- **Potential conflict:** wording or evidence may disagree, but scope,
  applicability, or intent remains uncertain.
- **Definite conflict:** two applicable requirements or explicit decisions
  cannot both be satisfied as written.
- **Unverifiable guidance:** the authoritative material or relevant clause is
  unavailable, ambiguous, obsolete, or outside the agent's competence.
- **Non-applicable guidance:** the source does not govern or materially inform
  the selected component.

Compare guidance against the exact Sigil lines, collected expands, repository
constraints, explicit user requirements, and other applicable sources. When two
standards conflict, present the conflict; do not silently choose one.

## 5. Action And Approval Policy

### Compatible Guidance

Before editing, present:

- the finding and why it applies;
- the exact proposed semantic line or lines;
- the target file, component, and section;
- the source record in the review summary;
- whether the suggestion is blocking or optional.

Wait for explicit approval. After approval, write the lines as project
decisions, not claims such as “ISO requires this.” Then run `sigil check`, use
`context` or `graph` when relationships changed, and stop at the normal Sigil
review gate.

### Potential Or Definite Conflict

Do not modify the conflicting Sigil. Warn the user and report:

- the existing file, component, section, and exact conflicting idea;
- the external guidance and its applicability;
- whether the conflict is potential or definite;
- the likely implementation, security, interoperability, or compliance impact;
- concrete resolution options and their tradeoffs;
- the decision needed from the user or a qualified reviewer.

Block implementation when the unresolved conflict could change a public
contract, ownership, security, persistent data, lifecycle behavior, acceptance
criteria, or a binding requirement.

### Unverifiable Guidance

For high-risk or compliance-critical work, block implementation until the
material is available or a qualified reviewer resolves the uncertainty.

For low or standard risk, warn, state what was not verified, propose a
conservative path when possible, and require explicit user acceptance before
implementation.

### Non-Applicable Guidance

Do not add filler constraints or cases. State briefly that no material external
standard was identified when that conclusion helps the review.

## 6. Compliance Language

Use only these provisional outcomes:

- `appears aligned`: accessible evidence shows no identified conflict within
  the stated scope;
- `partially assessed`: only part of the relevant guidance was available or in
  scope;
- `gap identified`: Sigil omits relevant guidance or a required decision;
- `conflict identified`: Sigil and applicable guidance cannot both hold as
  written;
- `not assessable`: evidence or expertise is insufficient.

Never claim that a component, product, or organization is certified, fully
compliant, or guaranteed to comply. State when legal, security, accessibility,
safety, or formal certification review requires a qualified professional.

## 7. Review Output

Use these headings and write `none` for empty finding groups:

### Scope And Risk

Identify reviewed components, related files, risk level, and applicable guidance
categories.

### Sources Consulted

List the complete source records and access limitations. If no research was
needed, say why.

### Compatible Suggestions

Summarize non-conflicting guidance and whether each item is blocking or
optional.

### Conflicts And Pitfalls

Report potential and definite conflicts plus common implementation traps.

### Cross-Sigil Coherence And Modularity

Report contradictions, drift, ownership overlap, coupling, and boundary issues.

### Unverifiable Guidance

Report unavailable material, remaining uncertainty, and whether it blocks.

### Proposed Sigil Edits

Show exact semantic lines and their target sections without editing first.

### Approval Request

Ask the user to approve, reject, or revise the proposed lines and to resolve any
blocking conflict or uncertainty.

## 8. Examples

### Compatible Guidance

If current authoritative API guidance makes idempotency relevant and Sigil does
not address retries, propose a concrete line such as:

```text
constraints: Repeating a booking request with the same idempotency key does not create a second booking.
cases: Retrying a timed-out booking request with the same idempotency key returns the original result.
```

Do not write the lines until the user approves them. Keep the supporting source
record in the review summary.

### Conflict

If approved Sigil exposes sensitive credentials in a public interface while
applicable security guidance says they must remain secret, preserve the Sigil,
report the exact conflict and impact, and offer interface alternatives. Do not
silently rewrite the contract.

### Inaccessible Standard

If an applicable ISO standard is paywalled and only its public scope is
available, mark the assessment `partially assessed` or `not assessable`. Block a
compliance-critical implementation; otherwise request explicit acceptance of
the uncertainty.

### No Applicable Standard

For an isolated private utility with no public, security, persistence,
interoperability, or regulated behavior, record that no material external
guidance was identified and continue the ordinary Sigil review without browsing
for filler.
