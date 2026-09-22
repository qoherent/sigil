# Egglog language (pinned engine)

This repository pins egglog 3.0.0 at revision `90635860397ce710f8c0a4eeb04154a8ebc3ac05`. A Rust host runs egglog; law authors edit `.egg` programs. Installed copies of this skill have no checkout: examples below are in-bundle excerpts named to `kernel.egg`, `design.egg`, `comparison.egg`, and `claims.egg`.

Claims interpreters should read [dialect](dialect.md) first. This file is the law-author reference.

## Execution model

An e-graph holds typed declarations, table rows, an equality relation for unionable e-classes, rules lowered to queries plus actions, and schedules that run rules and rebuild.

Three table kinds matter here:

| Declaration | Meaning in these laws |
| --- | --- |
| `relation` | A set of fact rows. Not unionable. |
| `function` with `:merge` | One output per key; collisions join on a lattice. |
| `constructor` / `datatype` | Equality-sort terms. The four law programs do not declare datatypes. |

The engine is incremental: a rule adds rows or equalities; equality rebuilds; rebuild can make more rules match.

## File syntax

Every top-level form is a parenthesized S-expression. A semicolon starts a comment to end of line. Strings use double quotes.

```lisp
; A comment.
(relation knows (String String))
(knows "alice" "bob")
```

Names are atoms. String data is quoted. The laws use `String`, `i64`, and `f64` columns.

## Sorts

Base sorts used in the laws: `String`, `i64`, `f64`. Integer merge uses `min` / `max`. Comparisons in a rule body match only when true.

## Datatypes and constructors

`(datatype ...)` declares an equality sort and constructors. Terms of that sort can be unioned. These repo laws do not use datatypes; they store RDF-shaped n-ary tables as relations. Prefer `relation` for facts that must not be equality-saturated.

## Relations versus functions

`relation` is a set of tuples. `function` requires `:merge` or `:no-merge`.

From `kernel.egg`:

```lisp
(relation edge (String String String String))
```

```lisp
(function distance (String String) f64 :merge (min old new))
```

From `design.egg`:

```lisp
(function design-filled (String String String String) i64 :merge (max old new))
```

From `claims.egg`:

```lisp
(function reaches-end (String) i64 :merge (max old new))
```

`set` writes a function table. Do not `set` a constructor or a relation.

## Facts and actions

A top-level `(relation-name ...)` inserts a fact immediately. A `rule` only registers; it does not run until a schedule says so.

Rule form used in the laws:

```lisp
(rule (<facts>) (<actions>) :ruleset <name>)
```

From `kernel.egg`:

```lisp
(rule ((edge s p o f)) ((known s p o) (because s p o "asserted" f)) :ruleset closure)
```

`!=` is used as a body guard. String literals such as `"dependsOn"` are predicate names, not typed IRIs.

## Rulesets and schedules

The laws use two phases: `closure` then `diagnostics`. From `kernel.egg`:

```lisp
(ruleset closure)
(ruleset diagnostics)
```

From `comparison.egg`, diagnostics read a lattice after closure has stopped growing:

```lisp
(rule ((= (answered id) 0)) ((unresolved id)) :ruleset diagnostics)
```

The host, not the `.egg` file, runs the schedule. Declaring a rule does not execute it.

## Equality saturation and extraction

Equality-sort constructors participate in saturation and extraction. These laws reason over relation rows and lattice functions instead. Do not add unrestricted `(rewrite ...)` or `(birewrite ...)` to a law program that is built as a two-phase ruleset.

## Turtle boundary

Egglog does not parse Turtle. The compiler lowers RDF-shaped tables in Rust into relations (`kind`, `edge`, `boolean`, `text`, `number` in `kernel.egg`). `claims.egg` states that facts are n-ary claims, not RDF triples; the host re-emits them; the interpreter supplies no rule.

From `claims.egg`:

```lisp
; host from parsed values; the interpreter supplies no rule and fills no table.
```

Do not parse Turtle inside egglog. Do not invent an `(input ...)` loader in a law file.

## Common mistakes these laws hit

### Treating a relation as a datatype

Do not `union` relation rows. Use `relation` for facts.

### Using `set` on a constructor

`set` is for a declared `function`.

### Assuming rules run when declared

They wait for the host schedule.

### Inventing negation from absence

A missing row is not false. `claims.egg` models unreached steps as a lattice, not a "no path" rule:

```lisp
; A lattice, not a negation. Written as "no path exists" the rule cannot fire at
```

`comparison.egg` likewise: no rule satisfies a negative obligation from a missing positive row.

### Forgetting merge

Every `function` in these files names `:merge (min old new)` or `:merge (max old new)`.

### Overusing birewrites

The laws use explicit `(rule ... :ruleset ...)`, not birewrites.

## Authoring

Keep declarations, closure rules, and diagnostic rules in that order. Put findings in diagnostic relations after the lattice has stabilized. Match existing names in the four law files rather than inventing parallel tables.
