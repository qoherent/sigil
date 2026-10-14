# Compact authoring with independent review

## Establish the draft

Read the user's intent, selected design, and relevant provider or linked evidence.
Use the sibling understanding skill's language authority and interpretation
boundary. Distinguish authored commitments, supported deductions, unresolved
human choices, and details implementation can choose. Preserve responsibility,
contract roles, Tag identities and ownership when revising. Replacing a
local synonym with its owner's Tag keeps identity; it removes a duplicate.

Take the Tag inventory from [contract prose](contract-prose.md) before drafting.
Reuse and import existing Tags first; define a new Tag only in the Component
that owns its concept.

Draft or revise the requested scope. Keep Goal and Interface meaningful without
adding optional sections, exhaustive cases, helper decomposition, or internal
code structure as completion requirements. Follow [contract prose](contract-prose.md):
every Facet names at least one Tag in its own prose, and each promise uses the
exact Tag and plain relation it is about. An omitted detail warrants a design
question only if evidence shows a consequential behavior or architectural choice
that implementation cannot safely decide within the contract. Consolidate
repetition while retaining independent promises and meaningful constraints.

Record consequential unresolved questions without deciding policy on the user's
behalf. Continue independent supported work before returning those questions.
Do not demand a compiler or claim unobserved validation, implementation conformance,
or saturated coherence from this design workflow.

## Check and format the authored scope

Follow the evaluator-owned [mechanical guidance](../../sigil-evaluate/references/mechanical-validation.md)
to verify CLI compatibility and workspace context. Check the real workspace,
apply supported non-width corrections within the authored scope, format explicit
authored files, and recheck before capture. Let `fmt` repair supported width
errors; submit related authored files together when batch support is available.
Keep completed diagnostics visible, including unrelated errors that block
formatting. Do not broaden writes or change policy to clear them. Continue
meaningful writing and review if tooling or mechanical coverage is unavailable.
Then run the [contract prose](contract-prose.md) checklist over the authored
scope and fix failures in the prose before capture.

## Compute the draft

After the mechanical pass, run the review preparation of
[`sigil-compute-design`](../../sigil-compute-design/references/computed-evaluation.md)
on the original workspace, for the review scope. A new design is drafted first;
computation needs a draft to read. The preparation reuses every valid stored
reading and asks only about units that changed or depend on a change. Its
temporary files and claims cache are its own; it does not touch design sources.

Check the handback before using it. The evidence file's `inputs` must list the
same sources and configuration files, with the same SHA-256, as the workspace
holds now; absent files must still be absent. Its `artifacts` hashes must match
the view, report, and context files. If they differ, the workspace changed
during preparation: run it once more. If it still differs, record computed
coverage as unavailable and continue.

Before capture, apply the Tag order in [contract prose](contract-prose.md) to
every undeclared or unreferenced name the view lists for the authored scope.
The Tag rule determines these corrections, so they need no evaluator finding;
an evaluator that calls such a name ordinary wording does not cancel them.
Recompute after the edit.

If `sigilc` is missing or too old, or the preparation fails, continue the loop
from the sources and record computed coverage as unavailable with the reason.
Do not install a compiler or interpret the prose into claims yourself.

## Capture and delegate

The sibling evaluator's [review contract](../../sigil-evaluate/references/review-contract.md)
is the sole request/report definition. Use its required fields and identity,
mapping, authority, freshness, and handoff rules; do not invent a reduced protocol.

Before dispatch, capture the exact draft, provider/linked context, and intent
bytes in temporary storage outside authored Sigil and source discovery. With
computed evidence, also capture the review view, evidence file, report, and
judgment context, and every source and configuration file the evidence file
lists, at their original relative paths. Record them under the contract's
`computed_evidence`, kept apart from the semantic inputs. Each captured
dependency must have the SHA-256 the evidence file's `inputs` records, and each
file it records as absent must still be absent; otherwise a source changed
after the check, so prepare again before capture. Hash
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
  the change, and check which independent promises it must preserve. Read the
  affected prose yourself first, through the bundle's verified byte range when
  the finding cites aliases, so a misread claim never drives an edit. Apply that
  correction or equivalent simplification autonomously. No user approval is
  needed. Reject unsupported suggestions with a concrete reason; a disposition
  label alone is not authority to rewrite policy.
- **Design choice:** Preserve the affected commitment and state the consequential
  decision still owned by the human. Do not ask them to choose again when the
  supplied intent already determines the correction. When two promises
  contradict each other and no intent chooses between them, both stay in the
  draft with their meaning unchanged, and the conflict goes back to the human
  as a question. Tag corrections to their wording still apply. Deleting both
  sides is not a resolution, and neither is replacing them with a Decisions
  note that the choice is open: Decisions commit nothing.
- **Evidence gap:** Retrieve relevant accessible local or linked context using
  available authorized tools. Add it to captured inputs and delegate again.
  Ask for evidence only after retrieval is unavailable, naming what is missing
  and the meaning it prevents evaluating. Do not infer a missing adopted policy.

Before removing or weakening any promise, name the existing intent or commitment
that authorizes the removal. With none, the promise stays. Never add a promise
that no intent, source, or supported correction states.

For an undeclared or unreferenced name, follow the Tag order in
[contract prose](contract-prose.md): reference or import the existing Tag the
name means, define one Tag in the owner when the name is the subject or object
of a promise and no Tag names it, and leave only context wording as prose. That
the prose reads clearly without a Tag is not a reason to skip one. Do not turn
context phrases into Tags. An unclear owner stays a question for the human.
Never make a name warning go away by deleting the word: dropping the subject or
object of a promise changes the promise and needs an intent that authorizes
it.

An incomplete report can contain supported findings, but cannot certify omitted
scope. Never treat its missing coverage as an empty findings list. Apply only
findings whose evidence and freshness can be established under the shared
contract; preserve the remaining coverage limitation.

After any semantic edit or change to relevant context, repeat the mechanical
pass, compute the draft again, capture, and delegate fresh review.
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
diagnostic or a computed finding is never progress. Do not leave unrelated supported corrections undone
because one finding requires human input.

Finish when a fresh assessment has no actionable material findings, or return
the current work with the exact human decision, unavailable evidence, delegation
failure, or repeated issue that prevents further progress. Every exit includes:

- The current draft or its accessible path and revision identity.
- Every promise removed, weakened, or added, each with its authority. The
  list must describe the edits actually made; a conflict reported as undecided
  must still be present in the draft.
- Resolved findings and how their commitments were preserved; rejected suggestions
  with reasons; remaining findings and their consequence.
- Actual independent review coverage tied to assessed inputs, its freshness, and
  explicit omissions or host limits. Distinguish an earlier reviewed revision
  from a later independently unreviewed revision.
- Mechanical commands, actual scope and input identities, outcomes and diagnostics,
  or the specific reason validation was unavailable; keep these separate from
  independent semantic review coverage.
- The computed state, workspace digest, and coverage of the last computation,
  or why it was unavailable; keep it separate from the advisory findings.
- The precise blocker or question when unfinished, and the shared contract's
  portable handoff with retained exact captures when delegation cannot complete.

Do not call a handoff a review, an incomplete review clean, or advisory findings
an automatic approval gate. Keep review artifacts outside the authored contract.
