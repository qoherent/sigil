<!--
@sigil implements integrations/skills/sigil/standards-review.sigil::SigilStandardsReview::StandardsReview interface,state,logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ConceptWorkflow interface,logic,constraints
-->

# Standards And Evidence Review

Use this procedure when creating, reviewing, or preparing Sigil for
implementation. It classifies repository and external-guidance evidence for
design conversation and compiler-driven design review without duplicating the
native compiler's Design coherence and world comparison.

## Contents

1. Applicability and risk
2. Design-evidence preparation
3. Evidence consumption and provenance
4. Finding classification
5. Action and approval policy
6. Compliance language
7. Review output
8. Examples

## 1. Applicability And Risk

Follow `references/external-guidance-evidence.md` to assess applicability on
every Sigil review. Acquire evidence when its disposition is required or
recommended. Record a concise reason when it is not material instead of using
the absence of a known conflict to suppress research.

When design conversation already produced an evidence packet, verify its
question, boundary, environment and version match, source currency, risk,
jurisdiction, mandates, and applicability assumptions before reusing it.
Reacquire evidence when any invalidation condition holds.

Use a qualitative risk level:

- `low`: internal, reversible work with no material public, security, data, or
  compliance effect;
- `standard`: application behavior, module contracts, APIs, persistence, or
  user-visible workflows;
- `high`: security boundaries, permissions, payments, destructive operations,
  migrations, sensitive data, safety, or compliance-critical behavior.

State the chosen risk level and why. Do not turn it into a numeric readiness or
modularity score.

## 2. Design-Evidence Preparation

### Review and native evidence

`sigil check` validates syntax, configuration, resolution and language diagnostics.
It does not establish semantic coherence or implementation delivery. Inspect exact
Sigil prose, evidence and material decisions, then use
[Design review](design-compilation-review.md) for native semantic evidence.

Do not assign a duplicate host semantic color or modularity score. Investigate
suspected findings before calling them defects. Correct established problems
within authorization and ask about material intent only when evidence cannot
resolve it. Missing reconstruction leaves semantic verification unavailable;
it does not prohibit useful authoring or Concept grouping.

Follow [authoring conventions](authoring-conventions.md) for Concept grouping and
naming. After changes, rerun structural validation and refresh native
input/projections before relying on a current semantic report. Glossary work
follows task scope and material terminology needs, not a compiler-stage sequence.

### Decision-Rationale Coverage

Before presenting a proposal, inventory every new or changed selected choice
across `goal`,
`interface`, `state`, `logic`, `constraints`, and `cases`.

For each material selected choice, verify one of:

- a matching `decisions` occurrence records `Decision`, `Scope`, and the
  materially applicable rationale;
- a justified omission explains why the choice is trivial, mechanically
  derived, or safely reconstructable.

`Context` is not part of the current decision convention. Do not add it.

Report the audit as:

| Material choice | Decision Concept | Coverage |
| --- | --- | --- |
| Exact selected choice | Matching Concept or omission evidence | `covered`, `missing`, or `justified omission` |

When a confirmed choice lacks a decision record, add the exact decision record to
the semantic proposal. When its governing rationale is unresolved or conflicts
with evidence, return to DesignConversation in the applicable mode. Record missing
rationale as authored work; do not treat a native gate as proof that rationale or
implementation delivery is complete.

After validated written Sigil is updated, repeat the audit against the exact
resulting Facets. Successful CLI validation never substitutes for this audit.

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

Check every relevant public operation, event, or observable promise for:

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

Imports declare component dependencies. Do not repeat them in `interface`.
Implementation-hiding rules and forbidden internal access belong in
`constraints` unless they define an externally observable promise.

Review Interface meaning and actively identify useful cross-contract Concept
groups, reusing accessible Tag identities. Real components often need several such
groups. Ungrouped Facets and mixed grouping remain valid, and smaller components
may need no additional Concept.
Repeated Concepts must describe one coherent concern. Imported provider
expands remain outside the consumer's public dependency context.

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

Use `sigil retrieve --purpose architecture` as the default context source. Use
`sigil context` or `sigil graph` only for detail that is absent from a successful
retrieval. Read exact source wording before reporting a conflict.

Check the selected component, all matching expands, imported and importing
contracts, relevant ordinary summary components at the workspace root or
declared members, and nearby internal Sigil files for:

- inconsistent names, types, states, transitions, or error behavior;
- conflicting policies or constraints;
- dependencies that expect an interface the provider does not promise;
- duplicated or missing ownership;
- expands that contradict rather than complement one another;
- code or repository facts that disagree with validated written Sigil.

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
- **Contract-to-code structure:** the component and expand decomposition is
  specific enough to guide implementation into cohesive owning modules.
- **Summary sources:** each summary source remains a concise architectural
  summary and intentional import-assembly surface rather than an owner of
  unrelated operational behavior or mutable state.
- **Imported Tag reuse:** semantically matching imported accessible Tags
  are reused before local synonyms or duplicate contracts are proposed.

Apply these heuristics at implementation boundaries as well as product and
service boundaries. An internal API, programming abstraction, state machine, or
UI surface may need its own component contract when dependents rely on it. Use
`references/implementation-design.md` for the component/expand/omit decision
and implementation coverage map before coding.

Warn about god components, duplicated ownership, chatty or oversized
interfaces, cyclic dependencies, shared mutable state, and implementation-shaped
contracts. Do not assign arbitrary scores or thresholds.

Treat a high-level summary that hides independently owned implementation
responsibilities as partial architectural coverage even when its prose is
internally coherent.

## 3. Evidence Consumption And Provenance

Use the shared evidence packet rather than creating a second research policy in
this procedure. Standards review owns interpretation of evidence:

1. verify that the packet is current and applicable to the exact reviewed
   component and environment;
2. compare its guidance with exact Sigil lines, collected expands, repository
   constraints, explicit requirements, and other applicable evidence;
3. classify each current finding under Section 4;
4. determine proposal, conflict, uncertainty, and implementation consequences
   under Section 5.

In the review summary, include the complete source record supplied by the
packet:

- issuer;
- title;
- identifier and available version or currency information;
- publication or update date when available;
- access date;
- direct link;
- authority class;
- relevant scope and environment match;
- access, redaction, or other assessment limitations.

Map each researched finding to its supporting sources. During design
conversation, a directly relevant source identity and link may accompany an
evidence-informed recommendation. During standards review, retain the complete
records under `Sources Consulted`.

Validated written Sigil may retain a source identifier and applicable version only
when needed to reconstruct material decision rationale or its revisit condition.
Keep source URLs and full bibliographic records outside Sigil unless the user
approves a different project policy. Never write certification or complete
compliance claims into Sigil.

When a packet is partially assessed or not assessable, preserve that state
rather than filling missing clauses or scope through model inference.

## 4. Finding Classification

Classify host-identified semantic, architectural, and design findings as:

- **Suspected problem:** evidence indicates a material defect, contradiction,
  ambiguity, or risk, but scope or governing intent remains uncertain.
- **Confirmed problem:** applicable Sigil ideas, repository constraints, or
  confirmed decisions cannot form a coherent or acceptably safe contract as
  written.
- **Resolved problem:** the user has selected or supplied coherent governing
  intent and no material contradiction remains.

Investigate suspected problems proportionally by inspecting exact related Sigil,
repository evidence, applicable guidance, and governing intent. Keep semantic
readiness unassessed when missing evidence leaves the affected material
decision unsafe, but do not automatically enter correction or block unrelated
work.

Route only confirmed material problems to DesignConversation in correction
mode. Do not silently repair them, treat preference as evidence, or continue to
Concept grouping or glossary candidate extraction.

Classify every researched finding:

- **Compatible guidance:** adds detail without contradicting validated written Sigil,
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

### Semantic, Architectural, Or Design Finding

Do not modify affected Sigil merely because review found a possible problem.
For a suspected finding, investigate scope and governing intent and report:

- the exact file, component, section, and possibly problematic idea;
- the evidence and what remains inference;
- why the possible impact is material;
- the evidence or focused user clarification needed to confirm or dismiss it.

Do not enter correction solely from suspicion. When evidence confirms a
material problem, enter DesignConversation in correction mode and report:

- the exact file, component, section, and problematic idea;
- the evidence and what remains inference;
- whether the finding is suspected or confirmed;
- the likely contract, ownership, lifecycle, security, persistence,
  interoperability, verification, or implementation impact;
- concrete corrections and their trade-offs;
- the focused decision required from the user.

Keep design review blocked until the confirmed problem is resolved. A confirmed
material problem cannot be deferred, provisionally assumed, or bypassed for
approval or implementation. Resolve dependent changes within existing
authorization; ask only about material intent that evidence cannot settle.

### Compatible Guidance

Before editing, present:

- the finding and why it applies;
- the exact proposed Facet or lines;
- the target file, component, and section;
- the source record in the review summary;
- whether the suggestion is blocking or optional.

Compatible guidance may identify an optional improvement to coherent validated
written Sigil. Present it through DesignConversation improvement mode when
adopting it requires a material project decision. Rejecting or deferring an
optional improvement does not make the existing contract defective.

Write the exact lines as project decisions, not claims such as “ISO requires
this.” Then run `sigil check`, use `sigil retrieve --purpose architecture` when
relationships changed, and use `context` or `graph` only for missing detail.
Report the validated result without another approval gate.

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

Show exact Facets and their target sections without editing first.
Include required decision records and the decision-rationale coverage map.

### Material decisions

Identify exact unresolved intent and its evidence. Ask for the decision needed
before dependent work. Existing user authorization remains effective for routine
implementation and correction; compiler results do not authorize unrelated work.

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

If validated written Sigil exposes sensitive credentials in a public interface while
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
