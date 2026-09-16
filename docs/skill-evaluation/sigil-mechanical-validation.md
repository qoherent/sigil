# Mechanical validation observations

Observed on 2026-09-16 against source commit `3e8208d`. The repository skill
catalog was copied into a temporary installation before fresh native agents
exercised the writer and evaluator. These runs supplement the
[offline foundation observations](sigil-0.8-foundation.md).

The root and CLI Sigil contracts were updated first. Workspace checking and
formatting passed, then a fresh independent evaluator completed the captured
contract review with no findings. Implementation began after the host verified
the report's input identities and freshness. The
[contract receipt](evidence/sigil-mechanical-validation/contract-review.json)
retains that gate.

## Observed cases

| Case | Actual result | Evidence |
| --- | --- | --- |
| Writer repairs long prose | Check reported a width error; explicit file formatting repaired it; recheck passed before capture. Multiword Tags, import, link, and literal fenced payload survived. Only the authorized panel changed. Fresh independent review completed with no findings. | [Writer records](evidence/sigil-mechanical-validation/writer-records.json) |
| Canonical contradiction | Check and `fmt --check` both exited 0. The evaluator still identified cancelled-request publication contradicting the active-request commitment. Source and config hashes stayed unchanged. | [Inputs](evidence/sigil-mechanical-validation/contradiction-inputs.json), [report](evidence/sigil-mechanical-validation/contradiction-report.yaml) |
| Formatting and unrelated annotation diagnostic | Check exited 1 with width and implementation-annotation diagnostics; `fmt --check` exited 1 for noncanonical source. The evaluator reported completed mechanical findings separately from its sufficient design assessment and changed no source, config, or implementation bytes. | [Inputs](evidence/sigil-mechanical-validation/formatting-inputs.json), [report](evidence/sigil-mechanical-validation/formatting-report.json) |
| No CLI on permitted PATH | Writer and independent evaluator found no `sigil` under the controlled `/usr/bin:/bin` PATH. Design review completed with no findings; both reported mechanical validation unavailable. The compact draft stayed unchanged. | [No-CLI records](evidence/sigil-mechanical-validation/no-cli-records.json) |
| Legacy tool identity | A controlled version-output stub advertised CLI 0.8/core 0.7 alongside workspace language 0.8. The evaluator rejected compatibility, continued design review, and explicitly reported unavailable mechanics. Sources stayed unchanged. | [Inputs and stub](evidence/sigil-mechanical-validation/legacy-inputs.json), [report](evidence/sigil-mechanical-validation/legacy-report.yaml) |
| Capture/live mismatch | Provider and configuration bytes were deliberately changed after capture. The evaluator detected the mismatch, withheld mechanical coverage for the capture, and assessed captured meaning. It separately identified a retention/policy design choice. No live or captured source changed during review. | [Mismatch records](evidence/sigil-mechanical-validation/mismatch-records.json) |

The first writer review had a wrong captured intent path despite returning no
findings. The writer rejected that report. Agent capacity then prevented its
fresh retry; the host obtained an actual fresh independent report for the same
unchanged request, verified all identities, and returned it to the writer. The
writer validated and accepted it. Both reports and the failed validation remain
in the evidence; the host did not synthesize a replacement review.

## Mechanical verification

- CLI suite: 72 tests passed, covering multiple files, mixed and overlapping
  targets, stable source order, combined provider/consumer repair, invalid
  targets before any write, exclusions, explicit roots, spaces, and read-only
  formatting. Other commands retain their positional limits.
- Seven real CLI smoke cases passed: omitted target from root and nested cwd,
  explicit file, directory, mixed targets, nested cwd with explicit root, and
  mixed targets with `--check`. Selected contents and unchanged config/excluded
  files were verified. [Command evidence](evidence/sigil-mechanical-validation/cli-smoke.json).
- Offline skill package validation and all six foundation/relocation tests passed.
- Repository typecheck and lint passed; the configured full test task also passed.
- Final workspace check had no diagnostics. Both changed contracts were canonical
  under the new multiple-target `fmt --check` invocation.

A subsequent regression check found that changing the formatter request to a
path array bypassed absolute output-path selection. The correction preserves
absolute single-target output and makes mixed absolute/relative batches use the
same output convention in either argument order. Its regression failed before
the correction; all 73 CLI tests, repository typecheck, and lint passed afterward.
The skill observations above retain their original source identity.

The [completed code review](evidence/sigil-mechanical-validation/code-review.json)
then confirmed an ancestor-target preflight defect: failed discovery could return
the current directory as a fallback root and incorrectly pass the root comparison.
The final correction requires a discovered configuration before accepting that
comparison. Adapter and CLI regressions first reproduced the defect, then passed
for both argument orders and both write/check modes with no replacement calls on
failure. Explicit-root ancestor selection still passes its existing test. The
final CLI suite contains 75 passing tests.
[Follow-up verification](evidence/sigil-mechanical-validation/review-followup.json)
records the fixes separately from the review's earlier source snapshot.

The CLI reports artifact version 0.9.0 and core/language 0.8.0. The installed
launcher resolves this source checkout. Its identity, compatibility response,
and source revision are recorded in [environment evidence](evidence/sigil-mechanical-validation/environment.json).
[Catalog identities](evidence/sigil-mechanical-validation/catalog-identities.json)
hash every copied skill file. Captured source contents are serialized inside
JSON evidence so they do not enter this repository's Sigil source discovery.

## Limits

These are observed individual runs, not a reliability estimate or implementation
conformance assessment. Read-only agent restrictions were instructions, not an
enforced filesystem sandbox; the host checked source/config hashes afterward.
Served model identity was not independently verified. The launcher hash does not
pin the entire executable dependency graph.

The no-CLI case controlled permitted discovery rather than uninstalling the host
CLI. The legacy case used a labeled stub rather than an old production binary.
The mismatch case deliberately injected changed inputs. Older compatible
single-file CLI fallback and post-review cosmetic mutation remain documented
fixtures, not newly observed cases in this batch.

Initial smoke harness attempts used an incorrect selected-result count and mixed
macOS `/var` and `/private/var` aliases. The harness was corrected and rerun with
canonical paths; no new alias-equivalence behavior is claimed. Batch preflight
prevents writes on target or combined-validation failure; it does not promise
rollback after a filesystem failure during the write loop.
