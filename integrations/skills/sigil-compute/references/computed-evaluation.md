# Computed evaluation orchestration contract

This is the shared protocol for running the claims loop on one selected Sigil
0.8 design source. The host owns the loop: it runs the tool, captures one
snapshot, delegates one interpretation, and recognizes one completed result.
The tool never launches a model and never reads skills. The interpreter child
only reads the prepared request and returns rows. The host supplies agent
creation, cancellation, and any enforced restrictions; run records belong
outside the design workspace under validation.

Advisory design review is a different job, kept by `sigil-evaluate`. This loop's
only outputs are the ingest state and the findings report.

## The tool surface

```text
sigil export design . > frontend.json
sigil-claims prepare --frontend FILE --source PATH --out NEW_DIR [--root DIR]
sigil-claims ingest --frontend FILE --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR]
sigil-claims extract-guidance --out DIR [--root DIR]
```

Exit codes: `0` is a pass or warning; `1` is a gate failure — a computed
Disjoint verdict, a refused artifact, or a saturation-limit breach; `2` is a
usage error, including a binding that does not match the supplied export; `3`
is an operational failure such as an unreadable input. Exit 1 alone is never a
verdict: a refused artifact exits 1 with an error message and no structured
result, and only the result below plus its matching report decide a state.

Prepare writes into a fresh, initially empty preparation directory — it
refuses one that is not empty — the files `binding.json`, `request.json`, and
the guidance bundle (`sections.md`, `vocabulary.md`, `examples.md`,
`rejected.md`). Its structured result names the binding path, the written
inputs, how many Facets were presented, how many units were reused from stored
interpretations, and the binding digest. The binding carries `format`,
`source`, `exportDigest`, `guidanceFingerprint`, `vocabularyGeneration`,
`closure`, and `facets`: the identity of the request, which ingest recomputes
and compares.

Stored interpretations live under `<root>/.sigil/claims/interpretations`. The
findings report and the judgment context are written under `<root>/.sigil/claims`.

Ingest prints a structured result with `version`, `source`, `state`,
`findings` (a count), `report` (the path it just wrote), `judgmentContext`,
`vocabularyGeneration`, and `guidanceFingerprint`. States serialize lowercase:
`coherent`, `loose`, `disjoint`. The report file carries `version`, `source`,
`identity` (`exportDigest`, `interpretations`, `guidanceFingerprint`,
`vocabularyGeneration`), `state`, `iterations`, `findings`, and optional
`disagreements`. Each finding carries `class` (`contradiction`,
`ownership-conflict`, `unmet-obligation`, `interpretation`, or `flow`), `law`,
`subject`, `object`, `claims`, `component`, `section`, and `detail`.

## Select one exact source

Resolve the selected source before prepare, from the export's `sources` list.

- Honor an explicit source, and honor a design already selected
  unambiguously in the conversation.
- Otherwise use the sole eligible source in the export. If several remain,
  ask which one before prepare — a question to the requester, not a tool run.
- Resolve the requested source to the exact `sources[].path` value; never
  match by an arbitrary basename.
- An explicitly selected source absent from the export is a failure: name it
  and stop. It is not permission to choose another source.

The dependency closure is the tool's. Prepare expands it from the selected
source; the host does not narrow it, reconstruct it, or substitute a
workspace-wide reading for the selected source's coverage.

## Capture one snapshot and a private store

One run uses one immutable input snapshot and a private claims store.

- Accept a supplied valid structural export, or obtain one with the export
  command against the selected workspace. Export must succeed before prepare,
  and ingest receives that same captured file.
- Retain inputs in a unique run directory outside the design workspace, with a
  fresh, initially empty preparation directory inside it.
- Before prepare, copy any existing workspace
  `.sigil/claims/interpretations/` into the corresponding location under a
  private storage root in the run directory. An absent store starts empty.
  Retain the seed as evidence.
- Pass this same private root as `--root` to both prepare and ingest. Memo
  writes that result stay private: never merge them back into the workspace,
  and never write to the workspace's own store.

Results describe the captured export and the seeded store, including when the
workspace changes later. The result handoff carries the snapshot identity so a
reader can tell what the state covers.

## Hand one fresh child the prepared request

Interpretation is one fresh child with no inherited conversation. The child
does not run the tool; it reads the prepared request and returns rows.

| Field | Content |
| --- | --- |
| `task` | Read the prepared interpretation request and return data-only rows. This task overrides ordinary explanatory output. |
| `skills` | Resolved installed entrypoint paths of the required `sigil-understand` and `sigil-egglog` skills. |
| `preparation` | The preparation directory, containing the files below. |
| `request` | Path to `request.json`: the presented Facet rows, whole Logic groupings, admissible entities, and declared roles. |
| `binding` | Path to `binding.json`, the request's identity. |
| `guidance` | Paths of every guidance file prepare wrote. The prepared guidance is binding for row shapes and accepted names. |
| `artifact` | Where the host will read the returned rows. |
| `completion` | The child states it finished. For a request that presents nothing, that statement says the returned artifact is empty on purpose. |

The child loads `sigil-understand` for design meaning and `sigil-egglog` for
the claims dialect; neither replaces the request's binding guidance. Capture
the completed artifact verbatim and pass those exact bytes to ingest. Do not
repair rows, strip prose, or substitute host interpretation. Preserve whole
Logic groupings as presented, and do not reconstruct Facets prepare omitted.

Even a request whose every unit was reused from the store — one that presents
zero rows — goes through one fresh child, which returns an explicitly
completed empty artifact. Missing delegation, a missing required skill, or
interrupted output is a failure, not rows.

## Recognize a completed ingest

A completed ingest is all of:

1. Exit 0 with a structured result whose state is `coherent` or `loose`, or
   exit 1 with a structured result whose state is `disjoint`.
2. The result is this invocation's payload — not a bare exit code, and not a
   file left by an earlier run.
3. The report named by the result matches the captured inputs: `source` is
   the selected source; `state` equals the result's state; the report version
   is the one the result names; `identity.exportDigest` equals the captured
   `binding.json`'s `exportDigest` — the tool's semantic export digest, never
   a hash of raw frontend bytes in its place; `identity.guidanceFingerprint`
   and `identity.vocabularyGeneration` equal the binding's (and the
   result's); and `identity.interpretations` records the digest of the exact
   artifact bytes supplied, in the order supplied. That digest is the tool's
   BLAKE3 over the captured artifact: retain the captured bytes, and when you
   can compute the same digest over them, require the match.
4. The result's `report` and `judgmentContext` paths lie under this run's
   private root. The tool defaults `--root` to the working directory, so a
   dropped or mistyped flag still produces a fully consistent report written
   somewhere else; this check is what catches it.

Anything else — a bare exit code, an old report, a malformed payload, a
mismatch, or an operational failure — supplies no design state. Retain the
matched report under the private root. Identity checks do not identify memo
contents; the private root per run is what keeps invocations separate.

## Stop on the real failure

When any step cannot finish — the tool is missing, export fails, the source
is absent, the artifact is refused, the child is missing or interrupted, the
payload is malformed, or the report does not match — stop. Name what broke and
which step broke it. Emit no Coherent, Loose, or Disjoint. Do not retry the
child and do not rerun the loop; the requester sees the real failure.

## Hand back the result

After a completed ingest, hand back:

- The ingest state, presented as Coherent, Loose, or Disjoint.
- The findings of the matched report, with their class, law, claims,
  component, section, and detail. Flow-class findings are warnings and never
  by themselves make Disjoint.
- The selected source, and the snapshot identity: the captured export digest
  and the seeded store the result describes.

Comparison states — Drift, Converged, Closed — are not this loop's states and
must not appear as one. The state is the selected source's; a source reached
only through the closure is context, not a covered design.

## Boundaries

This loop evaluates an existing Sigil 0.8 design. It does not author, revise,
or delete design files, and a 0.7 contract or a greenfield design is not its
input. `sigil-write` still delegates its review to `sigil-evaluate`; this
skill is not the writer's reviewer. The claims binary does not read skills:
`sigil-understand` and `sigil-egglog` stay host-loaded for the child, as
[design-language authority](../../sigil-understand/SKILL.md) and
[claims-dialect background](../../sigil-egglog/SKILL.md).
