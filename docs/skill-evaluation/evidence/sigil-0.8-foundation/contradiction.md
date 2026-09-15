```yaml
protocol: sigil-design-review/v1
status: complete
scope:
  purpose: Design-only review of SearchPanel against adopted publication intent.
  source_root: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-B
  capture_mode: in_place

assessed_inputs:
  - role: intent
    original_path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-B/intent.md
    captured_path: null
    capture_mode: in_place
    sha256: efcce47949dd79ea89e935fe82b16212057bab4584e50e41c2774a098681235f
  - role: draft
    original_path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-B/search/panel.sigil
    captured_path: null
    capture_mode: in_place
    sha256: fba681678b572e29c032dd39e382f7f35102829ae1986144c9e1f019fc78c6a2

authority:
  evaluator_entrypoint:
    path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/skills/sigil-evaluate/SKILL.md
    sha256: 12fb1f58f77845978228b841375d5ac4e9b4b21fa510a8e45f4e450c4952d839
  language_pack_manifest:
    path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/skills/sigil-understand/references/language/manifest.json
    sha256: 4cf2ab36e460ff1204dd6d59ad8fe9e399e61a2afe4810ab977638dfb160d441
    sigil_version: 0.8.0
    upstream_revision: 28ff9851a50032c2f6be9140c48a23d9d8f8a9c8
  consulted_references:
    - file: sigil-evaluate/references/design-review.md
      sha256: 12d5d346e87480b91534e891cdc690eb032d3a61ea7b4cf38f9aaa33ab04b358
    - file: sigil-evaluate/references/review-contract.md
      sha256: 75644d94e30fe530dba483dc99b927ec24e010bfefca8d76ac07aefe10313a21
    - file: sigil-understand/references/understanding.md
      sha256: 0042c8f06992c3da9783a0333a67600611edc76ae238f71b11ca95181af6501c
    - file: sigil-understand/references/language/sigil-reference.md
      sha256: a20be69c15bfeee2e4ca4d41b8bfc82f9eef75fa98cf4cb85681cb7af4606d5e
    - file: sigil-understand/references/language/sigil.ebnf
      sha256: 0b172dcb45b4a4065ca07c8a91fbc12ec08a70430ea9b3397574a16995c5bac2
  reference_root: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/skills
  relevant_rules:
    - Contract order has no overriding effect.
    - Constraints express binding invariants; Cases express scenario observations.
    - Incompatible adopted requirements remain a semantic conflict.

findings:
  - id: SP-1
    location: search/panel.sigil:8-14, SearchPanel constraints and cases
    evidence:
      - input: draft, sha256 fba681678b572e29c032dd39e382f7f35102829ae1986144c9e1f019fc78c6a2
        anchor: search/panel.sigil:9-10
        quote: |
          Only the active request may publish results.
          Cancelling a request immediately makes it inactive.
      - input: draft, same verified identity
        anchor: search/panel.sigil:13-14
        quote: |
          A cancelled request completes after its replacement starts;
          the cancelled request may publish its results.
      - input: intent, sha256 efcce47949dd79ea89e935fe82b16212057bab4584e50e41c2774a098681235f
        anchor: intent.md:1-3
        quote: |
          Adopted product intent: only the active request may publish results. Cancelling
          a request immediately makes it inactive. Preserve this invariant when revising
          the draft.
    consequence: The case permits publication by an inactive cancelled request, directly violating the invariant and allowing obsolete results to appear after a replacement search starts.
    priority: high
    priority_reason: Consequential incompatible publication promises.
    suggestion: Change the case outcome to “the cancelled request must not publish its results.” Preserve the scenario, immediate cancellation effect, and active-request publication invariant.
    disposition: determined_correction
    authorizing_commitment: intent.md:1-3 explicitly adopts and requires preservation of the invariant; search/panel.sigil:9-10 repeats it. These commitments determine rejection of cancelled-request publication.

coverage:
  - Reviewed SearchPanel goal, interface, constraints, and case against the supplied intent.
  - Assessed publication eligibility, immediate cancellation, and completion after replacement.
  - SearchPanel owns all four contributions; no imports or Inline Links require additional context.
  - No missing optional contracts or implementation mechanisms were treated as defects.

limitations:
  - Read-only restriction was instructions only; no source edits or report files were made.
  - Review is bound to the listed in-place byte identities; reuse requires freshness checks.
  - No compiler, implementation, network, repository, or evaluation fixture content was used.
  - No compiler validation, implementation conformance, or saturated coherence is established.
```
