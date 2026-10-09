# Rows that are refused, and why

Each of these is rejected by the tool. They are here so you can recognize the
shape before you return it, not so you can repair one afterwards.

## A claim pointing at itself

```
(claim "#1" "SearchService" "provides" "SearchService" "required" "true")
```

**Flagged as degenerate.** Subject and object are the same entity, so the claim
says nothing that could be satisfied, contradicted, or checked. It does not
count as an interpretation of its Facet — a unit that yields only this is
refused and asked again.

This usually happens when a Goal Facet names only the component and you reach
for the component again as the object. The object should be the capability the
component provides, which is a Tag or another component, not the subject
repeated.

## A claim you deduced rather than read

> Facet: "SearchPanel displays search results."

```
(claim "#2" "SearchPanel" "dependsOn" "SearchService" "required" "true")
```

**Refused in substance, even though it validates.** The Facet says the panel
displays results. It does not say the panel depends on the service — you
inferred that from knowing where results come from. The laws derive dependency
and delegation themselves; asserting the deduction adds a fact nobody authored
and the tool can no longer tell it from one that was.

Return what the Facet said:

```
(claim "#2" "SearchPanel" "provides" "search results" "required" "true")
```

This is the failure mode the tool cannot mechanically catch, which is why it is
stated here. A claim relating two entities that both appear, in a relationship
the Facet does not state, passes every check the tool can run.

## A claim naming an entity that does not exist

```
(claim "#3" "SearchPanel" "uses" "RetryPolicy" "required" "true")
```

**Refuses the unit.** `RetryPolicy` is not on this Facet's `names` list: it is
not the Facet's component, not a component its source imports from, and not a Tag
its prose names. The same happens when it is an entity the design declares but
this Facet does not reference. The whole unit is asked again with the reason, so
the Facet's other rows are not read until you answer it.

If the prose really does rely on `RetryPolicy`, say that instead:

```
(undeclared "#3" "RetryPolicy")
```

Two narrower versions of the same mistake:

- **Declaring an identity.** A row that declares a Component or a Tag is
  refused; the tool reserves those identities and the tool mints every
  claim identity itself.
- **Naming a Tag you can see but the Facet cannot.** A Tag owned by another
  component, in a source this one does not import, or one that a dependency keeps in a
  private section, is not on the Facet's list even though it exists in the
  workspace.

## A rule beside valid data

```
(claim "#4" "SearchService" "provides" "query" "required" "true")
(rule ((provides a b)) ((reachable a b)))
```

**The whole artifact is refused**, not just the rule. The valid claim above it
is discarded with it. Laws are compiled into the tool; an artifact that supplies
one is not a partially usable interpretation, it is the wrong kind of document.
The same applies to any command, schedule, or non-literal argument.

## A row with the wrong shape

```
(claim "#5" "SearchService" "provides" "query" "required")
(claim "#6" "SearchService" "offers" "query" "required" "true")
(claim "#7" "SearchService" "provides" "query" "mandatory" "true")
```

**Refuses the unit, with the offending row named.** The first is missing its `expected`
column. The second uses a relation name that is not in the published list —
`offers` is not a relation, `provides` is. The third uses a modality that does
not exist; the three are `required`, `permitted`, and `assumed`.

## A row carrying a section

```
(claim "#8" "goal" "SearchService" "provides" "query" "required" "true")
```

**Refuses the unit on arity.** A claim has six columns and none of them is the contract
role. The tool fills the role from the workspace. Supplying it is not merely
redundant — it is the drift the tool exists to detect, so the column is not
yours to write.

## A sequence read as a flow's edges

> Derive the workspace glossary projection through GlossaryInspection, then
> construct the relationship graph through GraphConstruction.

```
(claim "#6" "step:2" "to" "step:3" "required" "true")
```

Wrong. "Then" states an order, not a consumption. The paragraph does not say
the graph construction uses the glossary projection, so nothing here says step
3 consumes what step 2 produced.

This is the single easiest way to make the whole flow check useless. Every step
in a section reads as leading to the next, every step therefore reaches the end
transitively, and no step is ever a dead end. Read the paragraph that consumes
the results — usually the one describing what is returned — and take the edges
from there.

An edge exists only where the prose names something that uses what a step
produced.

## A guard comparing against something else

```
(guard "#6" "step:2" "mood" "confident")
```

Wrong. A guard's operand is `state`, `input` or `constraint` and nothing else.
Use `state` for a Tag the design declares, `input` for a literal value written
as text, and `constraint` for the Facet that authored the constraint.

## A step you named yourself, or counted across the section

```
(step "#6" "glossary-step")
(step "#7" "4")
```

Wrong. A step is numbered by its position within its own Facet, counting from 1,
and the Facet that states it numbers it. You never keep a count across the whole
Logic section and you never coin an identity for anything; the tool works out
each step's place in the section after reading your answer.

## An edge to the flow itself

```
(claim "#7" "step:1" "to" "graph" "required" "true")
```

Wrong. A claim cannot name `graph`. Write the end of a flow with an `end` row:

```
(end "#7" "1")
```

## A row that is not on the list

```
(go-ahead "#7" "step:7")
(end "#7")
```

**Refuses the unit.** `go-ahead` is not a row. The rows are `claim`, `property`,
`measure`, `reading`, `step`, `end`, `guard` and `undeclared`, and an `end` row
takes the Facet and the step's number.
