# Brownfield Sigil Adoption

Use this procedure when implementation exists but Sigil coverage is absent,
partial, ambiguous, or suspected to have drifted. Establish the workspace and
approved ordinary summaries for its configured boundaries before modeling or
implementing the requested task.

Code is evidence of current behavior, not proof of desired behavior or
rationale. Preserve existing user changes and unrelated worktree content.

## Contents

1. Initialize or validate the workspace
2. Establish and review configured-boundary summaries
3. Focus on the requested task
4. Gather and classify task evidence
5. Reconcile current and intended behavior
6. Model task boundaries
7. Prepare the task-Sigil proposal
8. Apply approved proposals
9. Limits and examples

## 1. Initialize Or Validate The Workspace

Determine the repository root and check whether it directly contains
`.sigil/config.json` before gathering detailed project evidence.

When the config is absent, run:

```bash
sigil init <repository-root>
```

Use `--name`, `--include`, or `--exclude` only when repository facts or an
explicit user decision require non-default values. `sigil init` must create the
config before boundary-summary discovery and must never overwrite an existing config.

When a config already exists, do not run `init`. Validate it in place.

After initialization or discovery, run:

```bash
sigil version <repository-root> --format json --pretty
sigil check <repository-root> --format json --pretty
```

Stop with a compatibility report when initialization fails, the existing config
is invalid, or the configured CLI, core, or Sigil versions are not supported. Do
not create `.sigil` files until the workspace contract is valid.

## 2. Establish And Review Configured-Boundary Summaries

Before focusing on the requested implementation task, inspect the workspace
root and every path declared by `workspace.members`. Each configured boundary
must have a meaningful, approved ordinary summary component in its
`#module.sigil`. The component and any matching expand use normal Sigil forms
and receive no special parser or resolver status.

An internal `#module.sigil` outside a configured boundary is only a directory
index and requires no project summary. Do not infer additional summary
boundaries from package manifests or arbitrary directory structure.

### Gather Boundary Evidence

For each configured boundary, inspect the smallest evidence set that explains
what it owns, why it exists, and how users, callers, or external systems
encounter it:

- applicable README, product, architecture, and operational documentation;
- dependency definitions, workspace manifests, lockfiles, and declared scripts;
- executable runtime, build, deployment, routing, and environment configuration;
- entrypoints, exports, commands, routes, event consumers, workers, or top-level
  UI shells;
- an existing summary component and related boundary-level tests when present.

Do not read the entire repository indiscriminately. Do not promote a framework,
dependency, environment variable, or implementation pattern into a binding
boundary decision merely because it exists.

### Build Each Boundary Picture Through Conversation

Assess whether evidence is specific enough to describe the boundary name,
responsibility, intended outcome, users or callers, important
non-responsibilities, and externally meaningful UI, API, CLI, library, worker,
event, or service surfaces.

When any material part remains vague, unsupported, or contradictory, use
`references/design-conversation.md`. Begin from what evidence suggests and what
remains unknown, then resolve missing purpose, boundary, and interface decisions
one primary decision at a time unless the user requests a faster grouped review.

Maintain confirmed, provisionally assumed, intentionally deferred, and
unresolved decisions through the shared protocol. Do not guess missing purpose
or interface lines. Ask the user to confirm or correct each synthesized boundary
goal and interface as a separate decision.

### Propose Boundary Module Indexes

After goal and interface confirmation, propose an ordinary summary component in
each configured boundary's `#module.sigil`. A boundary module index may also
directly import components that should resolve through its directory shorthand.
Those imports do not grant visibility; every component remains public through
its explicit `.sigil` path.

Classify confirmed boundary-wide detail for an optional matching expand:

- `state`: runtime, deployment, persistence, or operational modes;
- `logic`: cross-cutting flows, routing, orchestration, and lifecycle behavior;
- `constraints`: policies, architecture, dependency direction, compatibility,
  supported platforms, and binding technologies;
- `cases`: observable outcomes, workflows, failures, and acceptance scenarios.

Keep secrets, volatile values, incidental dependencies, low-level configuration,
private algorithms, and task-specific behavior outside boundary summaries.
Present the exact summary components, expands, module-index imports, and
locations before editing.

Wait for approval, write only the approved boundary module indexes, run
`sigil check`, use `graph` or `context` when relationships changed, and stop at
the Sigil review gate. Do not move to task modeling until the user approves the
written configured-boundary summaries.

## 3. Focus On The Requested Task

After configured-boundary summary approval, return to the user's requested task. Select the
smallest coherent change-frontier boundary in this order:

1. the component or module explicitly named by the user;
2. the boundary affected by the requested implementation change;
3. a high-risk or high-churn boundary whose ownership is unclear;
4. the smallest coherent boundary exposing a meaningful public contract.

Do not convert the whole repository. If the request is broad and has no concrete
task boundary, present one to three evidence-backed candidates and recommend
one. Wait for the user's decision before proposing task-specific Sigil.

Classify task coverage:

- **No Sigil:** the boundary has no component contract or relevant expand.
- **Partial coverage:** a related contract exists but lacks required public or
  operational decisions.
- **Established coverage:** the boundary has a relevant component, collected
  expands, and enough approved context for ordinary review.

This classification covers the selected task contract, not implementation
readiness by itself. Before changing code, follow
`references/implementation-design.md` to discover internal abstractions, UI
components, state machines, and operational decisions within that boundary.

For established coverage, use the shared workflow unless evidence suggests drift
or the user requests reconciliation. Do not use numeric coverage scores.

## 4. Gather And Classify Task Evidence

Read only evidence needed for the requested boundary and direct relationships:

- nearby requirements, architecture, and product documentation;
- public types, entrypoints, exports, routes, handlers, screens, or events;
- tests, fixtures, screenshots, and acceptance scenarios;
- schemas, migrations, persistence, permissions, and integration boundaries;
- configuration and deployment facts that materially affect the task;
- related Sigil, imports, configured-boundary summaries, module indexes, and collected expands;
- focused version history when rationale is otherwise unavailable.

Classify material findings as:

- **Observed behavior:** demonstrated by implementation, executable
  configuration, or a passing test.
- **Documented intent:** stated in maintained documentation or architecture
  records.
- **User-confirmed intent:** explicitly confirmed for the proposed contract.
- **Unresolved ambiguity:** multiple interpretations could materially change the
  contract, ownership, state, or implementation.
- **Suspected accidental behavior:** behavior appears incidental, obsolete,
  unsafe, or unsupported by intent.

Report evidence paths and line numbers when practical. Keep evidence records in
the review summary rather than Sigil source. Do not assign confidence scores.

## 5. Reconcile Current And Intended Behavior

Compare implementation, tests, documentation, configuration, existing Sigil,
configured-boundary summaries, and the user's requested outcome.

For each material behavior identify whether it is:

- aligned with confirmed intent;
- current behavior that still needs confirmation;
- legacy behavior the user wants to change;
- conflicting evidence requiring a decision;
- irrelevant implementation detail that stays out of Sigil.

When evidence conflicts, preserve the conflict in the review summary. Ask a
focused question through `references/design-conversation.md` when resolution
could change public behavior, ownership, permissions, sensitive data, persistent
state, lifecycle, compatibility, failure behavior, or acceptance criteria.

Do not silently treat code, tests, documentation, directory structure, or a
preferred architecture as authoritative. Suspected accidental behavior does not
become a contract without user confirmation.

## 6. Model Task Boundaries

Model stable responsibilities, not the repository file tree. Choose a component
when the boundary has a coherent goal, recognizable users or callers, a public
interface, meaningful ownership, and a durable reason to change.

Public means visible to the component's dependents, including internal callers
and parent or child UI surfaces. A programming abstraction, internal API, state
machine, screen, view, or reusable UI surface may therefore be a component.

Do not mechanically create one component per class, function, table, endpoint,
directory, hook, or visual element. Reuse an existing component when ownership
matches. Use `expand` for operational detail owned by that component, and omit
trivial mechanics that have no independent contract or durable rationale.

Place shared component contracts at their contract or module-summary location.
Place implementation-specific expands beside the code they explain. Use
root-relative imports and never duplicate a public component declaration.

## 7. Prepare The Task-Sigil Proposal

Before editing task Sigil, report these sections and write `none` for empty
groups:

### Coverage State

State no, partial, or established coverage and cite evidence.

### Requested Task Boundary

Name the selected boundary, why it is the smallest coherent frontier, and which
alternatives were rejected.

### Repository Evidence

Separate observed behavior, documented intent, user-confirmed intent, and facts
intentionally excluded as incidental or private.

### Observed Versus Intended Behavior

Describe what currently happens and what the proposed contract will require.

### Conflicts, Unknowns, And Suspected Accidents

Report unresolved evidence, legacy differences, stale documentation, and
decisions that could change the contract.

### Proposed Boundaries And Ownership

Describe responsibility, public dependents, owned state or policy, and important
non-responsibilities.

### Implementation Coverage Map

For implementation work, list each material concern, owner, dependents, selected
component/expand/omit decision, owning location, and established/partial/missing
coverage. Explain intentional omissions that could otherwise appear material.

### Proposed Sigil

Show exact component, expand, and import text. Include only the task boundary;
do not reopen approved boundary summaries unless the task reveals a genuine
boundary-wide decision.

### Proposed Locations And Imports

List every target path and import addition or update.

### Approval Request

Ask the user to approve, reject, or revise the boundary, evidence
interpretation, locations, imports, and exact semantic lines.

Before requesting approval, apply semantic-readiness, standards,
cross-Sigil-coherence, and modularity review. Present sourced suggestions and
conflicts rather than silently changing the proposal.

## 8. Apply Approved Proposals

After explicit task-Sigil approval:

1. create or update only approved Sigil files;
2. colocate components and implementation-specific expands as proposed;
3. update only approved imports;
4. run `sigil check`;
5. use `sigil graph` or `sigil context` when relationships changed;
6. reread the files and repeat semantic, coherence, and modularity review;
7. stop at the task-Sigil review gate.

Do not modify implementation in the same pass. After the user approves the
written task Sigil and explicitly requests implementation, verify the approved
implementation coverage map and align code with those contracts and expands
while preserving unrelated behavior and user changes.

If implementation reveals a missing material decision, return to conversation
and Sigil proposal before continuing.

## 9. Limits And Examples

Do not create whole-repository coverage, adoption dashboards, numeric readiness
scores, mappings for every code symbol, guessed rationale, or unrelated cleanup.

If tests cannot run, label behavior as documented or inferred rather than
observed. If security, sensitive data, destructive behavior, or compliance
remains ambiguous, block implementation until the user or a qualified reviewer
resolves it.

### Repository With No Sigil

Run `sigil init` first. Validate the config. Inspect evidence for the workspace
root and every declared member, hold focused conversation where evidence is
insufficient, synthesize and confirm each boundary goal and interface, propose
ordinary summaries in their `#module.sigil` files, write them only after
approval, and stop for review. After approval, focus on the requested task and
begin its bounded evidence and proposal workflow.

### Vague Application

Repository naming suggests an internal operations tool, but no evidence
identifies its users or external surfaces. Use the shared design conversation to
resolve users, outcomes, boundaries, and interaction surfaces sequentially.
After its blocking decisions are resolved, synthesize a candidate goal and
interface for separate confirmation. Do not guess a boundary summary.

### Conflicting Task Evidence

Code deletes canceled bookings, a test expects deletion, and documentation says
history must be retained. Report the conflict and ask which contract is intended
after configured-boundary summaries are approved. Do not encode either behavior silently.

### Established Task Coverage

The requested component already has a reviewed contract and matching expands.
After confirming configured-boundary summaries, return to the shared review workflow
unless evidence suggests drift or the user requests reconciliation.
