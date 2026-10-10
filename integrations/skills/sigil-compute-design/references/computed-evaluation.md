# Computed evaluation orchestration contract

This is the shared protocol for running the claims loop on one selected Sigil
0.9 design source. The host owns the loop: it runs the tool, keeps one
preparation, delegates one interpretation, and recognizes one completed result.
The tool never launches a model and never reads skills. The interpreter child
only reads the prepared request and returns rows. The host supplies agent
creation, cancellation, and any enforced restrictions; run records belong
outside the design workspace under validation.

Advisory design review is a different job, kept by `sigil-evaluate`. This loop's
only outputs are the ingest state and the findings report.

## The tool surface

```text
sigilc prepare --source PATH --out NEW_DIR [--root DIR] [--store DIR]
sigilc ingest --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR] [--store DIR]
sigilc check [--source PATH] [--root DIR] [--store DIR]
sigilc extract-guidance --out DIR [--root DIR]
```

`--root DIR` is the workspace, read directly (default `.`). `--store DIR`
holds stored readings and reports (default `<root>/.sigil`). There is no
export step.

Exit codes: `0` is a pass or warning; `1` is a gate failure — a computed
Disjoint verdict, an `incomplete` result, a wholly refused artifact, or a
saturation-limit breach; `2` is a
usage error, including a binding that no longer matches the workspace; `3`
is an operational failure such as an unreadable input. Exit 1 alone is never a
verdict: a wholly refused artifact exits 1 with an error message and no
structured result, and only the result below plus its matching report decide a
state.

`check` reads the root and the store directly, with no preparation or binding.
It links every valid stored reading of the workspace into one program and runs
every claims law over it, without launching a model. `--source PATH` only
filters the findings to those that source authored; the `unread` and
`unresolvedImports` lists stay workspace-wide.

Prepare writes into a fresh, initially empty preparation directory — it
refuses one that is not empty — the files `binding.json`, `request.json`, and
the guidance bundle (`sections.md`, `vocabulary.md`, `examples.md`,
`rejected.md`). Its structured result names the binding path, the written
inputs, and counts: `facets` presented, `requestedUnits` to read,
`reusedUnits` taken from stored interpretations, `regroundedUnits` kept after a
change that did not alter them, and `uninterpretedContext` rows shown for
reference. It also names `bindingDigest` and `workspaceDigest` (the hash of
every resolved tree id). The binding carries `format`, `source`,
`sourceContent`, `interfaces` (each imported component's interface hash),
`guidanceFingerprint`, `vocabularyGeneration`, and `facets`: the identity of
the request, which ingest recomputes and compares. A mismatch names the field
that moved.

Check prints a structured result with `version`, `scope`, `state`,
`findings`, `unreadUnits`, `unresolvedImports`, `report`, `judgmentContext`,
`workspaceDigest`, `vocabularyGeneration`, and `guidanceFingerprint`. Its state
adds `incomplete`: some unit has no valid reading, or an import does not
resolve. The report (version 6) lists `unread` units by source, component,
section, and Facet ids, and `unresolvedImports`. It is written to
`<store>/claims/workspace.linked.json`, or `<store>/claims/<source>.linked.json`
with `--source`, with a matching `.linked.context.json`; ingest's files are
never overwritten. `incomplete` and `disjoint` exit 1; `loose` and `coherent`
exit 0.

Stored interpretations live under `<store>/claims/interpretations`. The
findings report and the judgment context are written under `<store>/claims`.

Ingest prints a structured result with `version`, `source`, `state`,
`findings` (a count), `report` (the path it just wrote), `judgmentContext`,
`vocabularyGeneration`, `guidanceFingerprint`, `storedUnits`, `unreadUnits`,
`refusalCount`, `refusals` and `comparisonErrors`. States serialize lowercase:
`coherent`, `loose`, `disjoint`, `incomplete`. The report file carries `version`,
`source`, `identity` (`bindingDigest`, `interpretations`, `guidanceFingerprint`,
`vocabularyGeneration`), `state`, `iterations`, `findings`, optional
`disagreements`, and an `unread` list when ingest left units unread. Each
finding carries `class` (`contradiction`, `ownership-conflict`,
`unmet-obligation`, `interpretation`, `flow`, or `gap`), `law`, `subject`,
`object`, `claims`, `component`, `section`, and `detail`.

An artifact that holds anything other than data is refused whole: exit 1, an
error message and no structured result. A row that is data but wrong refuses
only its unit, one Facet or one Logic section. The other units are stored, and
the result lists each refusal in `refusals` (at most 200, with the full count in
`refusalCount`) with the unit's `section`, its Facet ids and its `handles`, the
offending `row` and the `reason`. A refused unit, and any unit the answer left
unread, is in `unreadUnits`; while any exists the state is `incomplete` and
ingest exits 1 with this result, unless a contradiction or ownership conflict
makes it `disjoint`, which outranks unread units; the unread list is still
there and still starts a re-ask. A refusal with no unit is a row about a Facet
the request did not ask about; it costs no unit. `comparisonErrors` are mistakes
in a second reading of a stored unit, which cost only the comparison and never
start a re-ask.

## Select one exact source

Resolve the selected source before prepare, from the workspace's sources:
`sigilc tree --root .` lists each as `parse.path`.

- Honor an explicit source, and honor a design already selected
  unambiguously in the conversation.
- Otherwise use the sole eligible source in the workspace. If several remain,
  ask which one before prepare — a question to the requester, not a tool run.
- Resolve the requested source to the exact workspace-relative path; never
  match by an arbitrary basename.
- An explicitly selected source absent from the workspace is a failure: name it
  and stop. It is not permission to choose another source.

Dependencies are the tool's. Prepare shows the selected source's imports as
interface context only (rows marked `context`); the host does not widen or
narrow them, reconstruct them, or substitute a workspace-wide reading for the
selected source's coverage. The one-source loop's ingest sees a flow that
crosses components only when the dependency's interface states it. The linked
`check` also sees the dependency's stored private readings, which the child
never reads; the full-design action below is the loop that runs it.

## Keep one preparation and a private store

One run uses one preparation and a private claims store.

- Retain inputs in a unique run directory outside the design workspace, with a
  fresh, initially empty preparation directory inside it.
- Before prepare, copy any existing workspace
  `.sigil/claims/interpretations/` into `claims/interpretations/` under a
  private store directory: the one the request names when it names one,
  otherwise one in the run directory. An absent store starts empty. Retain the
  seed as evidence, and keep it to compare against at write-back.
- Pass the workspace as `--root` and this same private directory as `--store`
  to both prepare and ingest. Never prepare or ingest against the workspace's
  own store: readings reach it only through the write-back below, in either
  action.
- Retain prepare's structured result: its `bindingDigest` and `workspaceDigest`
  identify what the result covers.

Ingest recomputes the request from the live workspace. If the selected source
or an imported interface changed after prepare, ingest refuses the binding and
names the field that moved; the host stops rather than re-preparing. Edits to
other files do not matter. The result handoff carries the binding digest so a
reader can tell what the state covers.

## The full-design action

The full-design action reads every source that still has unread units, then
links the whole workspace. It is an alternative to the one-source loop and
follows the same rules for the private store, the child handoff, and
recognizing a completed ingest, per source. `sigilc` still launches no
model; the host orchestrates every reader.

1. Seed the private store from the workspace's
   `.sigil/claims/interpretations/`, as above.
2. Run `check` with the workspace as `--root` and the private store as
   `--store`. Its `unread` list is the work queue: group it by source. A
   check that already reports a state with nothing unread and no unresolved
   import needs no reader.
3. For each source in the queue, run prepare into a fresh empty preparation
   directory. Launch one fresh child only when prepare reports
   `requestedUnits` greater than zero; otherwise skip the child and the
   ingest for that source. Then ingest the artifact the child wrote in the
   private store, and re-ask what ingest left unread as the next section
   describes. A source whose reader, prepare, or ingest fails is recorded as
   failed, and the remaining sources still run.
4. Run `check` again over the same private store. Hand back its state and
   report. When it is `incomplete`, name every failed source and the unread
   units the report lists, and the unresolved imports if any.

A source whose stored reading a dependency's changed interface refused is
unread in step 2, so the run re-reads it once. The next run finds it valid and
launches no reader for it. With no edits since the last full run, the queue is
empty, no reader launches, and the check hands back the same report.

## Write back what the run read

Both actions end by copying readings from the private store into the workspace
store, so the next run asks only about what changed. The one-source loop does
it after its last ingest completes, re-asks included; the full-design action
does it after its final check. For each file under the private store's
`claims/interpretations/`, copy it into the workspace's
`.sigil/claims/interpretations/` when:

- the workspace store lacks it; or
- its bytes differ from the seed taken at the start of the run, and the
  workspace copy still matches that seed.

A re-read unit keeps its old memo key, so copying only absent files would leave
the stale entry in place. Write each copy to a temporary file in the same
directory and rename it into place. A workspace entry that changed since
seeding is left alone. Reports and judgment context are not copied. A run
that stops on a failure writes nothing back. An `incomplete` result is not a
failure: the units it stored are written back, and the unread ones are asked
for again next time.

## Re-ask what ingest left unread

Both the one-source loop and the full-design action re-ask, per source, for at
most two rounds after the first answer. Count by the answer file: a source's
answers are `-answer-1`, `-answer-2` and `-answer-3`, and the rounds end once
`-answer-3` is ingested or nothing is left unread. A round starts only when ingest's result
lists `unreadUnits` (whatever its state) or the whole artifact was refused. In
ingest's result `unreadUnits` is the list of units; in `check`'s result it is a
count, and the list is the report's `unread`. A
result whose only refusals belong to no unit does not start a round; report them
in the hand-back.

1. Run prepare again into a new, empty preparation directory. It presents only
   the units still unread, so the request is smaller each round, and a Logic
   section asked alone is shown with its component's Constraints Facets as
   context rows, so a guard can name one.
2. Launch a fresh child with the previous round's `reasons`: for each refusal,
   its unit, the `handles` and the `reason`, so the child can match them to the
   new presentation. After a whole refusal there are no per-unit refusals;
   the reason is ingest's error message, passed verbatim. Handles are the same in every round while the binding holds.
3. Ingest the artifact that child wrote.

A whole refusal counts as a round and re-asks the whole source. If ingest or
prepare reports that the binding no longer matches, the workspace changed under
the run: stop that source and report the failure rather than re-asking. After
the second re-ask, units still unread are handed back as Incomplete, each named
with its last reason; when the last answer was refused whole there is no
structured result to match, so no state is named and the refusal is. Each round
is a fresh child. Never write, edit or repair rows yourself: every reading
comes from a fresh child, and only the child writes the answer file.

## Hand one fresh child the prepared request

Interpretation is one fresh child with no inherited conversation. The child
does not run the tool; it reads the prepared request and returns rows.

| Field | Content |
| --- | --- |
| `task` | Read the prepared interpretation request and return data-only rows. This task overrides ordinary explanatory output. |
| `skills` | Resolved installed entrypoint paths of the required `sigil-understand` and `sigil-egglog` skills. |
| `preparation` | The preparation directory, containing the files below. |
| `request` | Path to `request.json`: the presented Facet rows, each with its `handle` and the `names` it may use (rows marked `context` are shown for reference and take no reading: a dependency's interface, or a Constraints Facet of the section being asked again), whole Logic groupings, admissible entities, the components each source imports from, and declared roles. |
| `binding` | Path to `binding.json`, the request's identity. |
| `guidance` | Paths of every guidance file prepare wrote. The prepared guidance is binding for row shapes and accepted names. |
| `artifact` | The file the child writes its rows to, and the only file it writes: a plain-text egglog file named `<source>-answer-<round>.egg`. Its content is the claim rows exactly as the prepared guidance shows them, one row per line, and nothing else — never JSON, never an array of strings, never a markdown fence. The child writes each row from reading the prose and may fix a row it re-reads however it edits the file, but never drops rows in bulk; a row it doubts stays in, so ingest refuses only that unit and the next round asks again. The host passes that exact file to ingest and never edits it, and never sets an answer aside on its own judgment: ingest decides what is accepted. |
| `reasons` | On a re-ask, the previous round's refusals: unit, handles and reason. Absent on the first answer. |
| `completion` | The child states it finished. For a request that presents nothing, that statement says the returned artifact is empty on purpose. |

The child loads `sigil-understand` for design meaning and `sigil-egglog` for
the claims dialect; neither replaces the request's binding guidance. The child
returns rows for its own Facets only and nothing for a row marked `context`. Pass
the exact bytes of the file the child wrote to ingest. Do not repair rows, strip
prose, or substitute host interpretation. Preserve whole
Logic groupings as presented, and do not reconstruct Facets prepare omitted.

Even a request whose every unit was reused from the store — one that presents
zero rows — goes through one fresh child, which returns an explicitly
completed empty artifact. Missing delegation, a missing required skill, or
interrupted output is a failure, not rows.

## Recognize a completed ingest

A completed ingest is all of:

1. Exit 0 with a structured result whose state is `coherent` or `loose`, or
   exit 1 with a structured result whose state is `disjoint` or `incomplete`.
   An `incomplete` ingest is a completed answer with units still unread: it
   starts the re-ask above, and is handed back only after the rounds are spent.
2. The result is this invocation's payload — not a bare exit code, and not a
   file left by an earlier run.
3. The report named by the result matches the preparation: `source` is
   the selected source; `state` equals the result's state; the report version
   is the one the result names; `identity.bindingDigest` equals the
   `bindingDigest` prepare returned — the tool's binding digest, never a hash
   of raw file bytes in its place; `identity.guidanceFingerprint`
   and `identity.vocabularyGeneration` equal the binding's (and the
   result's); and `identity.interpretations` records the digest of the exact
   artifact bytes supplied to that ingest, in the order supplied. That digest is
   the tool's
   BLAKE3 over the captured artifact: retain the captured bytes, and when you
   can compute the same digest over them, require the match.
4. The result's `report` and `judgmentContext` paths lie under this run's
   private store. The tool defaults `--store` to `<root>/.sigil`, so a
   dropped or mistyped flag still produces a fully consistent report written
   somewhere else; this check is what catches it.

For a linked `check`, the same rules apply with the check's result: the
report's `source` equals the result's `scope` and its `state` equals the
result's, `linked.workspaceDigest` equals the result's `workspaceDigest`, its
`identity` carries the `guidanceFingerprint` and `vocabularyGeneration` the
result names, and both paths lie under the private store.

Anything else — a bare exit code, an old report, a malformed payload, a
mismatch, or an operational failure — supplies no design state. Retain the
matched report under the private store. Identity checks do not identify memo
contents; the private store per run is what keeps invocations separate.

## Stop on the real failure

When any step cannot finish — the tool is missing, the source
is absent, the artifact is refused, the child is missing or interrupted, the
payload is malformed, or the report does not match — stop. Name what broke and
which step broke it. Emit no Coherent, Loose, or Disjoint. Apart from the
bounded re-ask of what ingest left unread, do not retry the child and do not
rerun the loop; the requester sees the real failure. In the full-design action,
one source's failure is recorded and does not stop the other sources; the final
check still runs and names the failed source.

## Hand back the result

After a completed ingest, hand back:

- The ingest state, presented as Coherent, Loose, Disjoint, or Incomplete; for
  Incomplete, each unread unit with its last refusal reason. For the
  full-design action, the check's state, which may also be Incomplete, with
  its `unread` units, `unresolvedImports`, and any failed source named. An
  incomplete check is not a pass.
- The findings of the matched report, with their class, law, claims,
  component, section, and detail. Flow-class findings are warnings and never
  by themselves make Disjoint.
- The selected source, and the preparation identity: the binding digest, the
  workspace digest, and the seeded store the result describes.

Comparison states — Drift, Converged, Closed — are not this loop's states and
must not appear as one. The state is the selected source's; a source reached
only as an import is context, not a covered design.

## Boundaries

This loop evaluates an existing Sigil 0.9 design. It does not author, revise,
or delete design files, and a 0.7 contract or a greenfield design is not its
input. `sigil-write` still delegates its review to `sigil-evaluate`; this
skill is not the writer's reviewer. The claims binary does not read skills:
`sigil-understand` and `sigil-egglog` stay host-loaded for the child, as
[design-language authority](../../sigil-understand/SKILL.md) and
[claims-dialect background](../../sigil-egglog/SKILL.md).
