# Sigil Workflow

Sigil is documentation-first.
The `.sigil` files are the durable place where decisions, assumptions, component boundaries, and behavior are recorded before implementation.
They are meant to reduce lost rationale, ownership ambiguity, review bottlenecks, and code/spec drift in AI-assisted development.

## Intended Flow

1. The user writes the minimum useful Sigil or identifies an existing-code boundary that needs Sigil.
2. The agent runs structural CLI checks, follows imports, and reads related code, tests, configuration, package metadata, and documentation.
3. For brownfield adoption, the agent selects a change-frontier pilot and separates observed behavior from documented and user-confirmed intent.
4. The agent checks semantic readiness: goal clarity, interface completeness, state and lifecycle behavior, constraints, cases, cross-Sigil coherence, modularity, and code/spec drift.
5. The agent assesses whether current standards, formal guidance, or official platform practices materially affect the selected contract.
6. The agent asks targeted questions only when the answer changes architecture, ownership, security, persistent data, behavior, public contract, or acceptance criteria.
7. Brownfield reconstruction and externally informed additions are shown as exact proposed semantic lines before the agent edits Sigil.
8. The user approves, rejects, or revises the proposal.
9. The agent writes only the approved Sigil, validates it, and stops at the semantic review gate.
10. After approval, the agent colocates Sigil with the implementation and uses the agreed contract to generate or change code.

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

The long-term boundary between deterministic readiness in core and model-assisted host orchestration remains exploratory in [ADR-009](decisions/adr-009-sigil-readiness-and-model-boundary.md).

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

Anchors are a staged vNext workflow defined by
[ADR-010](decisions/adr-010-ast-anchors-and-model-assisted-indexing.md).
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

When no workspace exists, the agent first inspects root product and architecture documentation, dependency definitions, executable configuration, and application entrypoints.
It uses that evidence to present a provisional application goal and externally meaningful interface, then asks the user to confirm or correct both before proposing root-module text.
The proposal includes a minimal `sigil.config` and a root `#module.sigil` containing a meaningful confirmed application summary; it never creates an empty or import-only root module.
After goal and interface confirmation, material application-wide evidence may be proposed in a root `expand`: runtime and deployment modes in `state`, cross-cutting flows and policies in `logic`, binding technologies and architecture decisions in `constraints`, and observable outcomes in `cases`.
Incidental dependencies, secrets, low-level configuration, and module-specific behavior remain outside the root summary.
Component contracts and implementation-specific expands are placed beside the code they describe.

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

The workspace-root `sigil.config` remains the discovery marker; a root `#module.sigil` remains an optional cross-cutting summary.
Moving or splitting Sigil requires affected imports to be updated and validated with `sigil check`, plus `graph` or `context` when relationships change.

## Agent Review Heuristics

When reviewing or improving Sigil, check:

- Does every component explain why it exists?
- Is every goal specific about responsibility, boundary, and intended outcome?
- Does every interface make relevant inputs, outputs, errors, permissions, lifecycle guarantees, and dependencies explicit?
- Does each imported name resolve to a matching component in the imported Sigil source?
- Does each `expand Name` have a matching `component Name`?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation details hidden from public component interfaces unless they are part of the contract?
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
