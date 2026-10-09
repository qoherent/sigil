# One worked Facet per contract role

Facets below are written by handle, `"#1"`, `"#2"` and so on. In a real run you
copy the handle out of the pre-filled row you were handed. The full `facet` id
works wherever a handle does.

Entity names are written as they appear in the design. Use a name from the
Facet's own `names` list, never one you invent.

## `goal`

> Provide *record search*: find records matching a supplied query.

```
(claim "#1" "SearchService" "provides" "record search" "required" "true")
```

Purpose becomes a capability the component provides. The Facet says what the
component is for, so the commitment is `required`.

## `interface`

> Accept a *query* as search text and return *search results* as matching
> records. A *cached result* may be returned when the query is unchanged.

```
(claim "#2" "SearchService" "provides" "query" "required" "true")
(claim "#2" "SearchService" "provides" "search results" "required" "true")
(claim "#2" "SearchService" "provides" "cached result" "permitted" "true")
```

Three claims from one Facet, because it offers three distinct promises. The
cache is offered, not promised, so it is `permitted`. Note what is *not* here:
nothing says the panel depends on the service. That would be a deduction.

## `state`

> The *active request* is the only one whose results may be published.

```
(claim "#3" "SearchPanel" "owns" "active request" "required" "true")
(property "#3" "active request" "exclusive" "true")
```

An ownership claim plus the property that makes it exclusive. The exclusivity is
a property of the state, so it travels on a `property` row.

> The *draft lock* is held by one editor, and the panel is the only one that may
> set or clear it.

```
(claim "#10" "SearchPanel" "owns" "draft lock" "required" "true")
(property "#10" "draft lock" "exclusive" "true")
```

"Only one that may set or clear it" is the same exclusivity as "the only one
whose results may be published". Without the `property` row, two components
that both claim to own the state do not conflict and the overlap goes
unreported. Write the `property` row whenever a Facet says it alone may change
the state.

## A Tag the component already has

> The panel keeps each cached result on screen until the query changes.

```
(claim "#9" "SearchPanel" "uses" "cached result" "required" "true")
```

`cached result` is written bare because the interface Facet above already
introduced it. A Tag that exists is named exactly, with no asterisks, and the
claim is grounded. Asterisks would define it a second time.

## `logic`

> Publishing results requires a *completed search*. A *superseded publication*
> must not occur.

```
(claim "#4" "SearchPanel" "requires" "completed search" "required" "true")
(claim "#4" "SearchPanel" "provides" "superseded publication" "required" "false")
```

The second claim's `expected` is `false`: the Facet asserts the relation must
not hold. That is a prohibition, not an absence.

### `logic` that describes a flow

Logic prose that walks through a sequence of steps is returned as a graph
instead. The Facets of one Logic section are presented together. Number each
Facet's steps from 1 within that Facet, name a step of another Facet as
`step:#<handle>.<number>`, and end the flow with an `end` row.

> **#5** — Consume the loaded *WorkspaceModel* through *RelationshipResolution*
> to obtain relationship data and diagnostics.
>
> **#6** — Derive the workspace glossary projection through
> *GlossaryInspection*, then construct the relationship graph through
> *GraphConstruction*.
>
> **#7** — Return one *ResolvedSigilWorkspace* containing resolution data,
> graph data, glossary data, and merged diagnostics.

```
(step "#5" "1")
(step "#6" "1")
(step "#6" "2")
(step "#7" "1")
(claim "#5" "step:1" "reads" "WorkspaceModel" "required" "true")
(claim "#5" "step:1" "invokes" "RelationshipResolution" "required" "true")
(claim "#6" "step:1" "invokes" "GlossaryInspection" "required" "true")
(claim "#6" "step:2" "invokes" "GraphConstruction" "required" "true")
(claim "#7" "step:1" "invokes" "ResolvedSigilWorkspace" "required" "true")
(claim "#5" "step:1" "to" "step:#7.1" "required" "true")
(claim "#6" "step:1" "to" "step:#7.1" "required" "true")
(claim "#6" "step:2" "to" "step:#7.1" "required" "true")
(end "#7" "1")
```

Read the edges carefully, because they are what the check rests on.

**#6 sequences its two steps with "then", and that is not an edge.** The
paragraph says construct the graph *after* deriving the glossary. It does not
say the graph construction uses the glossary projection. So there is no edge
from step 2 to step 3 — and it would be wrong to add one, because it would make
step 2 reach the end through step 3 no matter what actually consumes the
glossary.

The edges that do exist come from **#7**, which names what the result contains:
resolution data, graph data and glossary data. Each of those is something a
step produced and this step consumes, so each is an edge.

**#7's step ends the flow**, because the prose says it returns the result, and
the `end` row is what says so. It is written because the prose declares the end.
Nothing is inferred from what a step merely does.

## `constraints`

> Search must answer within 200 milliseconds. The panel may not reach the
> *record store* directly.

```
(measure "#5" "SearchService" "latencyBudgetMs" "200")
(claim "#5" "SearchPanel" "uses" "record store" "required" "false")
```

A bound becomes a measure. A prohibition becomes a claim whose `expected` is
`false`. Both are `required`, because Constraints binds.

## `decisions`

> We considered a *result cache* in the panel and rejected it, because two
> caches would disagree. We assume the *record store* stays reachable.

```
(claim "#6" "SearchPanel" "owns" "result cache" "permitted" "false")
(claim "#6" "SearchService" "dependsOn" "record store" "assumed" "true")
```

The rejected alternative is recorded, not promoted: it is reported and passed to
the judge, but a Decisions Facet raises no obligation and satisfies none. The
assumption carries modality `assumed`.

If a Decisions Facet is pure rationale with nothing to record — an explanation of
why something was done, naming no entity relationship — return a reading row
instead:

```
(reading "#6" "no-commitment")
```

### A flow whose checks can refuse

> Checking a query takes two steps. Step one reads the *query length* and
> rejects an empty query. Step two returns the *search results*.

```
(step "#11" "1")
(step "#11" "2")
(claim "#11" "step:1" "reads" "query length" "required" "true")
(claim "#11" "step:2" "writes" "search results" "required" "true")
(claim "#11" "step:1" "to" "step:2" "required" "true")
(end "#11" "1")
(end "#11" "2")
```

Step one has an edge to step two when the query passes, and an `end` when it
rejects. The rejection is that branch's end. Without the `end`, a reader of the
rows sees a check that feeds nothing and ends nowhere.

### A step that never ends

> Answering a query takes two steps. Step one reads the *query*, and step two
> returns the *search results*. Refreshing the *result digest* takes one more
> step: step three compares the result digest with the one kept from the last
> refresh.

```
(step "#13" "1")
(step "#13" "2")
(step "#13" "3")
(claim "#13" "step:1" "reads" "query" "required" "true")
(claim "#13" "step:2" "writes" "search results" "required" "true")
(claim "#13" "step:3" "reads" "result digest" "required" "true")
(claim "#13" "step:1" "to" "step:2" "required" "true")
(end "#13" "2")
```

Step two returns, so it ends the flow. Step three is the last step of its
sentence, but the prose never says it returns or finishes, and nothing uses what
it compares. It gets no edge. The tool reports it as an unreached step. That is
a real gap in the design, and an `end` would hide it.

### A constraint the flow satisfies

> **#14** — A search must stay within the *query length* limit before it reaches
> the *record store*.
>
> **#15** — Searching takes two steps. Step one reads the query length and
> rejects an over-long query. Step two reads the record store and returns the
> search results.

```
(claim "#14" "SearchService" "requires" "query length" "required" "true")
(step "#15" "1")
(step "#15" "2")
(claim "#15" "step:1" "reads" "query length" "required" "true")
(claim "#15" "step:2" "reads" "record store" "required" "true")
(claim "#15" "step:2" "writes" "search results" "required" "true")
(guard "#15" "step:1" "constraint" "#14")
(claim "#15" "step:1" "to" "step:2" "required" "true")
(end "#15" "1")
(end "#15" "2")
```

#14 is a constraint the flow touches, because step one reads the query length.
The `guard` row ties step one to #14 by naming #14's Facet. The value is the
Facet that authored the constraint, not a claim. Without the guard row, the tool
reports the flow as not checking a requirement it touches.

### A rule about what is refused

> **#16** — The service must not accept a search from a *blocked user*.

```
(reading "#16" "no-commitment")
```

This sentence says what the service refuses. The step that checks for a blocked
user is where the refusal happens. A claim that the service excludes the blocked
user would be reported against that very step, because the step touches the
blocked user. Return a reading, or write the positive requirement the flow meets.
Do not write an exclusion for a rule about what is refused.

### A module named in passing

> **#17** — The panel may depend on the Archive module and the Billing module, and
> no others.

```
(reading "#17" "no-commitment")
```

Archive and Billing appear in the entity list because they expose interfaces the
workspace knows. Suppose the panel's source has no entry for either in `imports`, so neither is
on this Facet's `names`. A claim naming them would refuse the unit, so this Facet
returns a reading. If the
source's `imports` did list Archive under `from`, Archive would be on the Facet's
`names`, and the Facet could return a claim.

### A thing the design never declares

> **#19** — Every booking change runs inside a database transaction.

```
(undeclared "#19" "database transaction")
```

The prose relies on a *database transaction*, and no Tag in the design declares
one. Inventing a name for it would refuse the unit. The `undeclared` row says
what the prose relies on, in the prose's own words, and the tool reports it as a
warning about the design. The Facet counts as read. If the Facet states other
things that are on its list, return those claims as well.

### A scoped exception

> The panel provides the *history view* of a closed search, with no *search
> results* in it.

```
(claim "#12" "SearchPanel" "provides" "history view" "required" "true")
```

One claim. The phrase "with no search results in it" holds only inside the
history view. Writing `SearchPanel provides search results` as `false` would
say the panel never provides results, and would contradict every Facet that
promises them.

## `cases`

> Given an empty query, the service provides an *empty result* and reports no
> error.

```
(claim "#7" "SearchService" "provides" "empty result" "permitted" "true")
```

One example, one permitted outcome. An example does not quantify over all
inputs, so this is `permitted` rather than `required`. It does not become a
general promise that every query returns something.

## A Facet whose intent you cannot resolve

> Results are ordered appropriately.

```
(reading "#8" "unresolved")
```

"Appropriately" leaves a consequential choice open and names no relationship.
Do not invent a ranking rule. Say it is unresolved and let the judge ask.
