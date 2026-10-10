# Read the whole file in code terms

Read `request.json`, `source.txt` and the three guidance documents in this
directory. Everything needed to answer this file is here. The source is the
whole file, including helpers, state, initialization and tests. Do not read
other code files or design sources. Return data rows only, with quoted string
atoms, in `result.egg`. Never return rules, declarations, tool identities or
design claim rows.

The code vocabulary has exactly these row shapes:

```
(element "local name" "function")
(realizes "local name" "Component")
(realizes "local name" "Component::tag label")
(act "local name" "uses" "Component::tag label")
(measure "local name" "durationDays" "7")
```

An element name is nonempty and local to this file. The tool qualifies it with
the file path; never coin a tool identity or name an element of another file.
Kinds are `function`, `module`, `type`, `state`, `test`. Use a module element
for file-level work that no smaller element covers. Describe every part of
the whole file, including undocumented work. An answer with no rows or no
element row leaves the file unread.

Observation and mapping are separate. `element`, `act` and `measure` describe
what code does. Every `realizes` mapping is your reading of the code and the
design context; annotations such as `@sigil implements`, `uses` or `tests` are
not mapping evidence. A `realizes` row targeting a component establishes
membership only when at least one of its in-scope design claims accounts for
the element's actual work. Location in that component's file does not establish
membership. A `realizes` row targeting a Tag states delivery of that Tag. An
element delivering a Tag does not thereby become a component: state component
membership separately when supported.

An unmapped element is a correct answer when no presented design claim
accounts for its work. Keep its element row and omit `realizes`. Never invent
a mapping to hide undesigned code. An `act` row alone is not a mapping.

Each design name is listed in `names`, with its kind, qualified label, admitted
claims and exact Facet prose. Prefer `qualifiedLabel`. A bare label is accepted
only when unique in scope. A cross-file `uses` targets a listed design name,
never another file's element. `act` relations are `uses`, `owns`, `invokes`,
`dependsOn`; their targets are always listed design names.

Measures are `durationDays`, `leadDays`, `spanDays` (whole days, converted by
you) and `latencyMs` (milliseconds). The element's Tag realizations connect its
measure to the design Tag's bounds: durationDays answers maxDurationDays,
leadDays answers maxLeadDays, spanDays answers maxSpanDays, and latencyMs
answers latencyBudgetMs. Put a measure on the element that enforces or exhibits
it; do not infer a bound from a comment alone. Separate elements when measures
apply to different delivered Tags. Numbers are finite decimal strings.

Test code uses kind `test`. A test realizes the component and Tags it actually
exercises. Such mappings keep tests accounted for, but never establish
implementation membership, delivery, ownership, or satisfaction of a promise.
