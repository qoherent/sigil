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
