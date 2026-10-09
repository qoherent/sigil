# Prose the claims check can read

`sigil-claims` checks a design in three stages:

1. A model reads each Facet and returns short data rows, such as
   "Booking requires recurring booking series".
2. The tool keeps a row only if every name in it is something that Facet can
   talk about.
3. Fixed rules look for contradictions, ownership conflicts, missing providers,
   and broken flows in the rows that were kept.

The rules only see the rows. A promise the model cannot turn into a clean row
is never checked. Write each Facet so the right row is the obvious reading.
These rules keep the prose short. They ask for exact words, not more words.

## Ground operational Facets with Tags

State, Logic, Constraints, Cases, and Interface Facets should reference or
define at least one Tag in their own prose. Goal and Decisions Facets may remain
Tag-free without receiving `SIGIL_UNTAGGED_FACET`; embedded Facets still follow
the role of the section that contains them.

What counts:

- A bare reference to a local or imported Tag, spelled exactly.
- An inline definition such as `*recurring booking series*`.

What does not count:

- A group heading. The Facets under it record the group, but the claims
  check does not treat the heading as a name in the Facet.
- A Tag name that appears only in a fenced payload or inside a link.
- A mention of a Component only.

Why: a row may name only the Facet's own Component, a Component the source
imports from, or a Tag that appears in that Facet's prose. A Facet with no
Tag can only produce rows about whole Components. Those rows are too coarse to
find the real problem, or the tool rejects them as ungrounded.

`sigil check` and the editor report an operational Facet without such evidence
as a `SIGIL_UNTAGGED_FACET` warning. Treat that warning as a failure in the
authored scope; do not invent Tags solely to silence it in Goal or Decisions.

If a Facet has no concept worth a Tag, it is usually not a separate promise.
Merge it into the Facet it supports, or cut it.

## Pick Tags from subjects and objects

The best Tag candidates are the subject and the object of each promise. The
claims check reads a promise as a row: subject, relation, object. The two ends
of that row are the things it can link across Facets, so they should be Tags.

In "Booking requires the recurring booking series":

- `Booking` is the subject. It is a Component, so it needs no Tag.
- "requires" is the relation. Keep it a plain verb, never a Tag.
- `recurring booking series` is the object. It should be a Tag.

So:

1. Find the subject and object of the sentence before choosing Tags.
2. Give each Facet at least one Tag on a meaningful subject or object that is
   not its owning Component. Reuse or import an existing identity first, as the
   next section says.
3. Keep verbs, adjectives, clauses, and complete claims in the prose. A
   compound noun phrase is a good Tag when it names the subject or object;
   "exclusively" and "must not" stay in the prose as relation or modality.
4. Do not repeat a group label by default. Choose the noun phrase that names
   what the Facet is about or what it acts on. If the sentence names no concept
   as a subject or object, rewrite it so one is. "It is saved for later" names
   nothing. "Wishlist keeps each saved product" names the object.

### One Tag names one concept

Keep each Tag a short noun phrase for one subject or object. Do not tag a whole
claim, a verb phrase, or a sentence. Leave the action, condition, and modality
in ordinary prose.

Split coordinated names when they refer to independently meaningful objects:
use `*line* and *column*`, not `*line and column*`; use `*identity* and
*access*`, not `*identity and access*`. Keep an established compound name when
it names one concept whose parts are not independently meant in that Facet.
When one Facet concerns several concepts, it can reference or define several
Tags.

## Reuse a Tag before you define one

Aim for few Tags used by many Facets. Every time two Facets name the same Tag,
the claims check can compare their promises. A new name cuts that link, even
when it means the same thing. So a new Tag is the last choice, not the first.

### Take a Tag inventory before drafting

List the Tags that already exist before you write any prose:

```sh
sigilc tree --root . | jq -r '.trees[].resolution.components[].tags[]
  | select(.status == "resolved") | .iri
  | capture("^urn:sigil:component:(?<file>.*):(?<component>[^:]+):tag:(?<tag>.*)$")
  | "\(.file)  \(.component)  \(.tag | gsub("%20"; " "))"' | sort -u
```

Each line shows the file, the owning Component, and the exact Tag name. If the
command is unavailable, read the workspace `.sigil` files. Collect each
`*inline definition*`, each group heading, and each `import { ... }` list.
Keep the inventory next to you while drafting.

Identify named interactions before drafting, even when the current Tag
inventory names only their actors or inputs. If an interaction has its own
promises or another Component refers to it, define a short noun-form Tag in
the provider's Interface and import it in consumers. For example, `user`
names an actor; it cannot stand in for the `search submission` interaction.
Keep the action verb in prose rather than defining a verb-form Tag such as
`submit`.

### Pick each Tag in this order

For each concept a Facet needs, stop at the first step that works:

1. **Reuse a local Tag this Component owns.** If this Component already owns
   the concept, write its exact name as a bare reference. A local Tag that
   names another Component's concept is not reuse. It is a synonym; see below.
2. **Import it from its owner.** If another Component owns the concept, first
   confirm that the owner's Interface exposes the Tag, then add
   `@path.sigil from Owner import { Tag }` to the consumer's file and write the
   name as a bare reference. Import from the Component that defines the Tag.
   Sigil has no re-exports, so a Component that only imports it cannot pass it
   on.
3. **Define it in the owner.** If no Tag names the concept yet, define it once,
   in the Component that owns the concept. If that is another Component in your
   authored scope, define it there and import it into the consumer.
4. **Define it locally.** Only when this Component itself owns the concept.

Reuse applies to every role. A Goal, Decisions, or Cases Facet can meet the
Facet rule by naming an imported Tag. It does not need a new local one.

### Rules that decide what works

- **Import only what you reference.** Every imported Tag needs at least one
  bare reference in the importing file, or `sigil check` reports
  `SIGIL_UNUSED_TAG_IMPORT`.
- **Never group under an imported Tag.** A group heading always introduces a
  local Tag, so a heading with an imported name collides. Reference the
  imported Tag in the prose instead.
- **Put Components that share a Tag in separate files.** An import applies to
  every Component in its file, including the Tag's owner, which then collides
  with its own Tag.
- **Keep the owner's names when revising.** Do not rename a Tag that other
  files reference or import. If a rename is needed, change every reference and
  import in the same revision. This never protects a synonym.

### Replace synonyms in the files you edit

When a file you edit has a local Tag that names a concept another Component
already owns, replace it with an import from that owner. Do this even when the
request did not mention it.

This is a supported correction, not a scope change. The owner already defines
the concept, so no ownership moves. Only the duplicate name goes away. Keeping
it leaves two names the claims check cannot link.

1. Compare the two texts. Replace when they clearly describe the same thing:
   a calendar view's local `reservation` that "Booking confirms" is Booking's
   own `booking`.
2. Import the owner's Tag, rewrite every reference to use its exact name, and
   remove the local definition.
3. List each replacement in the report.

Only when the two texts could mean different things, keep the local Tag and
record the question.

### Do not

- Define a synonym of an existing Tag. The rules cannot link the two names, so
  a promise about one never meets a promise about the other.
- Define a local Tag with the same name as an imported one. That is a
  `SIGIL_TAG_NAME_COLLISION` error.
- Define the same inline Tag twice in one Component. Reference it instead.
- Copy a provider's concept into the consumer as a new local Tag. Import it.

A new Tag that only one Facet uses is often a synonym in disguise. Check the
inventory again before keeping it.

If a concept seems to belong to a Component outside your authored scope, and
that Component does not define it, the owner is a design question. Record it as
an open question. Do not define the Tag in the consumer just to clear the
warning.

## Name the exact thing

1. **Name the Tag, not the Component, when the promise is about the concept.**
   Say "Booking requires the recurring booking series", not "Booking relies on
   Scheduling and Recurrence". In the Slotted run, prose that was vague here
   produced a contradiction about the wrong object.
2. **Use one spelling for one thing.** When two Facets talk about the same
   concept, both must use the same Tag. A synonym is a different name and the
   rules will not connect them.
3. **Never give a Tag the same name as a Component.** The tool refuses a name
   that matches two things. `UserProfile` as both a Component and a Tag
   stopped the whole Auth check.

## Say the relation plainly

The rules act on a small set of relations. Use the plain verb that matches the
promise, so the model does not have to guess.

| If you mean | Write | What the check can then do |
| --- | --- | --- |
| This Component keeps the data | "X owns T" | Find two owners of an exclusive Tag. |
| Only one Component may own it | "X exclusively owns T" | Needed for the ownership conflict check. |
| This Component offers it | "X provides T" | Satisfy someone's requirement. |
| This Component needs it | "X requires T" | Report it if nothing provides T. |
| This Component calls another | "X depends on Y" | Connect a requirement to Y's provision. |
| This is forbidden | "X must not ... T" | Find a contradiction with a positive promise. |

- **`owns` and `provides` are different.** Do not use one for the other.
- **An import is not a dependency.** If X really uses Y, say "X depends on Y".
  An import only makes Y's Tags nameable.
- **Put a requirement's provider one step away.** The check looks for T in the
  Component itself, or in a Component it directly depends on. If the provider
  is further away, say "X depends on Y" for that provider too.
- **Match modality words to intent.** "Must" is a requirement. "May" is a
  permission and creates no obligation. "Assumes" records something the design
  relies on but does not promise.

## Put each promise in the right role

- **Decisions do not commit.** A promise written only in Decisions is never
  checked. State the rule in Constraints or Interface, and keep only the reason
  in Decisions.
- **A Case is one example.** It does not become a general rule. If a behavior
  must always hold, state it in Interface, Logic, or Constraints.
- **A negative rule belongs in Constraints.** Use the same Tag the positive
  promise uses, so the two can be compared.

## Write Logic as a flow with clear ends

The check turns Logic into numbered steps and edges between them.

1. **One step per sentence, in order.** Start each step with its action.
2. **Say what each step reads and writes,** using Tags.
3. **Say who uses each step's result.** "then" states an order, not a use.
   Write "step three sends the expanded dates to ...", or "the flow returns the
   series".
4. **Say where the flow ends.** Every branch ends by returning a result or by
   stopping. An ending is never assumed.
5. **Name the constraint a step must respect.** If a Constraint requires T and
   a step touches T, the step should say it checks that constraint.

An output that no step or interface uses is a design gap. Fix it in the design
itself: return the result from the Interface, use it in a later step, or remove
it. The claims check does not detect this gap on its own.

## Before capture

Check the authored scope against this list:

- Every Facet names at least one Tag in its own prose.
- Every Facet has at least one Tag on a meaningful subject or object in
  its prose; the grouping heading alone does not count.
- Tags name concepts, not verbs, adjectives, clauses, or complete claims.
- A Tag inventory was taken before drafting.
- Named interactions with their own promises or references from another
  Component have noun-form Tags in their provider's Interface, imported by
  consumers; an actor Tag does not stand in for an interaction.
- Every new Tag is owned by the Component that defines it, and no Tag in the
  inventory already names that concept.
- Every Tag another Component owns is imported from that owner, not redefined.
- No local Tag in an edited file is a synonym of a Tag another Component owns.
- Repeated concepts reuse one Tag identity across Components, including when
  Logic Facets read or update concepts introduced in State.
- Every import is referenced at least once, and no group heading uses an
  imported name.
- No Tag shares a name with a Component.
- The same concept uses the same Tag everywhere.
- Every requirement has a provider one dependency away, or an open question
  about who provides it.
- Every Logic step's result has a stated user or a stated end.

Report the result with the draft: which Tags were reused, which were imported
and from where, and each new Tag with the reason no existing Tag fit.

Fix a failure by editing the prose. Do not add Facets or Tags only to satisfy
the list. If the fix needs a policy the user has not decided, record it as an
open question.
