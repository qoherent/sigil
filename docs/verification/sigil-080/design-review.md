# Sigil 0.8 combined design review

## Status

**The U2 design-review milestone is complete.** A fresh independent assessment
of all 53 current designs found no material findings. The user-directed import
correction and subsequent diagnostic corrections preserve provider-owned Tags,
consumer-owned Facets, and the scoped original commitments. This is design
assessment, not compiler validation or implementation conformance. Earlier
revision reports remain historical evidence as identified below.

The correction changes 23 files, including three U1 providers/summaries, removes all authored .sigil Inline Links, restores meaningful selected-Tag dependencies, and renames 19 local concerns to avoid provider-name collisions. [The correction mapping](u2-import-correction-mapping.json) supplies exact current identities, provider selections, and annotation consequences; [the main locator mapping](u2-locator-mapping.md) composes original migration destinations with those renames. The earlier authorized retrieval-model correction remains recorded. [The U1 review](u1-review.md) preserves its historical milestone reports and hashes.

The bounded source audit at `/tmp/sigil080-execution/restored-import-audit.json` finds 129 import declarations and 168 selections across 53 active designs, with no missing provider/Tag, duplicate accessible import name, local/import collision, or missing prose-use candidate. This is an author-side lexical aid, not compiler validation or independent assessment. Latest user intent is captured separately at `/tmp/sigil080-execution/U2-user-import-correction-intent.md`.

## Completed review of the import correction

Capture: `/tmp/sigil080-execution/u2-reviews/20260915-191242-843324`.
The foundations and remaining requests cover disjoint sets of 26 and 27 designs,
with all 124 source/context/intent inputs and 10 authority identities verified
against captured and live bytes before dispatch. The user import correction
supersedes earlier documentary-link guidance for this project's authored designs.

Native fresh-agent creation remained unavailable due the host thread limit.
A fresh, non-resumed Codex CLI process is the recovery route. The installed
0.149.1 CLI was rejected as too old for the configured model; an isolated
0.154.0 installation under `/tmp/sigil080-execution/review-toolchain` successfully
started both reviewers without changing the global installation or selecting a
different model. Each process uses the configured model, a read-only sandbox,
no approval requests, an empty working directory, and the exact request as its
sole project/intent authority. The actual request, invocation and JSONL events
are retained under `foundations154-codex-run` and `remaining154-codex-run`.
Both actual final reports were verified against their JSONL final messages and
all current source/authority bytes before applying any correction. The foundations
report assessed 86 inputs and 10 authority identities, reporting one finding;
the remaining report assessed 94 inputs and 11 authority identities with no
findings. Report SHA-256 values are
`8aac164ba2a63a259c055aeb0257bb64321a57e42bba726f5c3115724acf3665`
and `083b4afe35c3033ef0dbde964482eed31fd02c5f9ace4adafca94757cfa5d4fc`.
Their disjoint selected scope covers all 53 designs. These reports are historical
after the following source correction.

## Diagnostic preservation correction and current review

The foundations report's F1 identified diagnostic equality and evidence identity
that omitted stage and related locations. Retrieval now selects DiagnosticModel
from its owner and preserves complete diagnostic records through raw equality,
evidence identity, and context deduplication. Purpose-specific filtering and
human-facing severity/code/message text are retained. Raw diagnostics use the
model's already-adopted normative ordering. The suggestion to retain legacy
severity-first ordering was not applied because DiagnosticModel assigns ordering
to diagnostic.record. The current, unpublished v2/policy-2 protocol includes the
corrected fields; its projection remains independently versioned.

Both subsequent reviewers completed against capture
`/tmp/sigil080-execution/u2-reviews/20260915-193151-942237`. Actual final reports
were matched to their JSONL messages and verified against all current inputs
before correction. Foundations assessed 89 inputs and 9 authority identities;
remaining assessed 95 inputs and 10 authority identities. Report hashes are
`df934bfb247b288eecc92ce26778349b4f3488bd3e25dce777305d51bb59770e`
and `f263bd7f92d5d8faa373d7271227761f81e60400a3ea2ea6f0fcdcca80d8bffe`.
Both identified the obsolete attribution of diagnostic data to SigilSemanticModel.
The remaining report also identified incompatible diagnostic ordering/coalescing.

Implementation ownership now imports DiagnosticModel from SigilDiagnosticModel
and uses its complete-record ordering and coalescing. Snapshot association, the
immutable envelope, discovery availability, annotation categories, and consumer
ownership are preserved. The foundations suggestion to preserve severity-first
ordering was not applied: the actual provider explicitly assigns ordering to
normative diagnostic.record. The complete disposition is retained at
`/tmp/sigil080-execution/u2-ownership-diagnostic-correction.json`.

Current capture: `/tmp/sigil080-execution/u2-reviews/20260915-195418-907988`.
Fresh read-only run `current3-codex-run` completed. It assessed current meaning,
roles, ownership, and relationships across all 53 designs. Historical comparison
is scoped to implementation-ownership.sigil, using its original pre-migration
and immediate pre-edit bytes; the other 52 original-preservation comparisons
remain historical evidence from completed reviews. The request has 73 inputs
and 10 authority identities. Prior reports and writer assessments were not
supplied. Its actual final JSON matches the recorded final evaluator message.
The report SHA-256 is
`b5c0f93445fb58b87cecdef25730dffc04d2de23b1018728a101a1ff4e4bf76b`.
It assessed 72 project/context/intent inputs, all 53 designs (55 components),
and 16 authority identities, with no findings. The legacy summary was
hash-checked only and explicitly omitted from assessment. Root verification
confirmed all assessed identities, all 73 supplied inputs, authority bytes,
original source roots, and current mappings without mismatches.

`root-preservation-audit.json` in the current capture verifies 39 original
locator rows, 23 import-correction identities, and unchanged legacy/WIP files.
The report's limits include no implementation comparison, no compiler execution,
no rendered SVG QA, and no fresh historical comparison of the other 52 designs.
An existing-runtime baseline subsequently passed 70 core tests and 61 steps;
that baseline is separate from this design assessment and does not validate 0.8.

## Historical candidate before the user import correction

Capture: `/tmp/sigil080-execution/u2-reviews/20260915-184232-649813`.

| Request | Selected designs | SHA-256 |
| --- | ---: | --- |
| `foundations-request.json` | 26 | `a609bfb83f1a8e1f23aaf9f654bcc726a8a1680914d2968d0a0b8514342af6fc` |
| `remaining-request.json` | 27 | `f7be291ae5f9f4fd9fb2512100695012b661c2f9db618a1950ea0c02aa01a344` |

Each historical request carries its then-current 53 designs, immutable originals, source-root and historical-resolution mappings, example roots, normative inputs, and established intent: 123 inputs plus 10 evaluator/authority identities. The disjoint partition union is exactly the 53 tracked nonhistorical designs. The 12 legacy skill designs are excluded from current-language assessment and retained unchanged.

The sibling language pack is bound to its source/output manifest, and installed authority bytes match the repository capture. `authority-equivalence.json` records all five normative-source/output pairs. Acceptance of the next fresh report must independently verify actual assessed identities, selected-file coverage, original resolution roots, every supplied live input, and the authority bytes used. Merely copying request identities does not establish assessment.

## Initial independent assessment and dispositions

Initial capture: `/tmp/sigil080-execution/u2-reviews/20260915-174547-473203`.

| Actual report | Selected designs | Report SHA-256 |
| --- | ---: | --- |
| `foundations-report.json` | 26 | `35290aa4dc956ca6226c46e07234ba14da1969a312f27bdf39bbfb637f4c74f7` |
| `remaining-report.json` | 27 | `2fc21cd7de3883e8b71c7ccb4da167d29ffe190f0f73f8d4cccdb0ddcd894f5f` |

The reports were extracted from the evaluators' actual final session messages, preserved unchanged, and checked against the then-current sources before any corrections. Their corresponding `*-verification.json` files record freshness and coverage checks. The request hashes are `02cb20dbf4724ed6a082dd828b6149cada449833cb20ca4955193cdefc434043` and `cedf0654ef90040b6c35db287f8997b82dbcd840db71ddc49141e596c98d035f`, respectively. Evaluators started with fresh conversation context and received read-only instructions. Those instructions were the only write restriction; host tools could write.

All eight findings, covering seven distinct issues, were accepted as determined corrections under existing commitments. No finding was rejected and no author-policy question remains unresolved. The complete evidence/disposition history is `/tmp/sigil080-execution/u2-reviews/disposition-history.json`.

| Findings | Applied correction |
| --- | --- |
| `FOUNDATIONS-001`, `R1-FORMAT-WIDTH` | Formatter and CLI permit only the authorized repairable-width exception; other invalid or recovered input still prevents writes. |
| `FOUNDATIONS-002` | Pipeline preserves execution stages while final diagnostics follow normative ordering and coalescing. |
| `FOUNDATIONS-003` | Parser distinguishes recovery kinds and skips the balanced body of an unknown section without discarding independent later source. |
| `R2-RETRIEVAL-VERSION` | Raw retrieval uses `sigil-purpose-retrieval/v2`, policy 2; agent presentation uses independent `sigil-retrieval-projection/v2`. Model, producer, and CLI agree. |
| `R3-RETRIEVAL-RANGES` | Sigil evidence retains authoritative UTF-8 bytes and snapshot identity, derived scalar display, and separately identified implementation coordinates. |
| `R4-OWNERSHIP-PROJECTION` | Consumer-owned links preserve exact accessible Tag scope and separate origin, including imported and inline-only Tags. Markdown does not fabricate local grouping. Ordinary summaries use ordinary component roles. |
| `R5-RETRIEVAL-BUDGET` | Optional evidence-byte limits retain mandatory selected evidence, deterministic stopping and visible withholding; structural membership has no size-pruning budget. |

The completed current assessment above covers the corrected design relationships.

## Historical import-correction preservation evidence

`/tmp/sigil080-execution/u2-import-correction-preservation-audit.json` verified the import-corrected revision identities, all39 locator mappings, four authorized U1 deltas, seven prior payload sequences, unchanged non-Sigil link destinations, 12 legacy designs, six excluded WIP files, and byte-identical examples relative to the previous candidate. SHA-256: `fb6b519e5a695baddf34dcbb93a7592a6e5bf1d28927e77f6d9db5c96c28b632`. All checks passed; no compiler or implementation tests were run.

## Historical preservation evidence and limits

`author-preservation-audit.json` in the historical 184232 capture verified all 123 request inputs and 10 authority inputs against then-current live and saved bytes, 39 original/current mapping pairs, 12 unchanged legacy designs, and six unchanged excluded WIP paths. It also checks four original fenced payload byte sequences and existence of 90 local documentary link targets. Its SHA-256 is `2cbcd22a1b177554d83afa132665e5e176fb765c736e6c2e0d986b6aaec22f60`. These lexical and path checks are not a language parser or a semantic-equivalence proof.

The slotted auth import remains byte-identical and selects the actual provider-owned `UserProfile` Tag. Promise validly introduces no Tags. Original payloads, diagram roles and the calendar SVG target are preserved. The obsolete `User.email` executable assertion is explicitly mapped to later U9 correction; no corresponding Tag was invented. Existing expands consolidate under the same component and contract role. Native structural provenance does not add eqval semantic laws. External producers prepare and ingest; VS Code exports Design and compiles stored projections.

No 0.8 compiler validation, implementation conformance, rendered SVG QA, packaging or release execution was performed for this design unit. The root configuration remains intentionally transitional. Current design review cannot establish runtime behavior, compiler conformance, native gate success, or shipping readiness. The current fresh report establishes the U2 design milestone with the limitations recorded above.
