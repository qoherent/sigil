# The rows you may return

Return a plain list of S-expression rows and nothing else. No rules, no
commands, no schedules, no nested expressions, no arithmetic — every argument is
a quoted string literal. One rule declaration anywhere in the artifact and the
whole thing is refused, including the valid rows beside it.

Four row shapes exist. Each begins with the identity of the Facet it came from,
which you copy from the pre-filled row you were given.

## `claim` — six columns

```
(claim "<facet>" "<subject>" "<relation>" "<object>" "<modality>" "<expected>")
```

| Column | Meaning |
| --- | --- |
| `facet` | The Facet this claim was read from. Copy it; never invent one. |
| `subject` | The entity the claim is about. |
| `relation` | One of the relation names below. |
| `object` | The entity the subject stands in that relation to. |
| `modality` | `required`, `permitted`, or `assumed`. |
| `expected` | `true` if the Facet asserts the relation holds, `false` if it asserts it must not. |

## `property` — four columns

```
(property "<facet>" "<subject>" "<property>" "<value>")
```

For the boolean properties below. `value` is `true` or `false`.

## `measure` — four columns

```
(measure "<facet>" "<subject>" "<property>" "<number>")
```

For the numeric properties below. `number` is a finite, non-negative decimal
written as a string. `risk` is between zero and one.

## `reading` — two columns

```
(reading "<facet>" "<outcome>")
```

`outcome` is `no-commitment` when you read the Facet and it authored nothing to
assert, or `unresolved` when a consequential choice is left open or the material
you would need is unavailable. Return one for every Facet that yields no claim.

## Logic sections are presented whole

Every other contract role is presented one Facet at a time. Logic is not.

The request's `flows` list names each component's Logic section and lists its
Facet identities **in source order**. Each of those Facets still has its own row
in `rows`, with its own identity and its own prose — the grouping adds order and
membership and takes nothing away.

Read a section's Facets together. A Facet is a paragraph, and flow-shaped prose
routinely runs across several of them: one real design states its first step in
one paragraph, its middle two in a second, and its closing return in a third.
Reading any one of those alone, you cannot see where the flow goes.

A Logic section may also mix flow prose with prose that is not flow at all — a
paragraph stating which component owns which result shape is an ordinary claim,
not a step. Returning no step for such a Facet is correct, and does not make it
uninterpreted.

## Relation names

A claim's relation is one of these, and nothing else:

`owns`, `provides`, `requires`, `dependsOn`, `excludes`, `delegates`,
`routesThrough`, `persistsAt`, `authorityFor`, `trusts`, `invokes`, `reads`,
`writes`, `uses`, `hasContract`, `from`, `to`, `target`, `initialState`,
`transitionsTo`

## Boolean properties

`required`, `exclusive`, `assumed`, `expected`

## Numeric properties

`cost`, `latencyBudgetMs`, `latencyMs`, `risk`

## What you never supply

**A section.** No row carries the contract role. The tool fills it from the
export, because only the export knows it, and asking you to restate it would
create drift the column exists to catch.

**An identity.** The tool mints every claim identity. Do not declare a Component
or a Tag — the frontend reserves those — and do not name an entity outside the
design's resolved import closure.

**A law.** The rules that derive contradictions, ownership conflicts and unmet
obligations are compiled into the tool. You supply what the design says; the
tool decides what follows from it.
