# Brownfield Sigil Adoption

Use this procedure when a repository already contains implementation code but
has no Sigil or lacks relevant Sigil for the selected change boundary.

Brownfield adoption is incremental. Model one reviewed change frontier before
expanding coverage. Code is evidence of current behavior, not proof of desired
behavior or rationale.

## Contents

1. Detect coverage
2. Select a pilot
3. Gather and classify evidence
4. Reconcile current and intended behavior
5. Model component boundaries
6. Prepare the pre-edit proposal
7. Apply an approved proposal
8. Limits and failure handling
9. Examples

## 1. Detect Coverage

Inspect before asking the user for repository facts that can be discovered.

Use `rg --files` or equivalent repository discovery to locate implementation,
tests, manifests, documentation, and `.sigil` files. When a Sigil workspace
exists, run `sigil check` and use `graph` or `context` for the relevant target.

Classify the target:

- **No Sigil:** implementation exists, but no workspace-root `#module.sigil` or
  other `.sigil` files exist.
- **Partial coverage:** a Sigil workspace or components exist, but the selected
  implementation boundary has no contract, has only an unmatched expand, or
  lacks information required for the planned change.
- **Established coverage:** the selected boundary has a relevant component
  contract, collected expands, and enough approved context for ordinary Sigil
  review.

Use this brownfield procedure for no or partial coverage. For established
coverage, return to the normal Sigil workflow unless repository evidence
suggests drift or the user explicitly requests reconciliation.

Do not measure coverage with a numeric percentage. File counts do not show
whether the important contracts and rationale are represented.

## 2. Select A Pilot

Do not convert the whole repository in one pass. Select the smallest coherent
boundary that can produce useful reviewed Sigil.

Use this priority order:

1. the component or module explicitly named by the user;
2. the boundary affected by the next requested implementation change;
3. a high-risk or high-churn boundary with unclear behavior or ownership;
4. the smallest coherent ownership boundary that exposes a meaningful public
   contract.

When a broad request such as “add Sigil to this repository” has no explicit
target, inspect the repository and present one to three pilot candidates. Give a
recommendation with evidence and wait for the user to approve the pilot before
proposing files.

Prefer boundaries that can be reviewed independently. Do not choose a broad
“application” component merely because the repository has no obvious modules.
The minimal root application summary required for a new workspace is not the
pilot: it records confirmed repository-level purpose and public surfaces, while
the pilot remains the first detailed change frontier.

## 3. Gather And Classify Evidence

Read only the repository context needed to understand the pilot and its direct
relationships. Inspect, when relevant:

- root and nearby architecture or product documentation;
- manifests, package metadata, entrypoints, and exported APIs;
- implementation paths and public types;
- tests, fixtures, and acceptance scenarios;
- existing screens, screenshots, repository image assets, and accessible design
  files or links when the pilot includes UI behavior;
- schemas, migrations, persistence adapters, and data contracts;
- configuration, deployment, permissions, and integration boundaries;
- related Sigil, module summaries, imports, and collected expands;
- focused version history when it contains rationale unavailable elsewhere.

When the root application summary is absent, empty, import-only, or lacks a
confirmed goal or interface, the following repository-level evidence is
mandatory before asking about or proposing the application summary:

- root README, product, architecture, and operational documentation;
- dependency definitions, workspace manifests, lockfiles, and declared scripts;
- executable runtime, build, deployment, routing, and environment configuration;
- application entrypoints, exported APIs, commands, routes, event consumers, or
  top-level UI shells that reveal externally meaningful surfaces.

Do not read every file indiscriminately. Use manifests and entrypoints to find
the smallest set of evidence that explains what is built, how it is invoked,
and which users or systems interact with it.

### Application Picture For A New Workspace

After the repository scan, summarize a provisional application picture with:

- an application name grounded in repository naming;
- a one- or two-line candidate goal describing responsibility, intended user or
  system outcome, and repository-level boundary;
- a concise candidate interface describing externally meaningful surfaces such
  as a UI, API, CLI, library export, worker, events, or deployable service;
- the evidence paths supporting each statement;
- conflicts, unsupported inferences, and facts that remain unknown.

Then ask the user to confirm or correct the candidate goal and interface. Prefer
a focused question that includes the evidence-based draft, for example:

```text
From the README, package manifest, runtime configuration, and entrypoints, I
understand this application to exist to <candidate goal>. Its external surface
appears to be <candidate interface>. What should I correct before I preserve
this as the root application contract?
```

This confirmation is mandatory even when the repository evidence appears
consistent. Repository evidence describes the current system; the user's answer
establishes the intended application contract. If evidence is sparse, say what
could not be determined and ask directly for the goal and interface. Do not
propose exact root-module text, create a placeholder, or use imports as a
substitute while either remains unconfirmed.

Classify every material finding:

- **Observed behavior:** behavior demonstrated by implementation, executable
  configuration, or a passing test.
- **Documented intent:** an explicit statement in maintained documentation,
  comments, architecture notes, or issue context.
- **User-confirmed intent:** behavior or rationale explicitly confirmed by the
  user for the proposed contract.
- **Unresolved ambiguity:** multiple interpretations remain possible and would
  materially change the contract, ownership, state, or implementation.
- **Suspected accidental behavior:** current behavior appears incidental,
  inconsistent, unsafe, obsolete, or unsupported by intent.

Report evidence with relevant repository paths and line numbers when practical.
Keep evidence records in the review summary rather than adding them to Sigil
syntax.

Do not assign confidence scores. Explain the concrete evidence and uncertainty.

Repository evidence has different meanings:

- code and executable configuration show what currently happens;
- tests show behavior someone chose to exercise, but may be incomplete or
  stale;
- documentation may express intent, but may also be outdated;
- screenshots and design artifacts may show current presentation or documented
  intent depending on their provenance, but do not prove the desired contract;
- names and directory structure suggest boundaries, but do not prove them;
- version history may reveal rationale, but absence of history is not evidence
  of intent;
- user approval establishes the contract Sigil should preserve.

Never invent why existing code was written. Never convert an implementation
detail into a binding constraint merely because it exists.

## 4. Reconcile Current And Intended Behavior

Compare observed behavior, tests, documentation, configuration, existing Sigil,
and the user's requested outcome.

For each material behavior, identify whether it is:

- already aligned with confirmed intent;
- current behavior that should remain but still needs confirmation;
- legacy behavior that the user wants to change;
- conflicting evidence that requires a decision;
- irrelevant implementation detail that should stay out of Sigil.

When evidence conflicts, preserve the conflict in the review summary. Do not
silently treat code, tests, documentation, or a preferred architecture pattern
as authoritative.

Ask a focused user question when resolving the conflict would change:

- the public interface or observable behavior;
- ownership or dependency direction;
- permissions, security, or data handling;
- persistent state or lifecycle transitions;
- compatibility, failure behavior, or acceptance criteria.

Initial brownfield Sigil contains only the contract the user approves. Do not
write every observed behavior and plan to clean it up later. Keep legacy and
migration differences in the review summary until the user decides which
behavior is intended.

## 5. Model Component Boundaries

Model stable software responsibilities, not the repository's file tree.

Choose a `component` boundary when the candidate has:

- a coherent goal and reason to exist;
- a recognizable caller, user, or dependent module;
- a public interface or externally relied-on behavior;
- meaningful ownership of policy or state;
- a change boundary that should remain understandable over time.

Do not create one component for every class, function, table, endpoint, or
directory. Do not create a component whose only goal is to mirror an existing
technical layer.

Use `expand` for operational details, state, logic, constraints, and cases. Keep
implementation-specific expands beside the code they explain. Keep a shared
public component at a contract or module-summary location only when multiple
implementations genuinely depend on it.

### Workspace Marker

When no Sigil workspace exists, propose `sigil.config` as the workspace marker
and a minimal root `#module.sigil` as the confirmed application summary. The
root module should:

- declare one repository-level application component with a confirmed goal and
  externally meaningful interface;
- describe only confirmed product, deployable, bounded-context, or
  cross-cutting facts;
- avoid pretending to inventory the entire repository;
- avoid declaring components whose boundaries have not been reviewed.
- import only reviewed pilot components that the root summary genuinely
  depends on.

The root component name should follow confirmed product or repository naming.
Its interface describes how users or external systems encounter the
application; a list of internal imports is not an interface. Omit `expand`
unless confirmed repository-level logic, constraints, or cases add useful
meaning.

A minimal root module normally has this shape:

```sigil
component ConfirmedApplicationName {
  goal {
    confirmed responsibility, intended outcome, and repository-level boundary
  }

  interface {
    confirmed externally meaningful UI, API, CLI, library, worker, event, or service surface
  }
}
```

Add an import above the component only when a reviewed pilot contract is a real
dependency of this application summary. The component remains meaningful if the
import is removed.

If repository-level purpose or interface is unclear, the config proposal may
continue, but the root-module proposal waits for the focused confirmation step.
Never create or preserve an empty root module or one containing only imports.

### Placement And Imports

Place pilot component contracts beside their owning module or source boundary.
Place implementation-specific expands beside the relevant code. Use root-relative
Sigil imports and reuse existing component declarations rather than creating
duplicates.

When partial coverage exists, inspect the graph before choosing a new file or
component name. Extend or import the existing contract when ownership matches.
Create a new component only when it owns a distinct responsibility.

## 6. Prepare The Pre-Edit Proposal

Do not create or modify Sigil during brownfield discovery. Before editing,
report these sections and write `none` for empty groups:

### Coverage State

State no Sigil, partial coverage, or established coverage and cite the evidence.

### Pilot Scope And Rationale

Name the selected boundary, why it is the smallest useful frontier, and which
alternatives were rejected.

### Repository Evidence

List observed behavior, documented intent, user-confirmed intent, and relevant
paths. For a new workspace, include the provisional application picture and the
user's confirmation or corrections.

### Observed Versus Intended Behavior

Separate what currently happens from what the proposed contract will require.

### Conflicts, Unknowns, And Suspected Accidents

Report unresolved evidence, possible legacy bugs, stale documentation, and
decisions that could change the contract.

### Proposed Boundaries And Ownership

Describe each component's responsibility, public dependents, owned state or
policy, and non-responsibilities where needed.

### Proposed Sigil

Show the exact component, expand, and import text that would be written. Include
the minimal root module proposal when required. Its goal and interface must
reflect the confirmed application picture, and its imports must be limited to
reviewed component contracts.

### Proposed Locations And Imports

List each target path, why it belongs there, and every import that will be added
or updated.

### Approval Request

Ask the user to approve, reject, or revise the pilot, boundaries, locations,
imports, and exact semantic lines. Do not treat approval of the general adoption
goal as approval of the proposed Sigil.

Before requesting approval, apply the semantic-readiness, standards,
cross-Sigil coherence, and modularity procedures to the proposed content as far
as the available evidence permits. Include any resulting warning or sourced
suggestion in the proposal rather than silently adding it.

## 7. Apply An Approved Proposal

After explicit approval:

1. create or update only the approved Sigil files;
2. create the approved minimal root `#module.sigil` when no workspace exists;
3. colocate components and implementation-specific expands as proposed;
4. add or update only the approved imports;
5. run `sigil check` on the workspace;
6. use `sigil graph` or `sigil context` when relationships were introduced or
   changed;
7. reread the written files and run the complete standards-aware semantic,
   coherence, and modularity review;
8. stop at the Sigil review gate and report the exact files changed,
   assumptions captured, remaining questions, and validation results.

Do not modify implementation code in the same pass. Approval of the brownfield
proposal authorizes the proposed Sigil files, not code changes.

If validation or final review reveals a new semantic decision, propose the
change and wait for approval rather than extending the approved scope.

## 8. Limits And Failure Handling

Keep the first adoption pass bounded. Do not create:

- whole-repository Sigil coverage;
- migration dashboards or adoption tracking files;
- numeric coverage, confidence, readiness, or modularity scores;
- automatic mappings from every code symbol to a Sigil component;
- implementation rewrites, cleanup, or architecture migrations;
- guessed rationale presented as fact.

If the repository is too large to inspect safely, narrow the pilot using the
selection priority and explain what remains outside the reviewed context.

If tests cannot run or runtime behavior cannot be verified, classify the
behavior as documented or inferred rather than observed. Do not block a
low-risk proposal solely because the entire legacy system cannot be executed,
but surface uncertainty that could affect the contract.

If security, data, compliance, or destructive behavior remains ambiguous, treat
the proposal as blocked until the user or a qualified reviewer resolves it.

## 9. Examples

### Repository With No Sigil

A user asks to add Sigil to a large service. Inspect the architecture and next
planned change, plus root product documentation, dependency definitions,
executable configuration, and entrypoints. Present the evidence-based candidate
application goal and interface and ask the user to correct or confirm them.
After confirmation, recommend one coherent pilot and show a minimal root config,
a meaningful root application component, and colocated pilot text. Do not create
the files before approval, and do not use an empty or import-only root module.

### Partial Coverage

The workspace already defines `Auth`, but a nearby module duplicates session
rules without Sigil. Read the `Auth` contract and collected expands first. Propose
an additional expand or a separate component only if ownership evidence supports
it; do not create a second `Auth` component.

### Conflicting Evidence

Code deletes canceled bookings, a test expects deletion, and documentation says
history must be retained. Report both behaviors and ask which contract is
intended. Do not encode either behavior before approval.

### Suspected Accidental Behavior

An endpoint returns an internal database record because the current controller
passes it through. Unless documentation or the user confirms that shape as a
public guarantee, treat it as a possible leak rather than a required interface.

### Established Coverage

The selected component already has a reviewed contract and matching expands.
Return to the normal Sigil workflow, check for drift, and avoid loading the full
brownfield adoption procedure unless reconciliation is requested.
