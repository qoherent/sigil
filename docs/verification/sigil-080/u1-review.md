# U1 design migration review

## Outcome

The 14 selected U1 design files are migrated to Sigil 0.8 notation and provider ownership. One independently identified workspace-root example was corrected under existing authority. A fresh independent assessment of the corrected revision is complete with no admitted material findings. All 36 assessed input identities, 10 authority identities, and original resolution mappings match the current bytes. This coverage is limited to U1.

## Evidence

- Original source capture: `/tmp/sigil080-execution/original`.
- Original manifest: `/tmp/sigil080-execution/original-manifest.json`.
- First captured request: `/tmp/sigil080-execution/u1-reviews/20260915-171505-091545/request.json`.
- First actual evaluator report: `/tmp/sigil080-execution/u1-reviews/20260915-171505-091545/report.json`.
- First caller freshness and report verification: `/tmp/sigil080-execution/u1-reviews/20260915-171505-091545/caller-verification.json`.
- Current captured request: `/tmp/sigil080-execution/u1-reviews/20260915-172404-606532/request.json`.
- Current actual evaluator report: `/tmp/sigil080-execution/u1-reviews/20260915-172404-606532/report.json`.
- Current caller freshness and report verification: `/tmp/sigil080-execution/u1-reviews/20260915-172404-606532/caller-verification.json`.
- Current request SHA-256: `bcde5041cfa9f9a9e4887fc29c9f88137ff661bc08c6ea3f29c60b9f900f91f1`.
- Current report SHA-256: `9729cf1caee38cf6ea3883825a207559d99492a6a39951b80715ee1aca6f9089`.
- Disposition history: `/tmp/sigil080-execution/u1-reviews/u1-disposition-history.json`.
- Contribution and annotation mapping: [u1-locator-mapping.md](u1-locator-mapping.md).

Each request contains explicit original/captured paths, exact SHA-256 identities, immutable intent and baseline inputs, historical source-resolution mappings, evaluator skill identity, and shared authority identity. The saved report retains the actual returned evaluator fields and identities; caller serialization does not change the assessment.

## Resolved finding

`U1-R1-001`: the legacy case could resolve a workspace root to `.sigil` or a target directory. The case now explicitly selects the parent of `.sigil` under the nearest eligible configuration. This follows `workspace.discovery` and the existing provider constraint while preserving nearest-ancestor, explicit-root, and nested-exclusion behavior. The first report applies to the earlier captured revision and is historical after this correction.

## Independent coverage

The current evaluator assessed all 15 selected component owners in 14 draft files, baseline preservation, AE1/AE2, required-section content, exact Tag selections, byte/scalar/UTF-16 evidence, grouping and Facet ownership, glossary behavior, and retrieval contracts. The two fresh evaluator identities are `/root/implement_u1_designs/u1_evaluate_r1` and `/root/implement_u1_designs/u1_evaluate_r2`; neither inherited conversation or wrote files. No material finding remains in U1.

## Current draft identities

| File | SHA-256 |
| --- | --- |
| `spec/language.sigil` | `d946960460533826793c35b85151f1b03ef193a88c0c0af75e895b5c66f5062c` |
| `spec/glossary.sigil` | `ba4463ffa8df61a06f30efd5bea7c7d542f8935e50c91ee8a8fbc6238fb2008a` |
| `packages/core/config.sigil` | `bada8239d4052d2bc57d8dd3d8a4ea6220243717da51ec737bc755358a892dd2` |
| `packages/core/src/model/_module.sigil` | `0824d7c9b749447ecb6cf286872301da6726f3e6f4c5cf8ef3391838a1d989ac` |
| `packages/core/src/model/configuration.sigil` | `0e42138fa65fcd76ba253608b0f1a0132ef5be0f64d0dc0da5594d7aa8cd7b6b` |
| `packages/core/src/model/diagnostics.sigil` | `2b4ec270a5832b6f4a99785564e65d9056f40502e256169de5faaf5f875495bc` |
| `packages/core/src/model/glossary.sigil` | `c4a42254f6093d5cb490d83509d7bc8a25855dda3c2119a8a3ea34c14c6b3f94` |
| `packages/core/src/model/graph.sigil` | `5f89475ff6dca1db6915a76f52f24144c46c383c444b57177b13f0e86257ff8c` |
| `packages/core/src/model/language.sigil` | `9fee0f67578ae4b7cd3926da44499e7963c37864f9bd74cda12fbaef1c3902f8` |
| `packages/core/src/model/ownership.sigil` | `b49e16306c300636210f679c434dff62c18476375c7cfbdbfb207d562f518861` |
| `packages/core/src/model/resolution.sigil` | `9787510506e65cf21561a4709148c318222b5ca764c0dd484ac12b83565ec99c` |
| `packages/core/src/model/retrieval.sigil` | `df12f721fe00a558f23824f232719f5692d3765e7bd8fddd44c4ff7d9c6890b5` |
| `packages/core/src/model/source.sigil` | `2653029a12401f613db0242421b8cd0e317c9b20698d01345b8a4b738a84362f` |
| `packages/core/src/model/workspace.sigil` | `837225ab4559bad9e0130fa88beacc2934a69de58e2e473a82866a80ee3e0b6c` |

## Authority and limitations

- Shared language-pack manifest: `4cf2ab36e460ff1204dd6d59ad8fe9e399e61a2afe4810ab977638dfb160d441`.
- Evaluator skill: `12fb1f58f77845978228b841375d5ac4e9b4b21fa510a8e45f4e450c4952d839`.
- All five manifest source/output pairs were verified against the adopted specification and installed bundle. The reference differs only through the manifest-declared documentary link transformation.
- Both evaluator dispatches use fresh agents with no inherited conversation. Read-only is an instruction, not an enforced host sandbox.
- No compiler or implementation tests were run: U1 authors specifications awaiting implementation, and legacy 0.7 compiler results cannot validate 0.8 designs. Review does not establish implementation conformance or saturated coherence.
- U2 still owns combined downstream dependency closure, operational diagnostics migration, source discovery and inclusion checks, host/native designs, and the revision-bound pre-implementation gate. This U1 assessment cannot authorize that gate by itself.
