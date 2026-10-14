# Claims-guided review: what we measured

On 2026-10-12 we tested whether Sigil's design reviewer gets cheaper, and stays
as good, when it starts from the design's computed claims instead of reading
every source file. It did not get cheaper on a real design. It did catch more
on a small one. This report explains the test, the results, and what we changed
in the skills because of them.

## Short answer

- **Cost: higher, not lower.** On the Slotted design, every review that
  started from computed claims read more tokens (360k to 1.02M) than every
  review that read the sources (218k to 308k).
- **Quality on Slotted: steadier, and complete after the last guidance fix.**
  Slotted has four planted problems. The first four claims-based reviews found
  three each; the source-only reviews found three, three and one. The fifth
  claims-based review, with `sigil-evaluate` 0.2.3, found all four.
- **Quality on a small Booking design: better.** The claims-based review
  noticed that "current user" should be the existing `signed-in user` Tag, and
  read a promise the claims had missed. The source-only review did neither.
- **Reusing earlier readings works.** A second run with no edits started no
  new reading at all.
- **Why the unused digest step was missed, and the fix.** A judge that had to
  list every warning it set aside dismissed all five "step reaches no end"
  warnings as one group, misreading them as missing links between steps. After
  the guidance explained the warning and asked for each to be judged on its
  own, the next judge reported the digest steps.
- **The writer needed three rounds of fixes.** Its runs deleted a policy
  conflict it should have left to a person, ignored untagged words the check
  flagged, and once cleared a warning by deleting the word. The fourth run, with
  `sigil-write` 0.2.3, did none of these. It was also the cheapest writer run.

## Terms used here

- **Computed claims.** `sigilc` asks a fresh model to read each part of a design
  (each *unit*, usually one paragraph) and write down its promises as data
  rows. `sigilc` then runs fixed rules over those rows and reports
  contradictions, ownership conflicts, unmet requirements, and warnings.
- **Review view.** A short text file `sigilc check` now writes, listing every
  unit, claim and finding under a short label such as `U3` or `F2`. It has no
  prose. A companion file maps each label to the exact bytes in the source.
- **Judge.** The model that reviews the design and reports problems
  (`sigil-evaluate`).
- **Writer.** The model that edits a design and asks a fresh judge to review
  each draft (`sigil-write`).
- **Preparation.** The step that runs the readers and the check, so a judge has
  current computed claims (`sigil-compute-design`).
- **Undeclared name.** A word a promise relies on that no Tag names. The check
  reports it as a warning.

## How the test worked

Every run used `codex-cli 0.161.0` with model `gpt-6-luna` at high reasoning
effort, for the main agent and every helper it started. `sigilc` was built once
and did not change during the test. We compared two versions of the skills:

- **Source-only (before):** the judge reads the design's source files.
- **Claims-based (after):** the judge reads the review view and opens only the
  prose it needs.

There were two designs:

- **Slotted**, a room-booking app with seven source files and about 190 units.
  Four problems were planted in it on purpose.
- **A small Booking design** with two files, written to test specific cases: a
  policy conflict nobody has decided, a word that should reuse an existing Tag,
  a promise stated twice, and a promise the claims might miss.

Each judge was a fresh agent with the same instructions and the same copy of
the design. Preparation for the claims-based judges ran separately, so its cost
is reported on its own.

## Results

### 1. What a review cost on Slotted

| Run | Version | Tokens read | Model turns | Time |
| --- | --- | ---: | ---: | ---: |
| J1-baseline | source-only | 254,948 | 8 | 143 s |
| J2-baseline | source-only | 308,234 | 10 | 80 s |
| J3-baseline | source-only | 218,448 | 7 | 59 s |
| J1-proposed | claims-based, first guidance | 587,599 | 12 | 154 s |
| J1r2-proposed | claims-based, second guidance | 360,303 | 11 | 95 s |
| J1r3-proposed | claims-based, third guidance | 1,018,025 | 17 | 331 s |
| J1r4-proposed | claims-based, lists set-aside warnings | 515,299 | 15 | 952 s |
| J1r5-proposed | claims-based, judges each dead-end step | 534,439 | 13 | 282 s |

"Tokens read" adds up everything the judge read on every turn, including text
it had already read. Most of it was served from the model's cache.

Why the claims-based judges cost more:

1. Each turn re-reads everything read so far, so cost grows with the number of
   turns. The claims-based judges took more turns: they checked the view's
   hashes and looked up passages.
2. On Slotted the review view (39 KB) is about the size of all seven sources
   (37 KB), so reading it saves almost nothing.
3. All judges also read Sigil's language reference, which is the largest thing
   in their context either way.

The view does save a lot against the full computed context file (670 KB), but
the source-only judge never reads that file, so it is not the right baseline.

We changed the judge's guidance twice to cut reads. The second change made it
cheaper (360k); the third made it more expensive (1.02M). We stopped there,
because every claims-based run already cost more than every source-only run.
That is one run per guidance version, not three matched pairs.

### 2. What the reviews found on Slotted

| Planted problem | J1-b | J2-b | J3-b | J1-p | J1r2-p | J1r3-p | J1r4-p | J1r5-p |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Booking and Rooms both claim to own the archived-room mark | yes | yes | no | yes | yes | yes | yes | yes |
| Booking both offers and forbids changing a pending request's range | yes | yes | yes | yes | yes | yes | yes | yes |
| Calendar needs a renter display name nobody provides | yes | yes | no | yes | yes | yes | yes | yes |
| A Calendar step computes a digest that nothing uses | no | no | no | no | no | no | no | yes |

(b = source-only, p = claims-based.)

- Until J1r5, no judge found the unused digest step, even though the review
  view lists it as a warning. A line asking the judge to read such a step
  before dismissing it did not help. See "Why the digest step was missed"
  below.
- The judges disagreed on who decides the range question. Four called it a
  decision for a person. J3-baseline and J1r2-proposed instead proposed
  deleting the offer, citing Booking's own text that the requested range stays
  as recorded.
- Two claims-based judges (J1r2, J1r3) said the ownership conflict should be
  fixed by keeping the mark in Rooms, which matches the planted answer. The
  source-only judges left it as a decision for a person.

#### Why the digest step was missed

The earlier reports listed only the problems each judge kept, and codex logged
no reasoning, so we could not see why the warning was dropped. `sigil-evaluate`
0.2.2 asks the judge to list every computed warning it does not report, with a
reason. J1r4 ran with that rule on the same evidence as J1r3.

J1r4 read the Calendar paragraph that holds the digest steps, then set aside
all five "step reaches no end" warnings (`F40`–`F44`) as one group:

> the prose explicitly describes the numbered steps in sequence. The computed
> flow graph's missing edges alone do not establish missing behavior.

That reason misreads the warning. The warning does not say the steps are
unlinked. It says the last step's result goes nowhere: no later step uses it
and no end returns it. "Step two compares the owner digest with the digest
kept from the previous refresh" says nothing about what happens next.

Grouping made it easy to miss. Of the five warnings, two are the planted
Calendar steps. Two point at Booking, where an earlier analysis found the
warning to be a misreading (`analyze-demo/slotted-runs/DIAGNOSIS.md` §6), and
one points at SharedKernel. Treated as one group, the real two were dismissed
with the false three.

The same report also set aside 57 of the 59 undeclared-name warnings in broad
groups. One group's reason was that the untagged form "did not establish an
additional material defect". `sigil-evaluate` 0.2.1 rules out that reason for
names. The judge followed the new name rule once, proposing a `role` Tag in
Identity.

J1r4 took 952 s, much longer than J1r3, but read about half as many tokens. We
did not look into the time.

**The fix** (`sigil-evaluate` 0.2.3):
- The guidance now says what the warning means: the step's result goes
  nowhere, because no later step uses it and no end returns or stores it.
- The judge reads each such step on its own. If the prose says what uses,
  returns or stores the result, the warning is a misreading. If not, it is a
  design gap, whatever the intent says.
- A name can be set aside for only two reasons: it means an existing Tag
  (named), or it is context wording.

**J1r5**, with that fix, on the same evidence:
- It reported both digest steps (`F40`, `F43`) as decisions for a person:
  "State what uses or stores the read items, or remove the step if it has no
  effect."
- It set aside the other three such warnings, citing the prose that ends each
  flow: Booking's steps "commit", and SharedKernel checks the grid first. It
  put the two Booking warnings in one entry, although the guidance asks for one
  entry each.
- It proposed Tags for 19 names that are objects of promises, such as `date
  range`, `party size` and `overlap`. It set aside the other 40 as context
  wording, Decisions wording or an existing Tag. A few reasons mix "existing
  Tag" and "context" without naming the Tag.
- It read about the same number of tokens as J1r4 (534k), so it still costs
  more than a source-only review.

### 3. The small Booking design

| Case | Source-only (F-baseline) | Claims-based (F-proposed) |
| --- | --- | --- |
| Tokens read | 255,899 | 223,083 |
| Range change offered and forbidden | left to a person | left to a person |
| "current user" should be the `signed-in user` Tag | missed | caught, as a correction |
| Two sentences state the same overlap rule | merge them, keep the cancellation promise | same |
| A promise the claims missed | not applicable | read the prose and noted it |

The readers missed two promises when they prepared this design: the overlap rule
and the cancellation promise produced no claims. So the "missed promise" case
happened for real, and the claims-based judge handled it by reading the prose.

### 4. Reusing readings

| Run | What it did | Readers started | Tokens read (main / readers) | Time |
| --- | --- | ---: | ---: | ---: |
| A1-cold | Prepare Slotted from nothing | 11 | 3,078,285 / 4,467,183 | 711 s |
| A2-unchanged | Prepare Slotted again, no edits | 0 | 272,854 / 0 | 51 s |
| F1-prep-cold | Prepare the small design from nothing | 2 | 556,789 / 390,817 | 217 s |
| U2-16b-selected | Prepare only `booking.sigil` | 1 | 624,321 / 196,357 | 170 s |
| U2-16e-oldcompiler | Prepare with a `sigilc` that writes no view | 0 | 204,261 / 0 | 46 s |

- A1 read all seven sources, with 11 readers in all because three sources
  needed a second or third try, and saved 182 readings. A2 found nothing new to read and started no reader.
- U2-16b read only the selected file and left the other file unread, saying so.
- U2-16e used a stand-in that hides the review view. The agent reported the
  view as unavailable and did not try to build one.
- No run changed a design file.

We did not run a preparation after editing Slotted, so re-reading only the
edited parts is covered by `sigilc`'s own tests, not by an agent run.

### 5. The writer

Both runs asked the writer to revise the small Booking design. The intent says
whether a renter may change a pending range "is not decided yet."

**First run (G-writer)**, four helpers, 591 s:

- It reused `signed-in user` and merged the duplicate overlap rule.
- **It deleted both sides of the undecided conflict** and added a new promise
  ("The signed-in user can create a booking for a room.") that nothing
  supports. Its summary still said the policy was left undecided. The next
  judge found nothing wrong, because the conflict was gone.
  [Before and after](evidence/claims-guided-review/G-writer-booking.diff).
- **It ignored two undeclared names.** The check flagged `range` (the object of
  the cancellation promise) and `room` (the object of the goal and interface).
  Both judges called them ordinary wording and recommended nothing, so the
  writer did nothing. That was wrong: a word that is the subject or object of a
  promise should get a Tag, so the check can compare promises about it. One
  judge even raised a question that only exists because `room` has no Tag:
  does "never overlaps" apply across all rooms or within one room?

**Fix for the deleted conflict** (`sigil-write` 0.2.1): the writer may remove a
promise only when the intent authorizes it, keeps two contradicting promises
for a person to decide, adds no unsupported promise, and lists every promise it
removed or added.

**Second run (G2-writer)**, with that fix, seven helpers, 1,412 s:

- **It kept both sides of the conflict** and returned the question to the
  person. Two fresh judges agreed no intent decides it, and the check reported
  the contradiction.
  [Before and after](evidence/claims-guided-review/G2-writer-booking.diff).
- It added two Tags, `pending booking range` and `range reservation`. The first
  is what let the check see the contradiction. The second may be more than the
  design needs.

**Fix for the ignored names** (`sigil-evaluate` 0.2.1, `sigil-write` 0.2.2):
the guidance had sent undeclared names through the rule for missing detail,
which asks whether the prose is ambiguous. Now a name that is a promise's
subject or object gets a Tag even when the prose reads clearly, and the writer
applies this to the check's warnings itself, before any judge sees the draft.

**Third run (G3-writer)**, with both fixes, 12 helpers, 2,117 s. The host read
10.9M tokens and the helpers 4.1M, against 6.8M and 2.1M for G2.
[Before and after](evidence/claims-guided-review/G3-writer-booking.diff).

- **`range` got a Tag.** The writer acted on the check's warning before any
  judge saw the draft, saying `range` is the object of the cancellation
  promise.
- **`room` did not get a Tag.** The check flagged "booking of a room". The
  writer changed "hold a booking of a room" to "hold a booking", so the object
  became the existing `booking` Tag, and the goal became "Support room
  *booking*". The warning went away because the word went away. The intent
  says Booking "lets signed-in users hold rooms". Whether `booking` already
  covers the room is a judgment call this run does not settle.
- **It deleted the conflict again, then restored it.** Its first three drafts
  replaced both range-change sentences with a Decisions note saying the choice
  is undecided. The judge of the first draft accepted that, saying the draft
  "correctly preserves the stated open policy". Only near the end did the
  writer apply its own rule, restore both sentences word for word, and send
  the draft for another review. The final judge reported the conflict as a
  decision for a person.
- **Restoring word for word brought back "current user".** The restored
  sentence still says "current user", although the line above it now uses the
  imported `signed-in user`. G2 had made that replacement. Neither the check
  nor the final judge flagged it.
- **The final check could not see the conflict.** The reader recorded no
  promise for "Booking never changes the range of a pending booking", so no
  contradiction was computed. The judge found the conflict in the prose.
- Twice the writer rejected a judge's report and asked for a new one: once
  for wrong paths in the evidence echo, once for a missing read-only note.
  That accounts for part of the extra cost.

**Fix** (`sigil-write` 0.2.3, `sigil-evaluate` 0.2.3):
- The writer never clears a name warning by deleting the word.
- It never replaces a conflict with a Decisions note, because Decisions commit
  nothing.
- Kept conflict sentences still get Tag corrections.
- The judge never counts a Decisions note as keeping an undecided policy.

**Fourth run (G4-writer)**, two helpers, 343 s. The host read 2.0M tokens and
the helpers 0.76M, the cheapest writer run so far.
[Before and after](evidence/claims-guided-review/G4-writer-booking.diff).

- **Both sides of the conflict stayed** from start to finish, and the one
  judge returned the question to the person.
- **"current user" became `signed-in user`** in the kept sentence.
- **`range` got a Tag, `booking range`,** shared by the range-change and
  cancellation promises. The duplicate overlap rule was merged.
- **"room" stays untagged, and the word stays.** This time the reader produced
  no warning for it, so neither the writer nor the judge acted on it. The
  writer acts on names only when the check flags them.
- The reader again recorded no prohibition for "Booking never changes the
  booking range", so the check could not compute the conflict. The judge
  found it in the prose.
- One run is not proof. G3 shows the earlier failures can come back in a
  long run.

## What changed in the skills because of these runs

| Commit | Change |
| --- | --- |
| `e980db4` | Judge reads less, and reads a step that reaches no end before dismissing it. |
| `91861bc` | Judge reads the view instead of whole sources and fetches prose in one batch. |
| `491f3c2` | Writer keeps undecided conflicts for a person (`sigil-write` 0.2.1). |
| `ac9482e` | Review contract allows preparation to write its cache files. |
| `11ed05d` | Undeclared names follow the Tag rule; writer acts on them itself. |
| `25849fb` | Judge lists every computed warning it does not report, with a reason (`sigil-evaluate` 0.2.2). |
| `649c758` | Judge reads each dead-end step singly and limits reasons for dropping names; writer never deletes a flagged word or replaces a conflict with a note (both 0.2.3). |

## Not tested

- A judge started directly by a person, so that it runs preparation itself.
- The writer noticing that its review went stale after a file changed.
- The writer with no `sigilc` installed.
- Preparation after an edit to Slotted.

## Raw material

Per-run token counts, models, helper counts and the skill version each run used
are in [runs.json](evidence/claims-guided-review/runs.json). Each agent's own
final output is in [reports](evidence/claims-guided-review/reports/), in the
mixed formats the agents produced. The full host logs stay in the local, ignored
`analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/`.
