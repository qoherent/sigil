---
name: sigil-align
description: Review and repair implementation of a selected Sigil 0.9 Component against its accepted contract. Use for implementation conformance, code drift, ownership gaps, and verification; use sigil-evaluate for read-only design review.
---

# Align a Sigil 0.9 implementation

Start with one Component selected explicitly or unambiguously by the task and
its accepted Sigil source. If the target or accepted contract cannot be
identified, obtain that identity before assessing alignment. Read the sibling
[understanding skill](../sigil-understand/SKILL.md) and its
[interpretation guidance](../sigil-understand/references/understanding.md) for
contract meaning. Read the
[current-code compatibility review](references/implementation-evaluation.md) and
[alignment loop](references/alignment-loop.md) before editing code.

Own the implementation review, code repair, and verification. Inspect relevant
code and tests across files; use ownership annotations and retrieval as
navigation, not proof. When the host can delegate, obtain a fresh, read-only
current-code compatibility assessment. Check its findings against current
evidence. Leave implementation choices open when the contract does not select
them. Repair defects settled by the accepted contract, add focused tests for
changed behavior, run relevant checks, and reassess without a separate approval
step. Repeat the read-only assessment for changed paths when delegation is
available.

Use contract, code, and test evidence for this advisory skill. Explicit computed
implementation checks belong to `sigil-compute-align`, which owns the
`sigilc align` loop.

Only a consequential contract choice not settled by accepted intent belongs to
the user. Finish independent code work, present the smallest choice and its
trade-offs, and preserve source identities for resumption. On return, reread
current sources before using the answer. Route an authorized contract revision
through [sigil-write](../sigil-write/SKILL.md), including its independent
[sigil-evaluate](../sigil-evaluate/SKILL.md) design review, then reassess the
implementation. The evaluator itself remains read-only and design-only.

Return the reviewed Component and evidence scope, code changes, resolved and
remaining findings, checks actually run and their results, and specific coverage
limits. Do not claim full alignment from an annotation or passing tests alone.
