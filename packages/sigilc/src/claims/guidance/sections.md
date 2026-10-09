# Contract roles, and what to assert from each

Every Facet you read belongs to exactly one of seven contract roles. You are not
told the role in the row you complete, and you must not restate it: the tool
fills that column from the workspace, which is the only thing that knows it.
What the role changes is *what kind of claim the Facet can support*.

| Role | Read it as |
| --- | --- |
| `goal` | Purpose, responsibility, and intended outcomes. |
| `interface` | Offered interactions and observable promises. |
| `state` | Meaningful data, modes, and conditions. |
| `logic` | Behavior, flows, guards, and transitions. |
| `constraints` | Binding invariants, prohibitions, bounds, and architecture choices. |
| `decisions` | Rationale, assumptions, alternatives, trade-offs, and revisit conditions. |
| `cases` | Starting situations, actions, and expected observations in examples or families. |

These readings are the language's own, not this tool's. `goal` and `interface`
are required of every component; the other five are optional and may be empty.

## Assert only what the Facet authored

This is the rule the whole pipeline rests on. Three kinds of statement are easy
to confuse, and only the first is yours to assert.

**An authored commitment** is something the Facet says. Assert it. If the Facet
says a component provides a capability, return that claim.

**A supported deduction** is something that follows from what the Facet says.
Do not assert it. The laws derive consequences themselves — reachability through
dependencies, capability through delegation, a contradiction between two
commitments. Asserting a deduction as though it were authored inflates the
design with facts nobody wrote, and the tool cannot tell them apart afterwards.

**Unresolved intent** is a consequential choice the Facet leaves open, or
material you cannot see. Do not guess it and do not assert it as fact. Return a
`reading` row with outcome `unresolved`.

A Facet you read and drew no commitment from is not a failure, and it is not
silence either. Return a `reading` row with outcome `no-commitment`. That is how
the tool tells a Facet you considered from one you never looked at — a Facet
that yields nothing at all is reported as a gap in the interpretation, and
rationale-only prose in a `decisions` Facet is a normal, correct `no-commitment`.

## Modality

Every claim carries one of three modalities, and getting it wrong changes what
the tool computes.

- `required` — the Facet states this must hold. Only a required claim raises an
  obligation that something else has to satisfy.
- `permitted` — the Facet allows it without demanding it. Raises no obligation.
- `assumed` — the Facet depends on it without promising it. Raises an
  assumption obligation rather than a capability one.

"Must return a result" is `required`. "May return a cached result" is
`permitted`. "Assumes the store is reachable" is `assumed`.

## Naming what a claim is about

Every Facet row in the request carries a `names` list: the only things a claim,
property, measure or guard from that Facet may name. It is its own component, the
components its source imports from, and the Tags its own prose introduces or
names. Write a name exactly as it appears in the list. A plural or differently
cased form is not the name.

The tool built that list from what it already resolved about the Facet, and it
checks every row against it. A row naming anything else refuses the unit and you
are asked about it again. That includes a Tag that appears only in a different
Facet's prose, a Tag owned by a source this one does not import, and a Tag the
design declares that this Facet's prose does not name. Being declared somewhere
does not put a name on a Facet's list. If a Facet's prose does not name a Tag,
do not invent a claim about it. Return a `reading` row instead.

Two cases need a way to say what the prose says without a name for it:

- The prose relies on a thing the design never declares, such as a library, a
  mechanism, or a notion with no Tag: return `(undeclared "<facet>" "<name>")`
  with the name as the prose writes it. It is reported as a warning about the
  design and counts as reading the Facet.
- The prose names another component only in passing, such as in a list of
  allowed dependencies, and that component is not on the Facet's list: return a
  `reading` for that part.

The third way a Tag reaches the prose is how it is written. A Tag the Facet
introduces is marked with asterisks: `*a name like this*`. A Tag that already
exists, whether the component defines it elsewhere or imports it, is written
bare, with no asterisks. An asterisk defines a new Tag. Never put asterisks
around a Tag that already exists. Doing so declares a second definition and the
design fails its check.

The request's `entities` list is wider than any Facet's `names`: it holds
everything the source can see, so the tool can read it back. Do not take a name
from it that the Facet's own list lacks.

**Imported interface Facets are context.** A row marked `"context": true` is an
interface Facet of a component this source imports. It is there so you can read
what the names it exposes mean. Return nothing for it: its own source's run
reads it. A dependency's other roles are not presented at all, and nothing they
introduce is on the entity list. A Constraints Facet of your own source can also
be marked `"context": true` when only its Logic section is asked again: it is
shown so a guard can name it, and it is answered by nothing.

**Who does the requiring.** For `requires`, `provides`, `owns`, `dependsOn` and
`excludes`, the subject is a component (or a step, for a flow). Never a Tag: the
tool refuses the unit and asks again. A Tag cannot
provide anything, so `booking request requires open time` can never be
satisfied and reports an obligation that nothing could meet. When a Facet says
a *booking request* must lie inside open time, the requirement belongs to the
component that handles it: `Booking requires open time`.

**Sole ownership is two rows.** When a Facet says a component owns some state
and that it alone may change it, in words such as "the only one that may set or
clear it", "only its workflows change it" or "no other component may write it",
return both rows:

```
(claim "<facet>" "<component>" "owns" "<state>" "required" "true")
(property "<facet>" "<state>" "exclusive" "true")
```

The `owns` claim alone says nothing about anyone else, so a second owner
elsewhere in the design is never reported. This holds in every role. A
`constraints` Facet that says who alone may change a piece of state is a
commitment, never a `no-commitment`. Before you hand the answer over, read
every `owns` claim you wrote against its Facet once more and add the `property`
row wherever the prose says "only".

**A scoped exception is not a global ban.** When a Facet says something is
absent only in one case, such as "the view of a closed search, with no search
results in it", assert the positive part and stop. Do not write the exception
as `expected` `false` about the whole component. The claim format cannot say
"only here", so a global `false` contradicts every Facet that promises the
thing in general. Write the positive claim and leave the exception unclaimed.

**A rule about what is refused is not an exclusion.** "Must not accept a request
from X" says what a flow refuses. The step that checks X is where the refusal
happens, so a claim that the component excludes X is reported against that step.
Return a `reading` for such a rule, or the positive requirement the flow meets.

**`excludes` means never, not "not when".** Write `excludes` only when the
component never does or uses the thing at all. A rule that limits when or how,
such as "must not change while a request is pending", "windows must not
overlap" or "must never cancel a confirmed booking", is not an exclusion: every
step that touches the thing would be reported against it. Return a `reading`
for such a rule, or the positive requirement it states.

## Hand over what you read

Write every row from reading its Facet's prose. You may check your rows against
the `names` lists, and fix a wrong row by reading its Facet again and rewriting
that row, with whatever editing you like. What you must never do is drop rows
in bulk, such as filtering out every row a check flags. A row you cannot fix
stays in: the tool refuses only its unit and asks about it again. A deleted row
is a claim lost for good. Never write `no-commitment` for a Facet because its
rows were removed: `no-commitment` means you read the Facet and it commits to
nothing.

## What the role does to a claim

A `decisions` Facet's claims are retained and reported, and are passed to the
judge, but they raise no obligation and satisfy none. Rationale does not convert
a rejected alternative or an unaccepted proposal into a commitment. Return the
claims anyway — being able to see what a Decisions Facet argued is the point —
but do not promote a considered option into a promise.

A `cases` Facet describes examples. An example does not silently quantify over
all inputs; required and permitted outcomes differ. Prefer `permitted` unless
the Facet states the case as a general rule.
