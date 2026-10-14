# Component-rooted alignment loop

## Establish scope and evidence

Before each implementation mutation, identify the selected Component, owning
Sigil file, accepted revision, and any explicit user decisions. Read its Facets
and context needed to understand them: relevant Tag providers and linked adopted
policy. Use `sigil-understand` to distinguish authored commitments, supported
consequences, unresolved intent, and free implementation choices. A Tag import
shares vocabulary; it does not establish a runtime call or transfer Facet
ownership. Do not apply legacy 0.7 expansion or module-index rules.

When a compatible CLI is available, use
`sigil retrieve . --component Name
--purpose implementation --format markdown`
to find candidate implementation and tests. Inspect the actual code paths that
produce or consume the promised behavior, including relevant helpers and tests
across files. Follow evidence outside an annotated file when the selected
behavior does. `@sigil implements` and retrieval results point to places to
inspect; neither proves coverage, correct behavior, or an exclusive code range.
Include relevant code with no annotation when behavior leads there. Bound the
search by the selected Component's commitments and actual runtime relationships;
inspect related components only where their behavior affects those commitments.

Compare observable results, state transitions, permissions, failure behavior,
and binding architecture or ownership against the contract. A material promise
needs a credible implementation path; it need not have a matching code
declaration. Do not demand particular storage, cancellation, helper structure,
or exhaustive cases when the contract allows alternatives. An untested path is
not automatically absent behavior; inspect it or obtain focused evidence.

## Classify and act

For every material finding record:

| Field            | Record                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Contract anchor  | Source path, Component, Facet or accepted decision, and the exact commitment at issue.                          |
| Observation      | Code and test paths or concrete missing-path search, with current source identity.                              |
| Consequence      | The user-visible behavior or binding architecture affected.                                                     |
| Class and action | Confirmed drift, missing implementation, missing evidence, or possible contract change; the next concrete step. |

Retrieve accessible evidence that could resolve uncertainty before escalating
it. Classify missing evidence separately from a confirmed defect. If the
accepted commitment determines the result, fix confirmed drift, missing
behavior, and code ownership violations in the relevant code. Add or update a
focused regression test for changed behavior. Inspect the repository's tasks and
affected dependents to choose applicable focused, integration, regression,
build, and static checks. Run those checks, record actual outcomes and
unavailable prerequisites, then inspect the repaired path again. Repeat while
actionable defects remain. Do not use a passing test or annotation alone to
close a finding.

Stop reassessing a finding when it repeats on identical contract, code, and test
inputs, when a reasoned rejection receives no new evidence, or when another
repair would return to a previously assessed code state without new evidence. Do
not flip the code back to satisfy the repeated finding. Record the evaluator's
anchor, observation, and proposed repair alongside the contrary source, code,
and test evidence and the reason for stopping. Report the disagreement as
unresolved; resume that finding only when evidence or an accepted decision
changes.

If evidence implies a different consequential promise and accepted intent does
not determine whether to adopt it, keep the current contract intact. Complete
other determinate repairs and tests first. Ask the user for the narrow choice:
the current promise, the proposed alternative, observable trade-offs, and what
remains undecided. Do not ask the user to settle a code-only defect or choose an
optional implementation mechanism.

## Pause, resume, and report

A pending decision carries the selected Component and owning source; exact
contract, relevant code/test, linked-policy, and scope identities (paths and
content digests or immutable revisions); the finding and alternatives; repairs
already made; check results; and remaining work. Keep this in the handoff. On
resumption, read the current sources and user answer, compare identities,
refresh changed evidence, and reconsider whether the choice remains open. If a
consequential revision is still authorized, use `sigil-write` and its
independent design review, then repeat implementation alignment against the
revised contract.

At every exit, report the Component and actual files/behavior reviewed, code
changes, resolved and remaining anchored findings, checks actually run with
results, and coverage limits. Separate observed code behavior from test
evidence. State a remaining decision or evidence gap precisely; do not call the
component fully aligned while a material gap is open.
