# The rows you may return

Return a plain list of S-expression rows and nothing else, one row per line, as
egglog text. It is not JSON: no array, no object, no quotes around a whole row,
no markdown fence. No rules, no
commands, no schedules, no nested expressions, no arithmetic — every argument is
a quoted string literal. One rule declaration anywhere in the artifact and the
whole thing is refused, including the valid rows beside it.

A row that is plain data but wrong — a name outside its Facet's list, a relation
that is not published, a step number that does not exist — costs only the unit
it is in: that Facet, or that Logic section. The rest of the answer is kept, and
you are asked about the refused unit again with the reason.

Eight row shapes exist. Each begins with the Facet it came from, which you copy
from the pre-filled row you were given: its `handle` (`"#3"`), or its full
`facet` id. Prefer the handle.

## `claim` — six columns

```
(claim "<facet>" "<subject>" "<relation>" "<object>" "<modality>" "<expected>")
```

| Column | Meaning |
| --- | --- |
| `facet` | The Facet this claim was read from, as its handle or its full id. Copy it; never invent one. |
| `subject` | The entity the claim is about, from this Facet's `names`. |
| `relation` | One of the relation names below. |
| `object` | The entity the subject stands in that relation to, from this Facet's `names`. |
| `modality` | `required`, `permitted`, or `assumed`. |
| `expected` | `true` if the Facet asserts the relation holds, `false` if it asserts it must not. |

## `property` — four columns

```
(property "<facet>" "<subject>" "<property>" "<value>")
```

For the boolean properties below. `value` is `true` or `false`.

`exclusive` is the one to watch for. A Facet that says a component is the only
one that may change some state needs `(property "<facet>" "<state>" "exclusive"
"true")` beside its `owns` claim. Without it, two owners of the same state are
never reported as a conflict.

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

## `step` — two columns

```
(step "<facet>" "<ordinal>")
```

Declares one step of a flow. `ordinal` is the step's position within its own
Facet, counting from `1`, in the order that Facet's prose describes the steps.
Every Facet numbers its own steps from 1, so you never keep a count across
paragraphs; the tool works out each step's place in the whole Logic section from
where its Facet sits in it. Two steps of one Facet never share a number.

A step is how every other row refers to a step: `step:2` is step 2 of the Facet
the row belongs to, and `step:#7.1` is step 1 of Facet `#7`, which must be in
the same Logic section. You cannot name a step any other way: its identity is
minted after your answer is read, so it does not exist yet when you write.

## `end` — two columns

```
(end "<facet>" "<ordinal>")
```

Says that step `ordinal` of this Facet ends the flow. It is the only way to end
one. Write it only where the prose says the flow ends there: the step returns a
result, refuses, or says the flow is finished. A flow has only the ends its
prose declares; a step the prose never ends is reported as unreached.
A branching flow ends once per branch.

## `guard` — four columns

```
(guard "<facet>" "<step>" "<operand>" "<value>")
```

`step` is a step reference, `step:K` or `step:#N.K`. `operand` is one of `state`,
`input` or `constraint`, and `value` is what the guard compares against:

- `state` — a Tag the design declares, which the step reads.
- `input` — a literal value, written as text. It is never resolved as an entity,
  so an argument name that the design never declares is fine here.
- `constraint` — the **Facet** that authored the constraint, as its handle or
  full id, not the claim. Claim identities do not exist yet when you write.

## `undeclared` — two columns

```
(undeclared "<facet>" "<name>")
```

Says the Facet's prose relies on something its `names` list does not carry,
such as a library, a mechanism, or a thing the design never declared as a Tag.
`name` is the thing as the prose writes it, so it must occur in the Facet's
prose. Use it instead of inventing a name for a claim. It is reported as a
warning about the design, and it counts as reading the Facet. Do not use it for
something that is on the Facet's list: state the claim instead.

## What a step does is an ordinary claim

A step is an entity, so everything about it is a `claim`, not a row of its own:

```
(claim "<facet>" "step:2" "reads" "<tag>" "required" "true")
(claim "<facet>" "step:2" "writes" "<tag>" "required" "true")
(claim "<facet>" "step:2" "invokes" "<tag>" "required" "true")
(claim "<facet>" "step:2" "to" "step:#7.1" "required" "true")
```

Write `step:<number>` to name a step of the Facet the row belongs to, and
`step:#<handle>.<number>` for a step of another Facet in the section. A claim
naming a step is always `required` and `true`: a step either reads a state or it
does not, and there is no permitted or assumed about it. Only a Logic Facet can
name a step.

An edge — the `to` relation — runs from a step to whatever the prose says
consumes what that step produced: a later step. What a step reads, writes and
calls are claims about the step, not edge targets.

**An `end` row is what declares an end of the flow.** There is no edge to the
flow itself: write `(end "<facet>" "<ordinal>")`. A branching flow declares one
end per branch, so more than one `end` is normal.

**A rejection is an end.** A step that refuses the request, returns an error, or
stops because a check failed ends that branch of the flow, even when no later
step consumes its result. Give it an `end`. A check that only gates a later step,
such as "step one checks the grid, step two rejects a bad time", is not a dead
end: each refusal declares its own end, and the passing path goes on to the next
step.

**An end is declared by the prose, never by position.** Give a step an `end` only
when the prose says the flow ends there: the step returns a result, refuses, or
the prose says the flow is finished. A step that commits, saves, or completes
the command is an end, the same as a return: "step four commits" finishes that
command. Being the last step of a paragraph is not an end. Writing state or
calling outward is not an end either, unless the prose says that is where the
flow stops. A step that only compares, reads, or checks, and says nothing about
returning, refusing, or committing, is not an end.

**A dead end is reported, not repaired.** A step whose result no later step uses,
and whose prose declares no end, gets no outgoing edge at all. Do not add an
`end` to close it. The tool reports that step as unreached, and finding it is the
point.

A paragraph saying "derive X, then construct Y" states an order, not a
consumption: unless the prose says Y uses what X produced, there is no edge from
X to Y.

## Logic sections are presented whole

Every other contract role is presented one Facet at a time. Logic is not.

The request's `flows` list names each component's Logic section and lists its
Facet identities and handles **in source order**. Each of those Facets still has
its own row in `rows`, with its own identity and its own prose — the grouping
adds order and membership and takes nothing away.

Read a section's Facets together. A Facet is a paragraph, and flow-shaped prose
routinely runs across several of them: one real design states its first step in
one paragraph, its middle two in a second, and its closing return in a third.
Reading any one of those alone, you cannot see where the flow goes. Number each
Facet's steps from 1, and join a step to another Facet's step with
`step:#<handle>.<number>`.

A Logic section may also mix flow prose with prose that is not flow at all — a
paragraph stating which component owns which result shape is an ordinary claim,
not a step. Returning no step for such a Facet is correct, and does not make it
uninterpreted.

When only some units are asked again, the Constraints Facets of the section are
shown marked `"context": true`, so a guard can name one. Return nothing for them.

## Relation names

A claim's relation is one of these, and nothing else:

`owns`, `provides`, `requires`, `dependsOn`, `excludes`, `delegates`,
`routesThrough`, `persistsAt`, `authorityFor`, `trusts`, `invokes`, `reads`,
`writes`, `uses`, `hasContract`, `from`, `to`, `target`, `initialState`,
`transitionsTo`

## Boolean properties

`required`, `exclusive`, `assumed`, `expected`

## Numeric properties

`cost`, `latencyBudgetMs`, `latencyMs`, `risk`, `maxDurationDays`, `maxLeadDays`,
`maxSpanDays`

The three day bounds are distinct: maximum duration, days ahead of the current
date, and total span. Convert the prose to whole days. Two different bounds on
one Tag stay two measures; never collapse them into one generic day count.

## What you never supply

**A section.** No row carries the contract role. The tool fills it from the
workspace, because only the workspace knows it, and asking you to restate it would
create drift the column exists to catch.

**An identity.** The tool mints every claim identity. Do not declare a Component
or a Tag — the tool reserves those — and do not name an entity outside the
Facet's own `names` list. If the prose relies on something that list lacks, say
so with an `undeclared` row instead.

**A law.** The rules that derive contradictions, ownership conflicts and unmet
obligations are compiled into the tool. You supply what the design says; the
tool decides what follows from it.
