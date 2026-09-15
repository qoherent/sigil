---
name: sigil-evaluate
description: Review Sigil 0.8 designs for consequential meaning, consistency, ownership, and commitment-preserving simplification. Use for read-only advisory design review, directly or as a delegated evaluator; excludes implementation conformance.
---

# Evaluate Sigil 0.8 design

Review the selected design and relevant provider or linked context. Keep human
contracts compact: implementation freedom and absent optional detail are not
defects. Remain read-only and advisory; the caller owns changes and humans own
unresolved design decisions.

Read [design review](references/design-review.md) before assessing the design.
Use the sibling [understanding guidance](../sigil-understand/references/understanding.md)
and its joint [normative reference](../sigil-understand/references/language/sigil-reference.md)
and [grammar](../sigil-understand/references/language/sigil.ebnf) for Sigil 0.8.0
meaning. Read relevant rules when resolving syntax, Tags, ownership, or links.
The sibling bundle is required; do not replace missing authority with legacy
bootstrap instructions. Neither a compiler nor network access is a prerequisite.

Read the evaluator-owned [review contract](references/review-contract.md) to
receive delegated inputs or return a revision-bound report or portable handoff.
For direct review, its direct-input route preserves the same evidence fields
without creating files. Return exact assessed inputs, material findings, coverage,
and limitations even when findings are empty. Missing evidence, interrupted
execution, and malformed reports cannot become a clean assessment.

Do not modify design files, compare implementation code, invent policy, or claim
compiler validation or saturated coherence. A correction supported by an existing
commitment can be applied by the writer without another approval turn; evaluation
itself performs no correction.
