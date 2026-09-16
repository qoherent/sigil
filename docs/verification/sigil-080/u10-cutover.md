# U10 — Workspace and artifact cutover

The root configuration now selects language 0.8.0 and excludes the retained
`integrations/skills/sigil/**` subtree. It is no longer a workspace member. Active
root imports do not depend on it. Historical skill bytes, requirements and stored
native artifacts are retained; current tools reject incompatible evidence.

Prepared artifact versions: core/LSP/VS Code 0.8.0, CLI 0.9.0, native sigilc 0.2.0.
Core publication, the native CLI archive and the VSIX include the Unicode data
license. The language pack was regenerated from current source and its recorded transformation. Current support
and historical prose are distinguished in package/root documentation.

Root acceptance found stale implementation selectors. Annotations now select the
renamed local CLI Tags and `GlossaryInterpretationLoading`, preserving their
original contract sections and distinguishing them from imported provider Tags.
Consecutive annotation comments use the required multiline form. These corrections preserve the section evidence instead of removing it.

The final design review identified missing provider selections in two core designs.
`SigilDesignInput` now selects `WorkspaceLoading` and `RelationshipResolution`;
`SigilCompilationBoundary` selects `GraphData`. The exact-target location promise
now explicitly selects the containing file, preserving pre-migration behavior;
a boundary regression assertion covers it. The native store, reports, closure,
catalog, source identity and scope also select their governing provider Tags.
Fresh independent review of all 53 current designs is complete with no findings.

## Verification

| Gate | Result |
| --- | --- |
| Aggregate tests | Pass: 76 native tests; 115 core tests plus 100 steps; 65 CLI tests; 38 LSP tests; 24 VS Code unit tests; real extension host; current native protocol; skill checks; 6 foundation tests. |
| Actual workspaces | Root, slotted and promise: check/context/retrieve/export and native scope pass. All 53 reviewed sources are present: 55 components, 342 Tags, 2,229 Facets, 650 introductions, 407 references, 149 imports selecting 196 Tags, and 22 Inline Links. No documentary `.sigil` link replaces a provider dependency. |
| Actual VS Code workspace | macOS arm64 VS Code 1.137.0 passes against the activated repository's slotted example, including native range projection, preview and lifecycle behavior. |
| Relocated CLI archive | Pass with CLI 0.9.0/native 0.2.0, an empty executable search path, honest legacy catalog compatibility, provider Tag import/export/scope, all six fixed-Turtle states, stale-ingest rejection and unsupported-language rejection. |
| Source-free archive consumer | A standalone Rust harness passes schema-2 export and native Loose/unavailable checks against the extracted archive with hostile host-tool shims; none were invoked. |
| VSIX | `integrations/editor/vscode/build/sigil-vscode-0.8.0.vsix` built successfully. |
| JSR dry-runs | Core, CLI and LSP pass with `--allow-dirty`. The aggregate task's initial clean-tree guard was expected because unrelated user WIP is retained. No publication occurred. |
| Source quality | Aggregate typecheck, lint, format check, native rustfmt and clippy pass. |
| Historical skill | Static frozen metadata/reference check passes. Optional runtime validation requires both explicitly supplied legacy binaries and verifies their version ranges. Legacy runtime was not run with current binaries. |
| Current protocol | Dedicated `test:native:protocol` runs in normal aggregate CI and is reused by relocated package acceptance; fixed Turtle validates protocol/state handling, not independent semantic reconstruction. |

Logs and captured actual-workspace JSON are under `/tmp/sigil080-execution/`;
primary logs use `U10-aggregate-final`, `U10-actual`, `U10-host-actual-final`,
`U10-package-cli-final`, `U10-package-vscode-final`,
`U10-publish-{core,cli,lsp}-final`,
`U10-{fmt,lint}-final`, `U10-check-final` and `U10-clippy`.
The final source-free result and exact archive/license checks are recorded in
`source-free-consumer/result-final.log` and `U10-license-evidence-final.json`.

U9/U10 simplification completed: delegated reuse review found no behavior-equivalent
replacements; inline quality/efficiency review found no additional safe changes.
Current and historical native runners deliberately retain different environment
and compatibility contracts. Earlier clusters have their own verification notes.

## Final review and corrections

Independent design review: `sigil-design-review/v1`, complete, no findings.
Capture: `/tmp/sigil080-execution/u10-reviews/20260916-002917`.
All 75 assessed inputs, all 53 drafts, 17 authority identities, original mappings
and source root were verified against current bytes. Report SHA-256:
`d9dc0dbae36686fd8f84b20fda4c2352e7032ea5a3a943e0b7b04871b9fb46ed`.
Historical preservation comparison remains limited to the supplied ownership
baselines and earlier U1/U2 receipts. The fixture's unadopted `notes.md` target was
unavailable; no claim is made about its contents. This advisory assessment is
separate from the compiler and implementation tests above.

Code review: complete, run `20260916-000342-sigil080`; eight local reviewers and
an independent validator confirmed six findings. The reviewed snapshot and full
report are under `/tmp/compound-engineering-501/ce-code-review/20260916-000342-sigil080`.
Report SHA-256: `0f7f5579f3500e4380ee5c0eb47155ce57435e8bb0c760b1d7b222562085c7a6`.
The additional Claude review timed out without usable output; this is recorded
as degraded cross-model coverage. The review snapshot preceded the final design
corrections and following caller-owned fixes; those were checked through fresh
design review, direct diff review, targeted regressions and aggregate acceptance.

| Finding | Resolution and verification |
| --- | --- |
| #1 Nested-workspace export | Preserve structured discovery errors, parent related locations and exit 1 without admitting outside-root native paths; core and CLI regressions pass. |
| #2 Component-like grouping Tag | Recognize component openers only at top level; exact `component Search` grouping identity and ownership pass full-parser tests. |
| #3 Editor publication races | Extract the existing publication boundary; four deferred-promise tests cover edits and replacement operations. Removing either guard makes its tests fail; restored guards pass. |
| #4 Repeated formatter resolution | Skip re-resolution for unchanged output after existing gates; reuse unchanged parsed sources in combined validation. A 64-file probe drops 66 resolutions to 2, with median time 26.570 ms to 5.047 ms. This is a focused local probe, not a general performance claim. |
| #5 Wrapped links with braces | Protect complete links on candidate header lines while preserving later structural/fence/blank boundaries. LF, CRLF and CR byte-range regressions also caught and fixed CRLF title-separator backtracking. |
| #6 Failed LSP reload | Clear stale state and diagnostics, surface the load error, share request-driven recovery and bound persistent retries. Healthy pending reloads remain ContentModified without extra reads; 38 LSP tests pass. |

No confirmed review findings remain unresolved. The five implementation batches
were grouped by parser, exporter, formatter, LSP and editor ownership. Final
source inspection and aggregate tests cover their combined result.

## Release limits

This is local delivery, not a published release. GitHub release endpoints returned
no releases for the configured repository and distribution repository. JSR metadata
requests returned HTTP 403, so registry version availability could not be verified;
prepared versions must be checked again before publication. Dry-run packaging does
not establish registry availability.

Only macOS arm64 execution was available locally. CI retains Linux, macOS and
Windows checks and now runs native rustfmt/clippy; the five native release targets
still require their own matching-runner acceptance before a release. No remote CI
or external release was initiated.

## Operational validation for a future release

Before publication, repeat registry occupancy checks and each target's relocated
consumer test. After installation, verify `--version`, a known 0.8 workspace check,
provider Tag navigation, schema-2 export and native source-range diagnostics. Treat
wrong selected text, stale findings, missing owned Facets or a successful report
from incompatible artifacts as regression triggers. Preserve original sources and
stores when reverting binaries; do not translate stores or revert authored designs
with an old formatter. Release ownership and rollout timing remain maintainer-owned.
