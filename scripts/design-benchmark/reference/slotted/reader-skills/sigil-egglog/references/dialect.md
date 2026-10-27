# Design claims dialect

This note is language background for a design claims interpreter. It does not replace the prepared request's guidance bundle.

## Which side is binding

- The prepared request's guidance is binding for row shapes and accepted names.
- This skill is binding for egglog/datalog language (what a fact, relation, rule, or schedule is).
- `sigil-understand` is binding for the Sigil design being read.

Do not restate column tables here. Copy row shapes from the request's `vocabulary.md`.

## Data only

Return a plain list of S-expression rows and nothing else, one row per line, as egglog text in a plain-text file. A returned artifact is data-only rows with quoted string literals. It is never JSON: an array of row strings or an object holding rows is refused whole.

These kinds exist: `claim`, `property`, `measure`, `reading`, `step`, `end`, `guard`, `undeclared`. Each call's arguments are quoted string literals. Nested expressions and arithmetic are refused whole. A bare number or other literal that is not a quoted string is data in the wrong form: it refuses only the unit it is in.

## Whole-artifact refuse

A `rule`, `command`, `schedule`, or non-literal argument anywhere in the artifact is refused whole, including valid rows beside it. One `rule` declaration is enough.

## Unit refuse

A row that is plain data but wrong costs only its unit: one Facet, or the whole Logic section it belongs to. That covers a name outside the Facet's list, an unknown relation, property or row kind, a wrong column count, and a step reference no Facet declares. The rest of the answer is kept, and the refused unit is asked about again with the reason. So leave a doubtful row in rather than dropping it: a deleted row is a claim lost, and a refused one is only asked again.

Rules are not data. They register inference; they are not claim rows. Do not return `(rule ...)`, `(ruleset ...)`, `(run ...)`, or a schedule.

The tool decides acceptance alone. This skill does not widen what the binary accepts.

## Turtle

Facts are already loaded by the host. Egglog does not parse Turtle. Do not emit Turtle, prefixes, or RDF triples in a claims artifact.
