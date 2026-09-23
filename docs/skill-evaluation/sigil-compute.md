# Computed evaluation observations

Observed on 2026-09-23 against source commit `679880d` (branch `egglog-skill`)
plus this change set's fixture corrections. The five 0.8 skill bundles were
copied into a temporary catalog outside repository source discovery before
fresh native agents exercised the claims loop and its failure paths. These
runs supplement the [offline foundation
observations](sigil-0.8-foundation.md) and use the same honesty rules: a
recorded rerun or failed attempt is evidence about the skill, never a reason
to rerun until green.

`sigil-compute` owns the `sigil-claims` loop: resolve one source, capture one
immutable export, seed a private claims store, prepare, delegate the reading
to one fresh child loaded with `sigil-understand` and `sigil-egglog`, ingest
the returned rows verbatim, verify the matched report's identity, and hand
back the ingest state with findings — or stop and name the break. The
fixture for every case below is
[computed-evaluation-fixture.md](../../integrations/skills/sigil-compute/evals/computed-evaluation-fixture.md).

## Observed cases

| Case | Actual result | Evidence |
| --- | --- | --- |
| Coherent loop (2a) | One export, one prepare into a fresh empty directory, one fresh child returning data-only rows with an explicit completion, one ingest exiting 0 with `coherent` and zero findings. Every report identity field matched the captured binding; the workspace store stayed untouched. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Flow-only Loose (2b) | A first child read both logic steps as reaching the flow's end and produced Coherent — recorded, preserved. A rerun child asserted a step that leads nowhere; ingest exited 0 with `loose` and exactly one flow-class `unreached-step` warning, never Disjoint. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Contradiction Disjoint (2c) | The child asserted `provides` true from the interface facet and false from the constraints facet; ingest exited 1 **with** a structured `disjoint` result and three contradiction findings citing both facets' sections. The exit code alone was never the verdict. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Explicit source and tool-owned closure (3a, 4) | Explicit `consumer.sigil` resolved with no question; the binding's closure names both sources, the child saw the provider as context, and the handback attributed Coherent to `consumer.sigil` alone — no workspace-wide verdict. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Sole source (3b) | A fresh host resolved the sole source `base.sigil` with no question, then — finding the `opencode` CLI delegation route on its own — completed a full fresh-host loop: prepare, one fresh child, ingest, identity verification, Coherent handback. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Memo-reused empty request (5a) | With the private store seeded from an earlier run, prepare reported all units reused and zero Facets presented. Exactly one fresh child returned an explicitly-completed **empty** artifact; ingest exited 0 `coherent`, matching the seeding run's state. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Live edit bound to the snapshot (6) | After a first attempt ingested before the edit (runner error, preserved), the corrected run applied the observer's edit after export and before ingest: one ingest, Coherent, and the report's export digest matches the captured snapshot — a fresh prepare over the edited bytes binds a different digest. The handback described the snapshot, not the edited design. | [Loop records](evidence/sigil-compute/loop-cases.json) |
| Generic review stays advisory (1a, AE1) | A fresh host given a plain "review this design" request followed `sigil-evaluate` and `sigil-understand`, ran read-only mechanical validation, and returned an advisory review with no findings. No claims command ran; no computed state appeared. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Writer keeps its reviewer (1b, AE6) | A fresh host loaded `sigil-write`, revised the design, and produced the writer's documented portable review handoff. No claims command ran; no computed state appeared. The fresh-evaluator arm was blocked by an instructed unavailability (labeled); delegated advisory review is covered by the foundation observations. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Ambiguous source asks first (3c) | A fresh host captured the export, then stopped and asked which of the two sources to check — before any prepare. No state named. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Absent source fails (3d) | A fresh host named the requested-but-absent source as the failure, stopped before prepare, and chose no substitute source. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Missing binary stops (8a, AE5) | With no `sigil-claims` on PATH, a fresh host named the missing binary at the prepare step and stopped. It explicitly declined to substitute the legacy `sigilc` compiler it found. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Missing export stops (8b) | The variant's premise failed on the first attempt: the host found a real `sigil` shim on PATH and completed a full fresh-host live loop instead (retained as the strongest fresh-host evidence). A hermetic re-run with PATH actually restricted stopped at the export step, refusing to scavenge any other run's export — including a byte-identical one. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Missing sibling stops (8c) | Against a catalog without `sigil-egglog`, a fresh host stopped at the delegation step naming the missing required sibling, and did not read or substitute the non-installed copies it found on disk. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Unavailable delegation stops (8d) | With delegation instructed unavailable (labeled as instruction), a fresh host stopped at the interpretation step, named the break, and did not substitute its own interpretation for the child's rows. No state. | [Routing records](evidence/sigil-compute/routing-cases.json) |
| Interrupted child stops (5b) | The child was dispatched and its output channel severed; with no captured artifact the host stopped, named the interrupted interpretation, and did not retry. No ingest, no report, no state. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Refused artifact beside an old report (7, AE4) | Ingest refused a prose artifact (exit 1, no structured result) even with an older report present in the private root; the old report was never presented as this run's. The 2c contrast stands: a valid Disjoint with the same exit code is a state. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Non-conforming child gets no repair (9a–9c) | A prose child, a malformed-rows child, and a truncated artifact each reached ingest verbatim — no repair, no stripped prose, no second attempt — and each was refused with no state. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Input/payload mismatches fail (10a–10c) | A binding/export mismatch exits 2 naming the moved digest; a missing claims file exits 3 with no payload; a foreign report fails the identity check (source and digest). No re-prepare, no inferred verdict, no state. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Post-report operational failure (11) | Real reproduction, not injection: the findings report was written, then the judgment-context write failed against a blocked path. Exit 3, no structured result, no state; the partial report is retained as a diagnostic under the private root. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Separate roots stay isolated (12) | Two runs with byte-identical supplied rows and different memo seeds completed in separate private roots with byte-identical reports and identities — neither run's result can substitute the other's, and a later workspace memo change left both reports unchanged. | [Failure records](evidence/sigil-compute/failure-cases.json) |
| Cross-run integrity (13) | Every `sigil-claims` command was host-invoked, every interpretation artifact came from a fresh child (or was labeled controlled replay), exactly one child per run, and every design source hash is unchanged except the two intended edits (the scenario-6 observer edit and the 1b writer's own revision). | [Failure records](evidence/sigil-compute/failure-cases.json) |

Environment, tool, and model identities, the tested catalog's full file hashes,
and every materialized design byte are serialized in the evidence directory.
The [8b-observed run](evidence/sigil-compute/loop-cases.json) independently
recomputed the artifact's BLAKE3 from the local cargo cache and matched the
report's recorded interpretation digest — the one identity check this host
could not repeat at orchestrator depth.

## Fixture correction found during observation

U1's fixture design inputs were not valid 0.8 sources: the same inline Tag was
defined twice per component (the claims tests build their export JSON
directly, so their prose shapes never passed the CLI parser). Every
`*value*`-style Tag is now defined once and referenced plainly afterward, and
`pipeline.sigil` gained the required nonempty interface section. The
corrected bytes are serialized in the evidence. This is the fixture doing its
job: the defect surfaced on the first live export, before any agent behavior
was in play.

## Package and mechanical verification

- All U2 gates pass with the sixth skill: offline catalog validation
  (five foundation skills), foundation relocation and corruption tests, the
  filtered CLI skill suite, formatting and lint, and the packaged release
  smoke on a relocated distribution.
- The observed runs used `sigil` 0.9.0 and `sigil-claims` 0.2.0, both built
  from this branch; the claims binary was verified current (rebuild finished
  with no recompilation).
- The native claims tests continue to establish the protocol examples the
  fixtures reuse; no compiler or law change was needed or made.

## Limits

These are observed individual runs, not a reliability estimate. The loop cases
ran with the evaluation orchestrator acting as the sigil-compute host; the
fresh-host evidence for the full loop comes from the 3b and 8b-observed runs,
and every interpreter child was fresh. Two runner errors are preserved rather
than hidden: the first case-6 attempt ingested before the observer's edit, and
the 9a/9b children were pointed at preparation directories the runner had not
materialized (both children improvised from the shared evaluation tree, and
both self-reported it). The tested catalog initially retained the fixture
with its observer notes; the first 8d host read them, that attempt is
preserved, the fixture was removed from the tested catalog, and the re-run is
the primary evidence. The shared evaluation tree was readable by agents that
went looking — child provenance is therefore uncertain in a shared tree, and
each input-to-report linkage rests on the tool's digest checks, not on child
isolation. Read-only and no-substitution restrictions were instructions, not
an enforced sandbox; the 8-series hosts honored them, and the 8a host
additionally refused a tempting legacy-compiler substitution. Served model
identity was not independently verified. An unavailable `sigil` CLI could not
be reproduced except by explicit PATH restriction, because a working shim
exists on this machine's interactive PATH.
