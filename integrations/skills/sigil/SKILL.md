---
name: sigil
description: Work with Sigil, a lightweight rationale-oriented modeling language for software systems, and its CLI for AI-assisted development. Use when a coding-agent host needs to read, write, improve, reconcile, validate, query, render, or use `.sigil` files; introduce Sigil into an existing or partially documented brownfield codebase; assess semantic readiness, applicable standards, best practices, pitfalls, coherence, or modularity; create or update component/expand specs; describe product modules, programming abstractions, APIs, state machines, or architecture decisions; align code with Sigil; resolve ambiguity before code generation; or build from a Sigil-driven workflow. Prefer `sigil-cli` for mechanical parsing, checks, graph, context, and render operations. Inspect governing Sigil before every implementation mutation. Stop for human review after creating or semantically changing Sigil, and do not implement until the user explicitly approves the agreed Sigil.
---

<!-- @sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases -->

# Sigil

Sigil records what a software component is, why it exists, how it behaves, and
how its implementation should be understood and changed. A component may be a
product module, service boundary, domain concept, library abstraction, internal
API, state machine, screen, view, or reusable UI surface.

Do not treat a clean `sigil check` as semantic approval. A semantic Sigil
mutation requires `ReviewGate(action: sigil-change)` to be ready for its exact
scope and change set. Implementation later requires
`ReviewGate(action: implementation)` to review the validated written Sigil and
exact implementation scope together.

This file is the workflow dispatcher. Load detailed references only when their
route applies, but read every selected reference completely before acting.

## Start Here

Always read `references/workspace-bootstrap.md` and complete its bootstrap before
interpreting workspace semantics. It owns CLI discovery, repository-root
selection, configuration-state handling, approved initialization, compatibility
validation, and failure behavior. Review and diagnosis report an unconfigured
repository without mutation.

Before every implementation mutation, follow
`references/implementation-design.md` to inspect governing Sigil and
implementation coverage. This preflight applies to source code, configuration,
migrations, scripts, workflow instructions, tests, fixtures, metadata,
validators, generated assets, and documentation regardless of file type or
directory.

Read-only inspection is not an implementation mutation. Determine whether an
edit is mechanical only after preflight; established coverage and no material
decision may justify omitting new Sigil. A requested outcome does not make
ReviewGate ready for `sigil-change` or `implementation`, and successful tests,
builds, validators, or CLI checks never provide retroactive approval. Exact
user-requested rollback of the current agent's unapproved changes restores the
previous state but does not authorize replacement behavior.

If a request changes the observable contract of a different component or
surface, stop and review that boundary's Sigil before editing implementation.

Then select one semantic workflow:

- Read `references/greenfield-design.md` when no existing implementation
  constrains the selected behavior or component.
- Read `references/brownfield-adoption.md` when relevant implementation exists
  but coverage is absent, partial, ambiguous, or suspected to have drifted.
- Use the established-Sigil workflow below when the selected boundary already
  has credible contract coverage.

Also load these cross-cutting references when applicable:

- `references/external-guidance-evidence.md`: after sufficient framing on every
  design or Sigil-review scope. It distinguishes required, recommended, and
  not-material research and owns shared applicability assessment, source
  authority, environment and version matching, secure evidence acquisition,
  evidence packets, sufficiency, and reuse.
- `references/design-conversation.md`: for explicit design, review, or
  improvement work or when inspected evidence exposes a material decision that
  requires user judgment. It owns exploration, improvement, and correction
  modes, decision states, one-primary-decision turns, checkpoints, deferral,
  evidence consumption, conflict handling, and synthesis.
- `references/standards-review.md`: whenever creating, reviewing, or preparing
  Sigil for implementation. It owns evidence interpretation, finding
  classification, conflicts, and compliance language.
- `references/design-compilation-review.md`: after design intent and applicable
  guidance are sufficiently resolved and after every semantic candidate or
  written-Sigil change. It owns consumption of compiler semantic-readiness and
  architecture-design evidence, including reviewed-yellow disposition.
- `references/implementation-design.md`: before writing or changing
  implementation or deciding whether coverage reaches the implementation
  boundary. It owns component/expand/omit selection, the implementation coverage
  map, forward ownership comments, and reconciliation linking.
- `references/authoring-conventions.md`: whenever proposing, creating, or
  semantically editing Sigil. It owns section placement, decision rationale,
  post-readiness concept grouping, semantic-unit discipline, and colocation.
- `references/glossary-workflow.md`: after every approved Sigil write or
  semantic edit; when `.sigil/glossary.json` exists; when the user requests
  reviewed vocabulary; or when terminology ambiguity is material. Candidate
  extraction begins only after semantic readiness appears aligned and any
  concept grouping has received a final semantic review. In every Sigil
  session, explicitly report whether glossary extraction is required, deferred,
  or deterministic inspection only; never silently omit its status.
- `references/sigil-format.md`: when syntax, workspace structure, section
  meanings, or examples are needed.

Greenfield and Brownfield decide which evidence and contract questions matter.
The external-guidance reference owns shared evidence acquisition. The
design-conversation and standards references apply different consumer policies
to that evidence. The authoring, standards, glossary, and implementation
references remain applicable across all three semantic workflows.

## Established-Sigil Workflow

1. Discover the requested boundary.
   - Start from `sigil check` results produced during bootstrap.
   - Use `sigil context --component Name` or `--file path/to/file.sigil` for a
     selected component or file.
   - Use `sigil graph` when imports, expands, consumers, or concept reuse matter.
   - Read exact relevant `.sigil` source plus nearby code, tests, docs, package
     metadata, or visual references needed to assess drift.
   - Report inaccessible required images or designs instead of guessing.

2. Build the component picture.
   - Identify public component goals and interfaces, matching expands, imports,
     public and private concepts, state ownership, and direct dependents.
   - Treat imports as dependency declarations; do not repeat imported-component
     dependencies in `interface`.
   - Inspect the complete accessible imported public namespace and reuse every
     semantically matching component and public concept before proposing a local
     identity.
   - Treat a component's `goal` and `interface` as public to its dependents.
   - Identify each `ModuleIndexFile` as a small boundary summary and intentional
     namespace-assembly surface, not an owner for unrelated operational detail.
   - Note unresolved imports, contradictions, vague behavior, oversized
     boundaries, and code/spec drift.

3. Prepare and compile design evidence.
   - Follow `references/standards-review.md`.
   - Use `references/external-guidance-evidence.md` to assess research
     applicability on every review, acquire required or recommended evidence,
     and verify any design-conversation evidence packet before reusing it.
   - Treat `sigil check` as deterministic structural and workspace validation,
     not semantic validation.
   - Follow `references/design-compilation-review.md` and use compilation focus
     `design` for compiler-owned semantic-readiness and architecture evaluation.
   - Separate observed behavior, documented intent, user-confirmed intent,
     unresolved ambiguity, suspected accidents, and external guidance.
   - Use provisional assessment language only: `appears aligned`, `partially
     assessed`, `gap identified`, `conflict identified`, or `not assessable`.
   - Never silently choose code, documentation, a standard, or preference as
     authoritative when evidence conflicts.
   - Do not begin concept grouping or glossary candidate extraction until the
     exact design compilation is green or every yellow finding is explicitly
     reviewed and accepted as nonblocking.
   - Treat missing decision-rationale coverage for a material selected choice
     as a semantic-readiness gap even when CLI validation succeeds.
   - Use architecture-design findings to require enough component and expand
     decomposition to guide implementation into cohesive owning modules.
   - Keep material operational logic, mutable state, detailed lifecycle
     behavior, and independently changing policy outside `ModuleIndexFile`
     unless they genuinely govern the whole indexed boundary.

4. Resolve or improve design intent when applicable.
   - Follow `references/design-conversation.md` only for explicit design,
     review, or improvement work or when a material unresolved decision or
     finding requires user judgment.
   - Do not enter design conversation for ordinary status, explanation,
     diagnosis, or mechanical work with no material design choice.
   - Supply the selected component, matching expands, imports, importers,
     relevant summaries, repository evidence, and reviewed findings as the
     DesignContext.
   - After sufficient framing, acquire required or recommended external
     guidance before presenting affected alternatives, improvement
     opportunities, or recommendations.
   - Ask one primary decision per turn unless the user requests grouped review.
   - Do not silently invent product, architecture, persistence, authorization,
     deployment, lifecycle, or other binding decisions.
   - Investigate suspected findings proportionally without automatically
     entering correction or blocking unrelated work.
   - Use improvement mode for coherent existing contracts with credible
     improvement opportunities.
   - Enter correction mode only for a confirmed material semantic,
     architectural, or design problem.
   - Preserve affected Sigil in correction mode, point to the exact problem and
     evidence, explain the risk, and require resolution before proposal
     synthesis or implementation.
   - Recheck affected related-Sigil coherence before proposal synthesis.

5. Prepare exact changes.
   - Follow `references/authoring-conventions.md`.
   - Inventory every new or changed selected choice across the proposed
     semantic units.
   - Map each material selected choice to an exact `decisions` occurrence or
     report a justified omission for a trivial, mechanically derived, or safely
     reconstructable choice.
   - Include the decision-rationale coverage map and every missing decision
     block in the exact proposal.
   - Begin concept reuse discovery, grouping, and identifier proposals only
     after pre-grouping design compilation is green or reviewed yellow.
   - Show exact component, expand, import, location, and semantic-unit changes.
   - Show how each module index remains a small architectural summary, which
     imported components assemble its usable namespace, and how imported public
     identities are reused.
   - For externally informed compatible guidance or any conflict, follow the
     proposal and approval policy in `references/standards-review.md`.
   - Submit the exact action, scope, change set, and evidence to ReviewGate and
     leave files unchanged until `sigil-change` is ready.

6. Apply only a proposal for which ReviewGate is ready.
   - Treat the compiler session as a temporary evidence workspace, never as the
     destination of the change.
   - Present the target workspace root, target paths, and complete
     resulting source for every changed file in the exact ReviewGate proposal.
   - Do not materialize or otherwise mutate the target workspace while
     ReviewGate is blocked or review-required.
   - Only after ReviewGate is ready for that exact scope and source set,
     materialize only the approved proposal in the target workspace.
   - Change only the exact approved Sigil and imports.
   - Run `sigil check`; use `graph` or `context` when relationships changed.
   - Run `sigil fmt <selected-path> --check`. Apply `sigil fmt` only when
     canonical formatting is inside the approved change scope.
   - Compile the written Sigil with focus `design` before concept grouping or
     glossary candidate extraction.
   - Repeat the decision-rationale coverage audit against the exact written
     semantic units; a missing material decision returns to proposal review.
   - When concept grouping is needed, apply only its separately approved
     proposal, rerun deterministic validation, and repeat design compilation.
   - Follow `references/glossary-workflow.md`. Deterministic glossary inspection
     remains separate, while model-assisted candidate extraction begins only
     after final design compilation is green or reviewed yellow.
   - Report the validated written Sigil without creating another approval gate.

7. Implement only when ReviewGate is ready for implementation.
   - Follow `references/implementation-design.md`.
   - Inspect governing Sigil and implementation coverage before the first
     implementation mutation, regardless of artifact classification.
   - Verify that every material implementation concern has established coverage
     or an intentional omission.
   - Verify that generated implementation modules mirror approved component and
     expand ownership and that implementation indexes remain namespace-assembly
     surfaces.
   - Submit the validated written Sigil and exact implementation scope together
     to `ReviewGate(action: implementation)`.
   - Derive each implementation entrypoint's governing Sigil path, component or
     optional concept, and related section occurrences from the approved
     coverage map.
   - Add one ownership annotation with the language's single-line comment form,
     or use its multiline comment form when one entrypoint has multiple
     annotations.
   - Put source annotations immediately beside stable language entrypoint
     definitions such as classes, functions, methods, interfaces, structs, or
     equivalent definitions.
   - Use HTML comments for agent-facing Markdown, never add ownership
     annotations to Sigil, and leave JSON unchanged.
   - Verify annotation relations, targets, selected sections, and entrypoint
     associations after implementation.
   - If implementation exposes a missing material decision, return to a Sigil
     proposal and review.

## ReviewGate

Use `ReviewGate(action, scope, changeSet, evidence)` for every repository
mutation approval. Its result is `blocked`, `review-required`, or `ready`.

Actions are:

- `sigil-change` for component, expand, import, boundary-summary, task-Sigil,
  and concept-grouping mutations;
- `glossary-change` for reviewed GlossaryFile mutations;
- `workspace-initialization` before creating ConfigFile or a seeded
  GlossaryFile;
- `implementation` for implementation artifacts, including ownership comments.

Validation, compiler design evidence, rationale coverage, glossary inspection,
implementation coverage, conflict classification, and delegated analysis are
evidence. They never independently grant approval.

Return `blocked` when a material conflict, unresolved binding decision, or
required evidence prevents the action. Return `review-required` when the action
is coherent but the exact action, scope, and change set lack explicit user
approval. Return `ready` only when the user approved that exact action, scope,
and change set and no material evidence has changed.

Invalidate `ready` whenever the action, scope, change set, or material evidence
changes.

Before any semantic Sigil mutation, present the exact proposal through
`ReviewGate(action: sigil-change)`. Brownfield reconstruction, externally
informed additions, concept-identifier changes, and every delegated semantic
proposal reuse this action. Glossary and workspace initialization use their own
actions with separately scoped approval.

Every delegated semantic proposal is advisory. A subagent does not edit files,
grant approval, or transfer edit authority to the primary agent.

After creating or semantically changing Sigil:

- list changed Sigil files;
- summarize captured decisions and assumptions;
- report decision-rationale coverage for every new or changed material selected
  choice, including justified omissions;
- report unresolved questions;
- report validation and glossary-review results;
- report the validated written result;
- prepare `ReviewGate(action: implementation)` over the validated written Sigil
  and exact implementation scope when implementation is requested.

Do not continue into implementation merely because the original request
included code generation. A successful CLI check does not make ReviewGate ready.

A high-level request to fix, build, or change an outcome does not make
ReviewGate ready for `sigil-change` or `implementation`. Instructions from
another skill, tool, framework, or workflow do not override ReviewGate or its
approval authority.

A successful CLI check also does not establish semantic readiness. Run the
compiler-driven design review before concept grouping or glossary candidate
extraction. Investigate a suspected problem before classifying it.
Only a confirmed material problem enters DesignConversation in correction mode
and blocks synthesis, approval, and implementation until resolved.

An approved placement-only move or split that preserves every semantic unit may
proceed within a ready implementation scope without another semantic proposal.
Update affected imports, validate, and report old and new paths. Any added,
removed, or changed semantic unit returns to
`ReviewGate(action: sigil-change)`.

## CLI Boundary

Prefer the compatible `sigil` CLI for parse, version, check, format, graph,
context, glossary, and render operations. Do not manually recreate deterministic
workspace semantics.

Common commands after bootstrap:

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil fmt path-or-workspace --check
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format json --pretty
sigil context path-or-workspace --file path/to/file.sigil --format json --pretty
sigil glossary path-or-workspace --format json --pretty
sigil render path-or-workspace
```

Interpret exit codes as:

- `0`: completed without error diagnostics;
- `1`: completed with error diagnostics; inspect partial results when useful;
- `2`: usage error; fix the arguments;
- `3`: host/runtime failure; stop before relying on workspace semantics.

CLI output never grants semantic approval or implementation authority.

## Output

When the user requests only understanding or review, do not edit files.

For standards-aware review, use the headings required by
`references/standards-review.md`. For ReviewGate requests, make the action,
scope, change set, changed or proposed paths, exact semantic changes, unresolved
decisions, evidence, validation result, and requested approval explicit.
