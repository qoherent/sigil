# One worked Facet per contract role

Facet identities below are written `"f1"`, `"f2"` and so on for readability. In
a real run you copy the identity out of the pre-filled row you were handed.

Entity names are written as they appear in the design. Use the identity the
pre-filled row and the entity list give you, not a name you invent.

## `goal`

> Provide *record search*: find records matching a supplied query.

```
(claim "f1" "SearchService" "provides" "record search" "required" "true")
```

Purpose becomes a capability the component provides. The Facet says what the
component is for, so the commitment is `required`.

## `interface`

> Accept a *query* as search text and return *search results* as matching
> records. A *cached result* may be returned when the query is unchanged.

```
(claim "f2" "SearchService" "provides" "query" "required" "true")
(claim "f2" "SearchService" "provides" "search results" "required" "true")
(claim "f2" "SearchService" "provides" "cached result" "permitted" "true")
```

Three claims from one Facet, because it offers three distinct promises. The
cache is offered, not promised, so it is `permitted`. Note what is *not* here:
nothing says the panel depends on the service. That would be a deduction.

## `state`

> The *active request* is the only one whose results may be published.

```
(claim "f3" "SearchPanel" "owns" "active request" "required" "true")
(property "f3" "active request" "exclusive" "true")
```

An ownership claim plus the property that makes it exclusive. The exclusivity is
a property of the state, so it travels on a `property` row.

## `logic`

> Publishing results requires a *completed search*. A *superseded publication*
> must not occur.

```
(claim "f4" "SearchPanel" "requires" "completed search" "required" "true")
(claim "f4" "SearchPanel" "provides" "superseded publication" "required" "false")
```

The second claim's `expected` is `false`: the Facet asserts the relation must
not hold. That is a prohibition, not an absence.

## `constraints`

> Search must answer within 200 milliseconds. The panel may not reach the
> *record store* directly.

```
(measure "f5" "SearchService" "latencyBudgetMs" "200")
(claim "f5" "SearchPanel" "uses" "record store" "required" "false")
```

A bound becomes a measure. A prohibition becomes a claim whose `expected` is
`false`. Both are `required`, because Constraints binds.

## `decisions`

> We considered a *result cache* in the panel and rejected it, because two
> caches would disagree. We assume the *record store* stays reachable.

```
(claim "f6" "SearchPanel" "owns" "result cache" "permitted" "false")
(claim "f6" "SearchService" "dependsOn" "record store" "assumed" "true")
```

The rejected alternative is recorded, not promoted: it is reported and passed to
the judge, but a Decisions Facet raises no obligation and satisfies none. The
assumption carries modality `assumed`.

If a Decisions Facet is pure rationale with nothing to record — an explanation of
why something was done, naming no entity relationship — return a reading row
instead:

```
(reading "f6" "no-commitment")
```

## `cases`

> Given an empty query, the service provides an *empty result* and reports no
> error.

```
(claim "f7" "SearchService" "provides" "empty result" "permitted" "true")
```

One example, one permitted outcome. An example does not quantify over all
inputs, so this is `permitted` rather than `required`. It does not become a
general promise that every query returns something.

## A Facet whose intent you cannot resolve

> Results are ordered appropriately.

```
(reading "f8" "unresolved")
```

"Appropriately" leaves a consequential choice open and names no relationship.
Do not invent a ranking rule. Say it is unresolved and let the judge ask.
