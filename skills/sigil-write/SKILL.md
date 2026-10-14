---
name: sigil-write
description: Create or revise compact Sigil 0.9 designs from intent and evidence, with independent delegated design review and autonomous intent-preserving corrections. Use for authoring; understanding and read-only evaluation have separate skills.
---

# Write Sigil 0.9

Write the smallest clear contract that preserves the user's consequential intent.
Read the sibling [understanding guidance](../sigil-understand/references/understanding.md)
and relevant rules in the joint [normative reference](../sigil-understand/references/language/sigil-reference.md)
and [grammar](../sigil-understand/references/language/sigil.ebnf) before authoring.
These installed siblings supply 0.9.0 authority; do not substitute legacy rules
or require a functioning compiler.

Write prose the claims check can read, as described in
[contract prose](references/contract-prose.md). Every Facet must reference or
define at least one Tag in its own prose; a group heading does not count.
Choose at least one Tag from a meaningful subject or object in each Facet;
do not reuse the group label automatically.
List existing Tags and named interactions before drafting. Reuse a local Tag
first, then import it from its owning Component, and define a new Tag only when
no existing Tag names the concept. In files you edit, replace a local synonym
of another Component's Tag with an import from its owner.

Read [the writing loop](references/writing-loop.md) before drafting. It consumes
the evaluator-owned [review contract](../sigil-evaluate/references/review-contract.md);
read that contract before preparing any review request or using a report.
Use the shared [mechanical validation](../sigil-evaluate/references/mechanical-validation.md)
guidance to check, apply supported fixes, format only authored files, and recheck
before capture. Use compatible available tooling; otherwise continue and report
mechanical validation as unavailable.
After a new draft or semantic revision, compute it with the review preparation
of the sibling [computed evaluation](../sigil-compute-design/SKILL.md) skill,
capture the resulting review bundle with the draft, and invoke a fresh
read-only sub-agent using the sibling [evaluator](../sigil-evaluate/SKILL.md)
and those exact captured inputs. When computation is unavailable, continue
and report it unavailable.
The host supplies delegation; this skill adds no model runtime or service.

Apply supported corrections and commitment-preserving simplifications without
another approval request. Retrieve accessible missing evidence yourself. Preserve
consequential undecided policy for the human and stop repeated or oscillating
findings with the issue visible. Never delete a meaningful promise, or a word
the check flags, to silence review or a computed finding. Remove or weaken a promise only with an intent that
authorizes it, keep promises that contradict each other and ask the human, and
add no promise that no intent or source states.

Return the current draft, the Tags it reused, imported, and newly defined,
resolved and remaining findings, the last computed state and coverage, and
actual fresh review coverage. If
delegation is unavailable or incomplete, return an independently unreviewed
draft and portable handoff; a same-agent pass cannot replace it.
