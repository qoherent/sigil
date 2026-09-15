# Compact authoring with independent review

## Establish the draft

Read the user's intent, selected design, and relevant provider or linked evidence.
Use the sibling understanding skill's language authority and interpretation
boundary. Distinguish authored commitments, supported deductions, unresolved
human choices, and details implementation can choose. Preserve responsibility,
contract roles, Tag identities and ownership when revising.

Draft or revise the requested scope. Keep Goal and Interface meaningful without
adding optional sections, exhaustive cases, helper decomposition, or internal
code structure as completion requirements. An omitted detail warrants a design
question only if evidence shows a consequential behavior or architectural choice
that implementation cannot safely decide within the contract. Consolidate
repetition while retaining independent promises and meaningful constraints.

Record consequential unresolved questions without deciding policy on the user's
behalf. Continue independent supported work before returning those questions.
Do not demand a compiler or claim compiler validation, implementation conformance,
or saturated coherence from this design workflow.

## Capture and delegate

The sibling evaluator's [review contract](../../sigil-evaluate/references/review-contract.md)
is the sole request/report definition. Use its required fields and identity,
mapping, authority, freshness, and handoff rules; do not invent a reduced protocol.

Before dispatch, capture the exact draft, provider/linked context, and intent
bytes in temporary storage outside authored Sigil and source discovery. Hash
the saved bytes using host tools and retain their original locations and source
root. Preserve relative layout where possible; retain explicit mappings even
then. Capture conversational intent as an identified immutable input. Include
the evaluator skill identity and shared language-pack manifest identity. Resolve
imports and links from their original locations, including links outside the
workspace, before mapping them to captures.

Invoke a fresh, separate evaluator sub-agent after each new draft or semantic
revision. Supply the evaluator entrypoint, complete request and read-only
instructions, scope, original resolution mapping, and accessible context
locations. Record actual host restrictions, including when read-only is only an
instruction. The writer alone edits design sources. Give the evaluator no
inherited conversation to rely on, no acceptance notes, no desired verdict, and
no argument defending the draft. If the host cannot disable inheritance, make
the captured request the sole evidence authority and disclose that host limit.

Keep the returned report as evidence; dispatch success is not review completion.
Validate the actual report against the shared contract, including required
fields, actual assessed input identities, correction authority, and coverage.
An interrupted, missing, malformed, or unverifiable report leaves independent
coverage incomplete. A bounded retry with a fresh evaluator is appropriate when
the host can recover; otherwise use the contract's portable handoff. Never
replace unavailable delegation with a same-agent assessment.

## Check freshness, then act

Before using any finding to edit or claiming current coverage, compare every
current draft, intent, provider, linked source, and authority identity against
the actual assessed inputs. Verify original path mapping and resolution root.
Include additional evidence the evaluator retrieved. For new in-place context,
preserve and verify its exact bytes as the shared contract requires. A changed
provider can invalidate a report even if the draft is unchanged.

Missing identities or changed bytes, authority, or resolution make the review
stale. Capture the current inputs and delegate a fresh assessment before applying
its suggestions. Do not use stale findings as editing instructions. If inputs
keep changing and a stable review cannot finish, return the exact limitation
with the latest draft and available handoff.

For a valid, fresh report, evaluate each suggestion against its cited evidence:

- **Determined correction:** Confirm the authorizing commitment actually settles
  the change, and check which independent promises it must preserve. Apply that
  correction or equivalent simplification autonomously. No user approval is
  needed. Reject unsupported suggestions with a concrete reason; a disposition
  label alone is not authority to rewrite policy.
- **Design choice:** Preserve the affected commitment and state the consequential
  decision still owned by the human. Do not ask them to choose again when the
  supplied intent already determines the correction.
- **Evidence gap:** Retrieve relevant accessible local or linked context using
  available authorized tools. Add it to captured inputs and delegate again.
  Ask for evidence only after retrieval is unavailable, naming what is missing
  and the meaning it prevents evaluating. Do not infer a missing adopted policy.

An incomplete report can contain supported findings, but cannot certify omitted
scope. Never treat its missing coverage as an empty findings list. Apply only
findings whose evidence and freshness can be established under the shared
contract; preserve the remaining coverage limitation.

After any semantic edit or change to relevant context, delegate fresh review.
Freshness uses exact bytes, so recapture and reassess changed files even when an
edit appears cosmetic before claiming that their current bytes were reviewed.

## Track progress and stop accurately

Keep a short temporary history keyed by **affected commitment and consequence**,
not diagnostic ID or wording. Record the finding's evidence, disposition, action
or rejection reason, the promises preserved, and the input revision. A reworded
diagnostic about the same promise and consequence is the same issue. Compare
successive states to recognize corrections that undo each other.

Continue while a justified correction or accessible evidence can advance the
design. If the same issue remains after an attempted correction without new
evidence, or proposed edits oscillate between previous states, stop that cycle.
Explain the remaining issue and why another pass cannot resolve it. A rejected
unsupported suggestion need not be repeatedly retried on identical inputs;
retain its reason in the outcome. Removing an obligation solely to eliminate a
diagnostic is never progress. Do not leave unrelated supported corrections undone
because one finding requires human input.

Finish when a fresh assessment has no actionable material findings, or return
the current work with the exact human decision, unavailable evidence, delegation
failure, or repeated issue that prevents further progress. Every exit includes:

- The current draft or its accessible path and revision identity.
- Resolved findings and how their commitments were preserved; rejected suggestions
  with reasons; remaining findings and their consequence.
- Actual independent review coverage tied to assessed inputs, its freshness, and
  explicit omissions or host limits. Distinguish an earlier reviewed revision
  from a later independently unreviewed revision.
- The precise blocker or question when unfinished, and the shared contract's
  portable handoff with retained exact captures when delegation cannot complete.

Do not call a handoff a review, an incomplete review clean, or advisory findings
an automatic approval gate. Keep review artifacts outside the authored contract.
