# Claims dialect

This note is language background for a claims interpreter. It does not replace the prepared request's guidance bundle.

## Which side is binding

- The prepared request's guidance is binding for row shapes and accepted names.
- This skill is binding for egglog/datalog language (what a fact, relation, rule, or schedule is).
- `sigil-understand` is binding for the Sigil design being read.

Do not restated column tables here. Copy row shapes from the request's `vocabulary.md`.

## Data only

Return a plain list of S-expression rows and nothing else. A returned artifact is data-only rows with quoted string literals.

These kinds exist: `claim`, `property`, `measure`, `reading`, `step`, `guard`. Each call's arguments are quoted string literals. Nested expressions, arithmetic, and numbers that are not quoted strings are refused.

## Whole-artifact refuse

A `rule`, `command`, `schedule`, or non-literal argument anywhere in the artifact is refused whole, including valid rows beside it. One `rule` declaration is enough.

Rules are not data. They register inference; they are not claim rows. Do not return `(rule ...)`, `(ruleset ...)`, `(run ...)`, or a schedule.

The tool decides acceptance alone. This skill does not widen what the binary accepts.

## Turtle

Facts are already loaded by the host. Egglog does not parse Turtle. Do not emit Turtle, prefixes, or RDF triples in a claims artifact.
