# Sigil 0.8 foundation: observed evaluation

Date: 2026-09-15. Scope: U1–U5 of the understanding, writing and design-evaluation
plan. These observations concern the skill foundation; they do not establish
0.8 compiler conformance, implementation alignment, or saturated coherence.

## Environment and input identity

Host: Codex, native agent delegation. No separately verified served-model
identifier was exposed for the behavioral agents; none is claimed. Each tested
agent received fresh context and the installed skill path plus raw project inputs.
Read-only evaluator restrictions were instructions, not an enforced sandbox.
No evaluator used the network or a compiler. Expected outcomes were withheld.

Implementation baseline: `28ff9851a50032c2f6be9140c48a23d9d8f8a9c8`.
Understanding skill: commit `515ecbf`; evaluator: `2445686`; writer: `62edb6b`;
installation/validation: `f15965d`. New skill artifact versions are `0.1.0` and
language compatibility is `0.8.0`. The language manifest pins the baseline source
revision; its SHA-256 is
`4cf2ab36e460ff1204dd6d59ad8fe9e399e61a2afe4810ab977638dfb160d441`.
Raw reports record the individual skill/reference and project input identities.

The complete sibling bundle and fenced fixture inputs were copied to temporary
workspaces outside authored source discovery. Original absolute paths in the
reports identify that run's temporary inputs; repeat runs use the fixture's
workspace-relative layout. No 0.8 `.sigil` fixture was added to the repository.
[Run instructions](../../integrations/skills/sigil-write/evals/README.md) explain
how to materialize inputs and keep observer expectations out of agent prompts.

## Understanding and direct evaluation

| Case / fresh agent | Observed result | Evidence |
| --- | --- | --- |
| Understanding / `observe_understanding` | Correct provider Tag ownership and consumer Facet ownership, including multiword search results; distinguished invariant from unselected cancellation option. No invented retention policy or runtime dependency. | [Actual explanation](evidence/sigil-0.8-foundation/understanding.md) |
| Compact / `observe_compact` | Complete assessment, zero findings. Accepted active-request invariant without optional sections, edge-case lists, cancellation helpers or retention requirements. This used the understanding fixture with its unselected cancellation rationale. | [Actual report](evidence/sigil-0.8-foundation/compact.json) |
| Contradiction / `observe_contradiction` | High-priority determined correction: cancelled request publication contradicts both invariant and adopted intent; suggested “must not publish.” | [Actual report](evidence/sigil-0.8-foundation/contradiction.md) |
| Ownership / `observe_ownership` | High-priority design choice: both components claim exclusive final authority over one store. Did not choose the winning owner. | [Actual report](evidence/sigil-0.8-foundation/ownership.md) |
| Repetition / `observe_simplification` | Low-priority determined consolidation; explicitly retained the independent displayed-results continuity promise. | [Actual report](evidence/sigil-0.8-foundation/simplification.md) |
| Missing policy / `observe_missing_policy` | Incomplete assessment and medium-priority evidence gap; resolved the source-relative policy path, observed missing file, and invented no duration. | [Actual report](evidence/sigil-0.8-foundation/missing-policy.md) |

The host compared all materialized direct-case hashes after evaluation and before
any writer could edit them: [unchanged source identities](evidence/sigil-0.8-foundation/direct-read-only-verified.json).
The compact run's inputs also retained the understanding fixture hashes recorded
in its report. Report files were saved by a separate recordkeeping turn after
read-only evaluation finished; source files were not modified by evaluators.

## Writing and review loop

- **New draft with independent review:** `observe_writer_new` created a compact
  `SearchPanel` from three supplied intent commitments and delegated to
  `/root/observe_writer_new/evaluate_search_panel` with no inherited history.
  The evaluator returned complete with zero findings; the writer verified current
  inputs before reporting coverage. The host independently checked the exact
  request/report mappings, current originals, captures and authority digests.
  [Outcome](evidence/sigil-0.8-foundation/writer-new/outcome.json),
  [raw report](evidence/sigil-0.8-foundation/writer-new/round-1/raw-report.json),
  [host checks](evidence/sigil-0.8-foundation/writer-new/host-verification.json).
  Final draft hash: `286b5c8365c53bcdf0af92bc69b8155288b9dc188114cdc9aecc111b49f85c26`.
- **Diagnostic-driven correction:** `observe_writer_correction` resumed the actual
  contradiction report against unchanged inputs, verified nine input/authority
  digests, and changed only “may publish” to “must not publish.” It launched
  `/root/observe_writer_correction/fresh_review` with no inherited history.
  The evaluator returned complete with zero findings. The host independently
  rehashed current originals, captures and authority against the recorded checks.
  [Outcome](evidence/sigil-0.8-foundation/writer-correction/outcome.json),
  [raw fresh report](evidence/sigil-0.8-foundation/writer-correction/revision-1/report.raw.json),
  [freshness evidence](evidence/sigil-0.8-foundation/writer-correction/revision-1/verification.json).
  The final draft hash is `bf73a848db30dd4d5fce61acb0085e17bd7f9eed9e965107052d73d0d8cf9042`.
- **Delegation unavailable:** `observe_no_delegation` created the compact draft and
  returned zero completed evaluator runs, unknown remaining findings, exact
  captures and a portable request. This was an instruction-level capability
  restriction, not physical removal of the host's tools.
  [Outcome](evidence/sigil-0.8-foundation/no-delegation/final-report.json),
  [handoff](evidence/sigil-0.8-foundation/no-delegation/review-request.json).
  The host verified capture hashes. No same-agent pass was represented as
  independent review.

- **Simplification with a human choice:** `observe_writer_policy` removed two
  duplicate authorization prohibitions and preserved authorized download,
  download continuity, and automatic expiry deletion. Its fresh evaluator
  `/root/observe_writer_policy/review_archive` returned one `design_choice` for
  the product owner's expiry timing, with no extra compactness finding. The
  writer returned that decision and invented no duration.
  [Outcome](evidence/sigil-0.8-foundation/writer-policy/outcome.json),
  [raw report](evidence/sigil-0.8-foundation/writer-policy/review-01/report.raw.json).
- **Accessible missing context:** `observe_writer_retrieval` followed
  `archive/export.sigil`'s relative policy link, retrieved the local policy without
  asking for it, and replaced seven-day retention with the adopted thirty-day,
  automatic-deletion, no-download-reset policy. The fresh evaluator
  `/root/observe_writer_retrieval/review_export` returned complete with zero
  findings, including the policy's identity. Temporary agent-capacity rejection
  was retried; it was not misreported as absent delegation.
  [Outcome](evidence/sigil-0.8-foundation/writer-retrieval/final-outcome.json),
  [raw report](evidence/sigil-0.8-foundation/writer-retrieval/r1/report.raw.json).
  The host independently verified both runs' reported input hashes against
  captures and available current originals.

- **Provider-only stale coverage:** after the compact evaluator finished, the host
  changed only the provider's result ordering description. The unchanged authentic
  report was given to `observe_writer_freshness`, which detected the provider hash
  change despite identical panel bytes. It captured current inputs and invoked
  `/root/observe_writer_freshness/fresh_evaluator`; the fresh report was complete
  with zero findings. No stale edit was applied. This was a controlled intervening
  source edit with two real reviews, not a fabricated clean report.
  [Injected event](evidence/sigil-0.8-foundation/stale-provider-event.json),
  [outcome](evidence/sigil-0.8-foundation/writer-freshness/outcome.json),
  [raw fresh report](evidence/sigil-0.8-foundation/writer-freshness/round-1/report.raw.json).
  Current provider hash: `638b354d6a4a4a772f2a3ba8fe080bcb63003d535a4867691fca702f381cef31`;
  panel hash remained `1c9bca7e2c8133f8c7cabd1fd45cc5292de17ddbdc12cea27d9c9140ed4dd8dc`.

- **Repeated finding:** `observe_repeated_findings` consumed controlled history
  and a new-ID report alleging the same publication repetition after consolidation.
  It matched the affected commitment and consequence, rejected deletion of the
  last invariant as contrary to adopted intent, preserved display continuity,
  and stopped with no rewrite. It correctly reported no actual independent
  coverage from replay and provided a handoff under disabled delegation.
  [Replay input](evidence/sigil-0.8-foundation/repeat-input/report.json),
  [history](evidence/sigil-0.8-foundation/repeat-input/history.json),
  [outcome](evidence/sigil-0.8-foundation/repeat-outcome/outcome.md).
  This observes the reworded-repeat branch; it does not claim a live model
  oscillation or physically interrupted process was exercised.
- **Verbose-to-compact follow-up and unusable report recovery:** the host applied
  the actual D-report's supported consolidation, preserving the independent
  display promise. A fresh evaluator returned zero findings but mistyped its
  captured path. The host rejected this unusable identity mapping, retained the
  raw report, and retried once with another fresh evaluator on unchanged captures.
  The second report accepted the compact design with zero findings and correct
  identities; the host checked originals, captures, and mapping independently.
  [Writer action](evidence/sigil-0.8-foundation/compact-followup/writer-action.json),
  [actual first report](evidence/sigil-0.8-foundation/compact-followup/report-first.raw.json),
  [rejection](evidence/sigil-0.8-foundation/compact-followup/rejected-report.json),
  [fresh retry](evidence/sigil-0.8-foundation/compact-followup/report-retry.raw.json),
  [acceptance checks](evidence/sigil-0.8-foundation/compact-followup/accepted-report.json).
  The malformed path arose during execution; it was not injected. Final hash:
  `316f31fdf241548ac249d1f50e47f046a4b680958372618f57130fe69a00ca30`.

- **Required report root after code-review correction:** fresh writers
  `observe_root_missing` and `observe_root_mismatch` consumed controlled replays
  with matching draft, provider and intent bytes. They explicitly rejected a
  missing top-level root and a root unequal to the request, respectively; neither
  substituted a nested scope value, edited the draft, or claimed current coverage.
  Both provided handoffs under instruction-disabled delegation. They also detected
  the replay's older review-contract digest after the contract clarification, so
  these observations include that additional authority mismatch; they are not
  isolated single-error tests or new independent evaluator runs.
  [Missing-root outcome](evidence/sigil-0.8-foundation/root-missing/outcome.json),
  [mismatched-root outcome](evidence/sigil-0.8-foundation/root-mismatch/outcome.json).
  The host independently verified the unchanged draft and handoff captures.
  It also found that the mismatched-root handoff copied only part of the language
  pack. A recordkeeping repair copied the complete evaluator/understanding bundle;
  the host then validated all manifest outputs independently.
  [Repair record](evidence/sigil-0.8-foundation/root-mismatch/handoff-repair.json)
  preserves this observed packaging error and correction, without claiming a new
  evaluation. The original outcome remains unchanged.

[Final design snapshots](evidence/sigil-0.8-foundation/drafts.md) retain output
bytes as fenced Markdown. Raw reports are historical records: absolute paths
and statements about what the evaluator checked are preserved verbatim. Host
freshness checks are recorded separately and do not turn evaluator restrictions
into an enforced sandbox.

## Package and integration verification

| Check | Observed result |
| --- | --- |
| `deno task test:skill` | Pass with read permission only: metadata, declared siblings, documentary links and exact source reproduction. No compiler, subprocess, write or network permission. |
| Focused foundation regressions | 6 passed after removing a redundant subset-catalog test (7 passed before simplification). Source/output mutation and sync restoration; link-only rewriting; fenced/inline-code masking; installed integrity; metadata and undeclared content rejection; broken references/dependencies; relocation. Initial implementation red was a missing sync module; validator integration red was its missing export before implementation. |
| Filtered CLI installer tests | 6 passed, including real-catalog global/project links, forced copies and relocated copies; existing managed-update and unmanaged-collision checks preserved. |
| `deno task test:skill:native` | Pass: existing skill artifact 0.9.0 and all 15 documented native command examples. Both existing binaries built successfully. |
| `deno task package:cli` | Pass on aarch64-apple-darwin. Relocated package lists all four skills, installs its sibling bundle and resolves references. Existing six native semantic states, unavailable result and stale-ingest rejection pass. No claim for other platform builds. |
| `deno task lint` | Pass. Removed one already-empty no-op block while preserving the native validator. |
| `deno task check` | Pass for core, CLI, LSP and VS Code TypeScript. |
| Formatting of changed TypeScript/configuration | Pass. Repository-wide baseline formatting failures are listed below. |

The real-catalog link fixture canonicalizes the macOS temporary directory with
`realPath`: `/var` aliases `/private/var`, which otherwise changes the physical
parent of cross-root relative links. This is test setup; installer algorithms
were not changed. Arbitrary installation through aliased ancestor paths is not
new coverage claimed by this run.

## Broader repository checks and pre-existing failures

The broad `deno task test` run passed native and core suites (core: 70 tests and
61 steps), then stopped at three existing CLI failures (54 passed):

- `parse discovers config and emits workspace metadata` consumes the already
  migrated 0.8 promise example with the current 0.7 frontend.
- `graph includes component nodes and imported-component edges` similarly uses
  the already migrated slotted example.
- `export emits the raw native bundle and preserves captured text without invoking
  a compiler` embeds this macOS temporary directory in prose; its indivisible
  path exceeds 79 characters and raises `SIGIL_UNFORMATTABLE_LINE`.

Independent LSP tests passed 23/23. VS Code typecheck and 15 unit tests passed
after installing its existing locked dependencies; the initial attempt lacked
`tsc`. The aggregate command did not reach VS Code extension integration.
The final CLI rerun passed 55 tests and failed the same three listed above after
the additional installer case landed. Final native and release reruns passed.

`deno task fmt` already failed before implementation in
`packages/core/src/formatter.ts`, `packages/core/src/model/resolution.ts`,
`packages/core/src/parser.ts`, `packages/core/tests/core_test.ts`, and
`packages/lsp/src/features.ts`. Those unrelated files were left unchanged.
The pre-existing eqval documentation edits and the supplied plan also remained
outside implementation commits.

## Completion trace

| Requirements | Delivered behavior and evidence |
| --- | --- |
| R1–R3 | Three installed entry points, one reproduced language pack, understanding and Tag/provider observations. |
| R4–R7 | Contradiction and ownership diagnostics, missing-policy restraint, compact acceptance and commitment-preserving consolidation. |
| R8–R11 | Structured advisory findings, unchanged direct-review sources, explicit evidence gaps and compiler/saturation limits. |
| R12–R14 | New drafting and separate evaluation; autonomous correction and simplification; unresolved retention choice preserved. |
| R15–R16 | Fresh review after changes, provider-only stale rejection, malformed report recovery, portable handoff and repeated-finding stop. |

U1–U5 and all ten acceptance examples have corresponding implementation or
observed evidence above. These are bounded observations on the named host, not
a guarantee about every model or interruption mode. Three simplification reviewers
checked reuse, quality and efficiency; shared local-link classification and one
redundant-test removal landed in `ae0dacb`, followed by passing focused checks.

## Code review and closure

`ce-code-review` completed full review of 106 task-owned paths with five local
reviewers and an independent Claude review (`claude-opus-5` served; requested
effort high, actual effort unverified). The
[completed receipt](evidence/sigil-0.8-foundation/code-review/review.json) records
one independently confirmed finding: the report must expose the workspace root
that the writer is required to compare. The caller applied finding #1 inline
under the single-finding rule, added explicit missing/mismatched-root fixture
variants, and ran the observations above. Offline validation, all six foundation
regressions, and relocated release packaging passed after the clarification.

The four external candidates were rejected after source and plan checks;
[admission reasons](evidence/sigil-0.8-foundation/code-review/synthesized-findings.json)
are preserved. The receipt describes the pre-fix review; the caller's
[resolution record](evidence/sigil-0.8-foundation/code-review/resolution.json)
records closure separately. Draft-only mutation remains additional, unexecuted
coverage; the observed provider-only variant satisfies the plan's alternative.
