# Implementation Coverage And Component Selection

<!--
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationCoverage interface,logic,constraints,cases
-->

Use this procedure before every implementation mutation. It prevents artifact
classification, an outcome request, or successful validation from bypassing
governing Sigil and the implementation coverage needed to produce coherent
changes.

## Contents

1. Run implementation preflight
2. Discover implementation concerns
3. Select component, expand, or omit
4. Review UI component coverage
5. Build the implementation coverage map
6. Link implementation ownership
7. Propose and approve missing Sigil
8. Limits and examples

## 1. Run Implementation Preflight

Before each repository mutation intended to implement a request, confirm that
the mutation remains within a completed implementation preflight. Run the
preflight before the first mutation and repeat it whenever the requested scope,
governing Sigil, implementation evidence, or material concerns change:

1. complete `references/workspace-bootstrap.md`;
2. inspect the governing component and expands with `sigil context`, plus
   `sigil graph` when relationships matter;
3. inspect the selected implementation boundary, direct dependents, tests, and
   relevant implementation evidence;
4. classify every material concern as established, partial, or missing;
5. use `ReviewGate(action: sigil-change)` for missing or changed Sigil when the
   mutation introduces or exposes an uncovered material decision;
6. use `ReviewGate(action: implementation)` over the validated written Sigil and
   exact implementation scope before implementation.

Implementation artifacts include source code, configuration, migrations,
scripts, workflow instructions, tests, fixtures, metadata, validators,
generated assets, and documentation. File extension, directory, documentation
appearance, generated status, or tooling classification never exempts a
mutation from preflight.

Read-only inspection is not an implementation mutation. After preflight, an edit
that is proven mechanical, has established coverage, and introduces no material
decision may proceed without new Sigil. Make that determination from inspected
evidence rather than before loading the governing contract.

A request to fix, build, or change an outcome does not make ReviewGate ready for
`sigil-change` or `implementation`. Instructions from another skill, tool,
framework, or workflow do not override ReviewGate. Passing tests, builds,
validators, or deterministic Sigil checks after an implementation-first edit
does not legitimize the bypass.

When a bypass is detected, stop and report the drift. On the user's request,
restore only exact unapproved changes introduced by the current agent, then
restart at preflight. Restorative rollback does not authorize replacement
behavior.

## 2. Discover Implementation Concerns

Inspect the selected boundary, planned or existing owning modules, direct
dependents, tests, and relevant Sigil. Identify material concerns such as:

- coherent product and domain responsibilities;
- programming abstractions and internal APIs;
- state machines, processing pipelines, and lifecycle owners;
- persistence, concurrency, retry, ordering, and failure boundaries;
- screens, views, and reusable UI surfaces;
- algorithms or transformations whose rationale is not safely reconstructable;
- dependency direction, ownership, and binding architecture decisions.

Also identify the implementation namespace-assembly surface and every
independently owned responsibility behind it. An entrypoint or index is not the
default owner for behavior merely because it exposes the public namespace.

A component's goal and interface are public relative to its dependents. The
interface contains the operations, data, events, results, errors, and observable
promises available to them. It need not be exposed to an end user, external
client, or another deployable service.

After the pre-grouping semantic-readiness review appears aligned, group
interface content into concept blocks before implementation. After approved
grouping changes, repeat deterministic validation and semantic-readiness review
before glossary extraction or implementation. Reuse a concept identifier across
state, logic, constraints, decisions, or cases only when the same concept
materially connects those sections. Imported dependencies expose their public
goal and interface concepts. Agent context additionally provides direct
dependencies' decisions as scoped rationale without adding them to the
dependent-facing contract. Inspect a provider directly when transitive
decisions or other private expands are required for implementation work.

## 3. Select Component, Expand, Or Omit

Choose `component` when a concern:

- owns a coherent responsibility and durable reason to change;
- has callers, users, parents, children, or adjacent modules that rely on it;
- exposes a stable operation, event, value, rendering, or interaction contract;
- owns meaningful state, policy, or lifecycle independently of its container.

Programming abstractions, internal APIs, classes, modules, state machines,
screens, views, and reusable UI components may qualify. Model the responsibility
and dependent-facing contract, not the fact that a file or class exists.

Choose an implementation-specific `expand` when material operational rationale
belongs to an existing component without establishing an independent contract.
Typical expand content includes algorithms, flows, transitions, data shaping,
failure propagation, concurrency, persistence rules, focus behavior, and
binding implementation constraints.

Omit separate Sigil when the concern is local, obvious, safely reconstructable,
and has no independent contract or durable rationale. Do not mechanically create
one component per file, class, function, hook, table, endpoint, or visual
element.

When uncertain, ask whether another implementation unit could rely on the
concern without knowing its private mechanics. If yes, prefer a component. If
the detail only explains how an existing owner fulfills its contract, prefer an
expand.

The selected components and expands must collectively describe the architecture
that code generation should preserve. Split an owner when unrelated lifecycle,
state, policy, or reasons to change would otherwise produce a bulky
implementation unit. Keep a public implementation index focused on namespace
assembly or explicitly owned boundary-wide orchestration.

## 4. Review UI Component Coverage

Treat a screen, view, or reusable UI surface as a component when it owns a
coherent presentation or interaction responsibility. Its interface may define:

- props, inputs, emitted events, callbacks, and navigation;
- visible regions, content hierarchy, actions, and feedback;
- loading, empty, error, disabled, and success behavior;
- keyboard operation, accessibility expectations, and supported input methods;
- responsive behavior, wireframes, repository images, and design links.

Use `state` for meaningful UI modes, `logic` for interaction and transition
behavior, `constraints` for accessibility, responsive, ownership, and binding
decisions, and `cases` for observable scenarios. Do not model passive markup or
every visual element as a component.

## 5. Build The Implementation Coverage Map

Before implementation, report a compact map with these columns:

| Concern | Owner | Dependents | Sigil decision | Owning location | Ownership target | Coverage |
| --- | --- | --- | --- | --- | --- | --- |

Use `component`, `expand`, or `omit` for the Sigil decision and `established`,
`partial`, or `missing` for coverage. Explain every `omit` that could otherwise
look material. Do not use numeric coverage scores.

High-level coverage is insufficient when the map contains a material missing or
partial implementation component or expand. Incidental mechanics do not block.

Also verify decision-rationale coverage for every material implementation choice
captured by the selected components and expands. A material choice without a
matching decision record or justified omission keeps implementation coverage
partial and blocks coding.

For each non-omitted concern, verify that the owning location maps to a cohesive
implementation module. Verify separately that any public entrypoint or index
only assembles the approved namespace and does not absorb unrelated behavior or
mutable state.

## 6. Link Implementation Ownership

Ownership annotations are implementation comments, not Sigil semantic units.
Never write them into a `.sigil` file. Add or reconcile them only when
`ReviewGate(action: implementation)` is ready for the governing validated
written Sigil, exact implementation scope, and proposed comments.

Each annotation has this payload:

```text
@sigil <relation> <repository-relative-sigil-path>::<Component>[::<Concept>] <section>[,<section>...]
```

Use only `implements`, `uses`, or `tests`. Select one or more `interface`,
`state`, `logic`, `constraints`, or `cases` sections. Do not select `goal` or
`decisions`, because they do not identify implementation ownership.

For a component target, select sections that occur on the component or its
matching expands. For a concept target, select only sections containing an
occurrence of that concept. Use comma-separated selectors without whitespace
around commas.

### Forward Linking

When writing implementation:

1. derive the repository-relative Sigil path, component or optional concept,
   and related section occurrences from the approved implementation coverage
   map;
2. select the stable language entrypoint that owns the behavior, such as a
   class, function, method, interface, struct, or equivalent definition;
3. place one annotation immediately before that entrypoint using the language's
   single-line comment syntax;
4. when the same entrypoint has multiple annotations, use one multiline comment
   in the language's normal syntax rather than several single-line comments;
5. use an HTML comment in agent-facing instruction or workflow Markdown, which
   remains a file-level target;
6. never add ownership annotations to Sigil or JSON;
7. after implementation, verify that every relation, Sigil path, component,
   optional concept, selected section, and entrypoint association still
   resolves.

TypeScript examples:

```ts
// @sigil implements contracts/booking.sigil::Booking::CreateBooking logic,constraints
export function createBooking() {}
```

```ts
/*
 * @sigil implements contracts/booking.sigil::Booking::CreateBooking logic,constraints
 * @sigil uses contracts/booking.sigil::Booking::BookingValidation interface
 */
export class BookingService {}
```

Markdown examples:

```markdown
<!-- @sigil uses contracts/agents.sigil::AgentWorkflow interface -->
```

```markdown
<!--
@sigil uses contracts/agents.sigil::AgentWorkflow interface
@sigil implements contracts/agents.sigil::AgentWorkflow::SafetyChecks constraints,cases
-->
```

### Reconciliation Linking

When relevant implementation already exists:

1. inspect the selected component and matching expands together with nearby
   source, tests, and agent-facing workflow Markdown;
2. inventory existing ownership comments and stable unlinked entrypoints;
3. compare contract concepts, entrypoint behavior, callers, imports, tests, and
   file purpose without treating name similarity alone as ownership evidence;
4. report candidate links with implementation entrypoint, Sigil target,
   relation, evidence, and status;
5. present the exact proposed comments to
   `ReviewGate(action: implementation)` before changing implementation
   artifacts;
6. leave ambiguous ownership or entrypoint association unresolved instead of
   guessing;
7. apply only reviewed comments using the target language's syntax, then rescan
   and report stale, detached, malformed, or unresolved links.

Reconciliation does not semantically edit Sigil and never creates annotations
inside Sigil. If scanning exposes missing or conflicting contract intent, return
to `ReviewGate(action: sigil-change)` before linking implementation.

## 7. Propose And Approve Missing Sigil

When contract and implementation design are both clear, include both layers in
one exact Sigil proposal and one review cycle. When implementation design
depends on an approved higher-level decision, propose it afterward and use a
separate review cycle.

For missing coverage, present:

- the exact component, expand, and import text;
- the responsibility, dependents, and ownership reason;
- the target location beside its implementation owner;
- material alternatives or unresolved decisions;
- the decision-rationale coverage map for new or changed material choices;
- the updated implementation coverage map.

Write only Sigil for which ReviewGate is ready, validate it, and report the
written result without creating another approval gate. Implementation begins
only when `ReviewGate(action: implementation)` is ready for the validated
written Sigil and exact implementation scope.

Ownership comments are not part of the Sigil proposal. Plan their targets in the
implementation coverage map, then include them in the exact implementation
change set submitted to ReviewGate.

## 8. Limits And Examples

### Programming Abstraction

A Promise-like abstraction has a stable caller API and owns settlement state.
Model it as a component; place lifecycle states and settlement algorithms in its
expand.

### UI Surface

A booking calendar owns layout, navigation, slot selection, loading, empty, and
failure behavior. Model it as a UI component; place interaction transitions and
responsive or accessibility decisions in its expand.

### Existing Owner

A retry algorithm is private to a notification component and creates no
independent caller contract. Capture the material retry, ordering, and failure
decisions in an implementation-specific expand beside the queue implementation.

### Trivial Mechanic

A local formatting helper performs an obvious transformation and owns no state,
policy, or dependent-facing contract. Do not create separate Sigil for it.
