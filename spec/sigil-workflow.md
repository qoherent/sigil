# Sigil Workflow

Sigil is documentation-first.
The `.sigil` files are the durable place where decisions, assumptions, component boundaries, and behavior are recorded before implementation.
They are meant to reduce lost rationale, ownership ambiguity, review bottlenecks, and code/spec drift in AI-assisted development.

## Intended Flow

1. For greenfield work, the agent begins a collaborative design conversation; for brownfield work, it identifies the repository and initializes a missing `.sigil/config.json` before detailed discovery.
2. The agent runs structural CLI checks, follows imports, and reads related code, tests, configuration, package metadata, and documentation.
3. For brownfield adoption, the agent establishes approved ordinary summary components at the workspace root and declared members before selecting the requested change frontier and separates observed behavior from documented and user-confirmed intent.
4. The agent checks semantic readiness: goal clarity, interface completeness, state and lifecycle behavior, constraints, cases, cross-Sigil coherence, modularity, and code/spec drift.
5. The agent assesses whether current standards, formal guidance, or official platform practices materially affect the selected contract.
6. The agent uses manageable conversational rounds to discover greenfield intent and to resolve vague brownfield application purpose, boundaries, users, and external surfaces; established contracts need questions only when answers materially change them.
7. Brownfield reconstruction and externally informed additions are shown as exact proposed semantic lines before the agent edits Sigil.
8. The user approves, rejects, or revises the proposal.
9. The agent writes only the approved Sigil, validates it, and stops at the semantic review gate.
10. Before coding, the agent discovers coherent implementation and UI components, classifies each material concern as a component, implementation-specific expand, or intentional omission, and reports an implementation coverage map.
11. After approval, the agent colocates Sigil with the implementation and uses the agreed contracts and expands to generate or change code.

If implementation reveals a missing decision, the agent should stop and reflect that decision back into Sigil before continuing.
This keeps documentation ahead of the code instead of turning it into an after-the-fact summary.

## Structural And Semantic Readiness

`sigil-core` and `sigil-cli` provide structural validity: parsing, required sections, workspace and import resolution, collected expansions, graph relationships, and diagnostics.

The Codex skill currently provides host-side semantic review.
It checks whether remaining unknowns could materially change observable behavior, public contracts, ownership, security, persistent data, lifecycle rules, or acceptance criteria.

Semantic review includes:

- specific and bounded goals;
- relevant inputs, outputs, errors, permissions, dependencies, and lifecycle guarantees;
- meaningful states, transitions, policies, and binding constraints;
- externally observable edge cases and test points;
- agreement across imports, collected expands, module summaries, and nearby code;
- qualitative cohesion, ownership, interface size, coupling, dependency direction, and state ownership;
- applicable standards, official guidance, and implementation pitfalls.

The proposed boundary between deterministic readiness facts, attributed
host-assisted interpretation, generated Receipts, and human approval is defined
in [ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).

## Proposal And Review Gates

Brownfield reconstruction and compatible external guidance have a proposal gate before any Sigil edit.
The agent presents the exact semantic lines, target files, locations, imports, evidence, conflicts, and uncertainty, then waits for explicit approval.

Potential or definite conflicts are not silently merged.
The agent preserves the existing Sigil, warns the user, explains the impact, and offers concrete resolution options.

The semantic review gate is mandatory after creating or semantically changing Sigil files.

At the review gate, the agent should report:

- changed Sigil files;
- main decisions or assumptions captured;
- unresolved questions;
- a direct request for user review and approval before implementation.

Requests like "use Sigil", "improve Sigil", "prepare Sigil", or "check the spec before coding" are not approval to write implementation code.
They mean the agent should work on the documentation/specification layer and wait for review.

After approval, a placement-only move or split that preserves approved semantic lines may proceed without another semantic review gate.
Required import-path updates are placement-only.
Any added, removed, or changed semantic line creates another review gate.

## Proposed Anchor Workflow

Anchors are a staged future workflow consolidated with generated Receipts and
review evidence in
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
They do not change Sigil semantics or replace review of Sigil and code.

The proposed flow is:

1. Resolve the approved Sigil component and its collected expansions.
2. Build a deterministic source AST and symbol index.
3. Produce no more than twenty inspectable source candidates for each selected semantic line.
4. Let a host model propose `implements`, `verifies`, or `supports` relationships when natural-language interpretation is required.
5. Validate every proposed target deterministically.
6. Present initial or ambiguous mappings for explicit human approval.
7. Persist only approved mappings in `.sigil/anchors.json`.
8. Reconcile formatting and unique relocations deterministically.
9. Return material Sigil changes, missing targets, ambiguity, splits, and merges to review.

Models never accept or silently repair anchors. An anchor signals relevant
implementation evidence; it does not prove that code satisfies Sigil.

## Brownfield Adoption

Brownfield adoption is incremental rather than a whole-repository conversion.

The agent classifies the selected boundary as having no Sigil, partial coverage, or established coverage.
It prioritizes an explicit user target, the next change frontier, a high-risk or high-churn boundary, or the smallest coherent ownership boundary.

Repository evidence is classified as observed behavior, documented intent, user-confirmed intent, unresolved ambiguity, or suspected accidental behavior.
Code demonstrates current behavior; it does not prove desired behavior or rationale.
Initial brownfield Sigil contains only the contract the user approves.

When no workspace exists, the agent first runs `sigil init` at the repository
root, then validates the created config before gathering detailed project
evidence. It never overwrites an existing config.

The agent then inspects product and architecture documentation, dependency
definitions, executable configuration, and entrypoints for the workspace root
and every declared member. When evidence does not establish a configured
boundary's purpose, users or external systems, responsibility, and external
interaction surfaces, the agent begins a focused conversation and continues
with targeted follow-up questions. It synthesizes a candidate goal and
interface for each boundary, then asks the user to confirm or correct them.

After confirmation, the agent proposes an ordinary summary component in each
configured boundary's `#module.sigil`. A boundary module index may combine that
summary with direct imports defining its directory-import surface. Material
boundary-wide evidence may be proposed in a matching `expand` using the general
section meanings. Incidental dependencies, secrets, low-level configuration,
and task-specific behavior remain outside boundary summaries. Approved boundary
summaries are written, validated, and reviewed before the agent focuses on the
requested implementation task. Internal module indexes outside configured
boundaries require no project summary.
Component contracts and implementation-specific expands are placed beside the code they describe.

## Greenfield Design

Greenfield work treats conversation as a design activity rather than a fallback
for unclear prompts. The agent asks materially useful questions in manageable
rounds that build on prior answers and explores purpose, users or callers,
outcomes, boundaries, lifecycle, failure behavior, risk, architecture, and
verification where they shape the contract.

When several designs are viable, the agent presents concrete choices with
benefits, costs, consequences, and a reasoned recommendation. The user may
combine, reject, revise, or replace every choice. The agent continues until
contract-level decisions are clear enough to model without guessing, then
synthesizes the conversation into exact proposed Sigil for separate approval.
Writing and validating approved Sigil ends at the semantic review gate;
implementation requires approval of the written contract and an explicit
implementation request.

## Standards And External Guidance

The agent assesses external-guidance applicability on every semantic review but researches only when the domain, stack, risk, or public contract makes it relevant.

Research uses primary sources first: standards bodies, regulators, RFC and W3C material, NIST and OWASP guidance, and official vendor documentation.
Compatible findings are proposed before editing.
Potential conflicts, definite conflicts, inaccessible guidance, and non-applicable guidance are reported distinctly.

Assessment language remains provisional and cannot claim certification or definitive compliance.
Unavailable authoritative material blocks high-risk or compliance-critical implementation; lower-risk uncertainty requires a warning and explicit user acceptance.

## Placement

Approved Sigil should live beside the module, feature, abstraction, or implementation it explains.
If a public component contract must remain in a shared location, an implementation-specific `expand Name` should be colocated with the code.

The workspace-root `.sigil/config.json` remains the discovery marker.
`#module.sigil` is a directory-import index and has no discovery authority;
configured boundary indexes conventionally contain ordinary summary components.
Moving or splitting Sigil requires affected imports to be updated and validated with `sigil check`, plus `graph` or `context` when relationships change.

## Agent Review Heuristics

When reviewing or improving Sigil, check:

- Does every component explain why it exists?
- Is every goal specific about responsibility, boundary, and intended outcome?
- Does every interface make relevant inputs, outputs, errors, permissions,
  lifecycle promises, and other observable behavior explicit?
- Do imports declare component dependencies without repeating them in
  interfaces?
- Does each imported name resolve to a matching component in the imported Sigil source?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation-hiding rules and forbidden internal access in constraints
  unless they define an externally observable promise?
- Are roles, states, permissions, and lifecycle transitions explicit enough to test?
- For abstractions and APIs, are constructor/functions, return values, settlement/lifecycle behavior, and error behavior explicit?
- Are examples in `cases` externally observable?
- Do state, logic, and constraints imply missing edge cases or test points?
- If there are multiple expands for the same component, did you collect all matching expands and flag contradictions between them?
- Do related Sigil files and nearby code agree on naming, ownership, dependency direction, states, policies, and public expectations?
- Is each component cohesive and coupled to other components through explicit contracts rather than private implementation details?
- Could applicable standards or official guidance reveal a gap, conflict, or implementation pitfall?

When multiple expands exist, treat them as one collected expansion.
Ask for clarification only when the collected expands contradict each other or create an unclear public contract.
