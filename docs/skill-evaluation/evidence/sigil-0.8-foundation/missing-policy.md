```yaml
protocol: sigil-design-review/v1
status: incomplete
scope:
  purpose: Design-only assessment of ExportArchive retention commitments, including adopted policy.
  source_root: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-E
assessed_inputs:
  - role: draft
    original_path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-E/archive/export.sigil
    captured_path: null
    capture_mode: in_place
    sha256: e2339f42982bdd7152ad07ef9752db182f56cd70c78af5340e881ecac8e35109
authority:
  evaluator:
    path: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/skills/sigil-evaluate/SKILL.md
    sha256: 12fb1f58f77845978228b841375d5ac4e9b4b21fa510a8e45f4e450c4952d839
  language_pack:
    version: 0.8.0
    manifest: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/skills/sigil-understand/references/language/manifest.json
    sha256: 4cf2ab36e460ff1204dd6d59ad8fe9e399e61a2afe4810ab977638dfb160d441
  consulted:
    - evaluator references/design-review.md
    - evaluator references/review-contract.md
    - sibling understanding guidance
    - normative reference contract.role, facet.link, interpretation.evidence
    - normative sigil.ebnf
findings:
  - id: E1
    location: archive/export.sigil:9, ExportArchive.constraints
    evidence:
      input_sha256: e2339f42982bdd7152ad07ef9752db182f56cd70c78af5340e881ecac8e35109
      text: "Delete expired exports according to the adopted [retention policy](../policy/retention.md)."
      related_anchors:
        - "Line 3: Keep completed exports available for later download."
        - "Line 6: Let an authorized user download a retained export."
      missing_target: /var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/direct-E/policy/retention.md
      verification: Reading the resolved target returned FileNotFoundError.
    consequence: >
      The expressly adopted policy is necessary to determine expiration and
      required deletion behavior. Earlier versus later deletion changes download
      availability; implementation cannot choose a retention rule safely because
      the contract delegates that rule to the unavailable policy. Retention
      consistency therefore cannot be assessed.
    priority: medium
    priority_rationale: Material missing evidence prevents interpretation of an explicit commitment; no incompatible policy has been established.
    suggestion: Supply the adopted policy at the resolved target, or its exact authoritative content and original-location mapping, then reassess the combined commitments.
    disposition: evidence_gap
    authorizing_commitment: null
coverage:
  assessed:
    - ExportArchive owns the goal, download interface, and deletion constraint.
    - Goal promises completed-export availability for later download.
    - Interface permits authorized users to download retained exports.
    - Constraint explicitly adopts the linked policy for expired-export deletion.
    - Link resolves from archive/export.sigil's directory to policy/retention.md.
  unresolved:
    - Policy-defined expiration and deletion obligations.
    - Compatibility of those obligations with retained-export download availability.
  conclusion: Available source contains no established contradiction; affected retention scope cannot be called clean.
limitations:
  - Adopted policy is missing; no target byte identity could be established.
  - Assessment is bound to the listed in-place source bytes and authority identity.
  - Read-only restriction was instruction-only; host restrictions did not enforce it. No writes were performed.
  - Reads were confined to the supplied workspace and installed evaluator/understanding entrypoints and references.
  - No compiler, network, repository access, or evaluation-fixture content was used.
  - No implementation conformance or saturated coherence is established.
```
