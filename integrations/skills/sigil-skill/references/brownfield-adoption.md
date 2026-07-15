# Brownfield Sigil Adoption

Use this procedure when implementation exists but Sigil coverage is absent,
partial, ambiguous, or suspected to have drifted. Establish the workspace and
its approved RootSigil before modeling or implementing the requested task.

Code is evidence of current behavior, not proof of desired behavior or
rationale. Preserve existing user changes and unrelated worktree content.

## Contents

1. Initialize or validate the workspace
2. Establish and review RootSigil
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
config before RootSigil discovery and must never overwrite an existing config.

When a config already exists, do not run `init`. Validate it in place.

After initialization or discovery, run:

```bash
sigil version <repository-root> --format json --pretty
sigil check <repository-root> --format json --pretty
```

Stop with a compatibility report when initialization fails, the existing config
is invalid, or the configured CLI, core, or Sigil versions are not
supported. Do not create `.sigil` files until the workspace contract is valid.

## 2. Establish And Review RootSigil

Before focusing on the requested implementation task, ensure the workspace-root
`#module.sigil` is a meaningful, approved RootSigil. An empty, import-only, or
materially ambiguous root module does not satisfy this requirement.

### Gather Repository-Level Evidence

Inspect the smallest root-level evidence set that explains what the application
is, why it exists, and how users or external systems encounter it:

- root README, product, architecture, and operational documentation;
- dependency definitions, workspace manifests, lockfiles, and declared scripts;
- executable runtime, build, deployment, routing, and environment configuration;
- application entrypoints, exports, commands, routes, event consumers, workers,
  or top-level UI shells;
- an existing RootSigil and related repository-level tests when present.

Do not read the entire repository indiscriminately. Do not promote a framework,
dependency, environment variable, or implementation pattern into a binding root
decision merely because it exists.

### Build The Application Picture Through Conversation

Assess whether evidence is specific enough to describe:

- the application name;
- its responsibility and intended outcome;
- its users, callers, or external systems;
- its repository-level boundary and important non-responsibilities;
- its externally meaningful UI, API, CLI, library, worker, event, or service
  surfaces.

When any material part remains vague, unsupported, or contradictory, begin a
focused conversation. State what repository evidence suggests and what remains
unknown, then ask the user for the missing product, boundary, and interface
information.

Continue with targeted follow-up questions while answers leave material
RootSigil decisions unresolved. Do not guess missing purpose or interface lines.
Do not use a single confirmation question as a substitute for discovery
conversation when the evidence is insufficient.

After the conversation, synthesize:

- a candidate application name;
- a concise goal covering responsibility, intended outcome, and boundary;
- a concise interface covering users or systems and external surfaces;
- evidence paths and user-provided decisions supporting each statement;
- remaining conflicts, unsupported inferences, and intentionally excluded facts.

Ask the user to confirm or correct this synthesized goal and interface as a
separate decision. Confirmation is mandatory even when repository evidence and
conversation appear consistent.

### Propose RootSigil

After goal and interface confirmation, classify confirmed application-wide
detail for an optional root `expand`:

- `state`: runtime, deployment, persistence, or operational modes;
- `logic`: cross-cutting flows, routing, orchestration, and lifecycle behavior;
- `constraints`: policies, architecture, dependency direction, compatibility,
  supported platforms, and binding technologies;
- `cases`: observable application outcomes, workflows, failures, and acceptance
  scenarios.

Keep secrets, volatile values, incidental dependencies, low-level
configuration, private algorithms, and task-specific behavior outside
RootSigil. A technology belongs in root `constraints` only when repository
evidence or user confirmation establishes it as a binding application decision.

Present the exact RootSigil text and location before editing. The root component
must remain meaningful without imports and may import only already-reviewed
contracts that the application summary genuinely depends on.

Wait for approval, write only the approved RootSigil, run `sigil check`, use
`graph` or `context` when relationships changed, and stop at the RootSigil review
gate. Do not move to task modeling until the user approves the written RootSigil.

## 3. Focus On The Requested Task

After RootSigil approval, return to the user's requested task. Select the
smallest coherent change-frontier boundary in this order:

1. the component or module explicitly named by the user;
2. the boundary affected by the requested implementation change;
3. a high-risk or high-churn boundary whose ownership is unclear;
4. the smallest coherent boundary exposing a meaningful public contract.

Do not convert the whole repository. If the request is broad and has no concrete
task boundary, present one to three evidence-backed candidates and recommend one.
Wait for the user's decision before proposing task-specific Sigil.

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

For established coverage, use the shared workflow unless evidence suggests
drift or the user requests reconciliation. Do not use numeric coverage scores.

## 4. Gather And Classify Task Evidence

Read only evidence needed for the requested boundary and direct relationships:

- nearby requirements, architecture, and product documentation;
- public types, entrypoints, exports, routes, handlers, screens, or events;
- tests, fixtures, screenshots, and acceptance scenarios;
- schemas, migrations, persistence, permissions, and integration boundaries;
- configuration and deployment facts that materially affect the task;
- related Sigil, imports, RootSigil summaries, and collected expands;
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
RootSigil, and the user's requested outcome.

For each material behavior identify whether it is:

- aligned with confirmed intent;
- current behavior that still needs confirmation;
- legacy behavior the user wants to change;
- conflicting evidence requiring a decision;
- irrelevant implementation detail that stays out of Sigil.

When evidence conflicts, preserve the conflict in the review summary. Ask a
focused question when resolution could change public behavior, ownership,
permissions, sensitive data, persistent state, lifecycle, compatibility,
failure behavior, or acceptance criteria.

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
do not reopen approved RootSigil unless the task reveals a genuine application-
wide decision.

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

Run `sigil init` first. Validate the config. Inspect root application evidence,
hold focused conversation where evidence is insufficient, synthesize and confirm
the application goal and interface, propose RootSigil, write it only after
approval, and stop for RootSigil review. After approval, focus on the requested
task and begin its bounded evidence and proposal workflow.

### Vague Application

Repository naming suggests an internal operations tool, but no evidence
identifies its users or external surfaces. Ask targeted questions about users,
outcomes, boundaries, and interaction surfaces. Continue until the answers are
sufficient, then synthesize a candidate goal and interface for separate
confirmation. Do not guess RootSigil.

### Conflicting Task Evidence

Code deletes canceled bookings, a test expects deletion, and documentation says
history must be retained. Report the conflict and ask which contract is intended
after RootSigil is approved. Do not encode either behavior silently.

### Established Task Coverage

The requested component already has a reviewed contract and matching expands.
After confirming the workspace RootSigil, return to the shared review workflow
unless evidence suggests drift or the user requests reconciliation.
