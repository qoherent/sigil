# Rows that are refused, and why

Each of these is rejected by the tool. They are here so you can recognize the
shape before you return it, not so you can repair one afterwards.

## A claim pointing at itself

```
(claim "f1" "SearchService" "provides" "SearchService" "required" "true")
```

**Refused as degenerate.** Subject and object are the same entity, so the claim
says nothing that could be satisfied, contradicted, or checked. It does not
count as an interpretation of its Facet — a Facet that yields only this is
treated as uninterpreted.

This usually happens when a Goal Facet names only the component and you reach
for the component again as the object. The object should be the capability the
component provides, which is a Tag or another component, not the subject
repeated.

## A claim you deduced rather than read

> Facet: "SearchPanel displays search results."

```
(claim "f2" "SearchPanel" "dependsOn" "SearchService" "required" "true")
```

**Refused in substance, even though it validates.** The Facet says the panel
displays results. It does not say the panel depends on the service — you
inferred that from knowing where results come from. The laws derive dependency
and delegation themselves; asserting the deduction adds a fact nobody authored
and the tool can no longer tell it from one that was.

Return what the Facet said:

```
(claim "f2" "SearchPanel" "provides" "search results" "required" "true")
```

This is the failure mode the tool cannot mechanically catch, which is why it is
stated here. A claim relating two entities that both appear, in a relationship
the Facet does not state, passes every check the tool can run.

## A claim naming an entity that does not exist

```
(claim "f3" "SearchPanel" "uses" "RetryPolicy" "required" "true")
```

**Refused as ungrounded** when `RetryPolicy` appears nowhere in the Facet's
resolved references, is not the Facet's owning component, and is not a provider
component reachable through the source's imports. **Refused outright** when it
names an entity outside the design's resolved import closure.

Two narrower versions of the same mistake:

- **Declaring an identity.** A row that declares a Component or a Tag is
  refused; the frontend reserves those identities and the tool mints every
  claim identity itself.
- **Naming a Tag you can see but the Facet cannot.** A Tag owned by another
  component, in a source this one does not import, is out of closure even
  though it exists in the workspace.

## A rule beside valid data

```
(claim "f4" "SearchService" "provides" "query" "required" "true")
(rule ((provides a b)) ((reachable a b)))
```

**The whole artifact is refused**, not just the rule. The valid claim above it
is discarded with it. Laws are compiled into the tool; an artifact that supplies
one is not a partially usable interpretation, it is the wrong kind of document.
The same applies to any command, schedule, or non-literal argument.

## A row with the wrong shape

```
(claim "f5" "SearchService" "provides" "query" "required")
(claim "f6" "SearchService" "offers" "query" "required" "true")
(claim "f7" "SearchService" "provides" "query" "mandatory" "true")
```

**Refused with the offending row named.** The first is missing its `expected`
column. The second uses a relation name that is not in the published list —
`offers` is not a relation, `provides` is. The third uses a modality that does
not exist; the three are `required`, `permitted`, and `assumed`.

## A row carrying a section

```
(claim "f8" "goal" "SearchService" "provides" "query" "required" "true")
```

**Refused on arity.** A claim has six columns and none of them is the contract
role. The tool fills the role from the export. Supplying it is not merely
redundant — it is the drift the tool exists to detect, so the column is not
yours to write.

## A sequence read as a flow's edges

> Derive the workspace glossary projection through GlossaryInspection, then
> construct the relationship graph through GraphConstruction.

```
(claim "f6" "step:2" "to" "step:3" "required" "true")
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
(guard "f6" "2" "mood" "confident")
```

Wrong. A guard's operand is `state`, `input` or `constraint` and nothing else.
Use `state` for a Tag the design declares, `input` for a literal value written
as text, and `constraint` for the Facet that authored the constraint.

## A step you named yourself

```
(step "f6" "glossary-step")
```

Wrong. A step is named by its ordinal — its position across the Logic section,
counting from 1. You never coin an identity for anything; the tool mints every
one after reading your answer, which is why an ordinal is the only reference
you can write.
