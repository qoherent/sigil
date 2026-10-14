---
name: sigil-evaluate
description: Review Sigil 0.9 designs for consequential meaning, consistency, ownership, and commitment-preserving simplification. Use for read-only advisory design review, directly or as a delegated evaluator; excludes implementation conformance.
---

# Evaluate Sigil 0.9 design

Review the selected design and relevant provider or linked context. Keep human
contracts compact: implementation freedom and absent optional detail are not
defects. Remain read-only and advisory; the caller owns changes and humans own
unresolved design decisions.

Start from computed claims when they are available. A delegated request may
supply a frozen review bundle; use it and run no computation. For direct
review, first run the review preparation of the sibling
[computed evaluation](../sigil-compute-design/SKILL.md) skill for the review
scope. It may write temporary files and the claims cache, never design
sources. Read the bundle's compact view whole instead of the source files, and
read only the prose your judgment needs, in one batch, through its verified
byte ranges; the design review reference shows how. When computation is
unavailable, review from the sources and say computed coverage is unavailable.

Read [design review](references/design-review.md) before assessing the design.
Use the sibling [understanding guidance](../sigil-understand/references/understanding.md)
and its joint [normative reference](../sigil-understand/references/language/sigil-reference.md)
and [grammar](../sigil-understand/references/language/sigil.ebnf) for Sigil 0.9.0
meaning. Read relevant rules when resolving syntax, Tags, ownership, or links.
The sibling bundle is required; do not replace missing authority with legacy
bootstrap instructions. Neither a compiler nor network access is a prerequisite.

Read [mechanical validation](references/mechanical-validation.md) and use a
verified compatible CLI for `check` and `fmt --check` when available. Keep
mechanical observations revision-bound and separate from semantic findings;
otherwise continue review and report the specific unavailable validation.

Read the evaluator-owned [review contract](references/review-contract.md) to
receive delegated inputs or return a revision-bound report or portable handoff.
For direct review, its direct-input route preserves the same evidence fields
in place, creating no files beyond the computed-evidence preparation above.
Return exact assessed inputs, material findings, coverage, and limitations even
when findings are empty. Missing evidence, interrupted
execution, and malformed reports cannot become a clean assessment.

Do not modify design files, compare implementation code, invent policy, or claim
unobserved mechanical validation or saturated coherence. Keep the computed state
and coverage separate from advisory findings. A correction supported
by an existing commitment can be applied by the writer without another approval
turn; evaluation itself performs no correction.
