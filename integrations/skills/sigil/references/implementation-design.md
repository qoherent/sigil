# Implementation Coverage And Component Selection

Use this procedure after contract intent is clear and before writing or changing
implementation. It prevents a high-level project, service, or feature contract
from standing in for the implementation abstractions and decisions needed to
produce coherent code.

## Contents

1. Discover implementation concerns
2. Select component, expand, or omit
3. Review UI component coverage
4. Build the implementation coverage map
5. Propose and approve missing Sigil
6. Limits and examples

## 1. Discover Implementation Concerns

Inspect the selected boundary, planned or existing owning modules, direct
dependents, tests, and relevant Sigil. Identify material concerns such as:

- coherent product and domain responsibilities;
- programming abstractions and internal APIs;
- state machines, processing pipelines, and lifecycle owners;
- persistence, concurrency, retry, ordering, and failure boundaries;
- screens, views, and reusable UI surfaces;
- algorithms or transformations whose rationale is not safely reconstructable;
- dependency direction, ownership, and binding architecture decisions.

A component's goal and interface are public relative to its dependents. The
interface contains the operations, data, events, results, errors, and observable
promises available to them. It need not be exposed to an end user, external
client, or another deployable service.

## 2. Select Component, Expand, Or Omit

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

## 3. Review UI Component Coverage

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

## 4. Build The Implementation Coverage Map

Before implementation, report a compact map with these columns:

| Concern | Owner | Dependents | Sigil decision | Owning location | Coverage |
| --- | --- | --- | --- | --- | --- |

Use `component`, `expand`, or `omit` for the Sigil decision and `established`,
`partial`, or `missing` for coverage. Explain every `omit` that could otherwise
look material. Do not use numeric coverage scores.

High-level coverage is insufficient when the map contains a material missing or
partial implementation component or expand. Incidental mechanics do not block.

## 5. Propose And Approve Missing Sigil

When contract and implementation design are both clear, include both layers in
one exact Sigil proposal and one review cycle. When implementation design
depends on an approved higher-level decision, propose it afterward and use a
separate review cycle.

For missing coverage, present:

- the exact component, expand, and import text;
- the responsibility, dependents, and ownership reason;
- the target location beside its implementation owner;
- material alternatives or unresolved decisions;
- the updated implementation coverage map.

Write only approved Sigil, validate it, and stop at the Sigil review gate.
Implementation begins only after the written implementation coverage is
approved and the user explicitly requests code.

## 6. Limits And Examples

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
