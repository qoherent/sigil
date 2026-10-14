# Current-code compatibility review

This adapts the pre-#67 compiler's `current-code-compatibility` evaluation skill
to the accepted Sigil 0.9 source. It is a read-only assessment inside the
`sigil-align` repair loop; it does not call the compiler.

## Select evidence

Start with the selected Component and its exact accepted source. Read its
relevant Facets, imported Tag definitions, linked adopted policy, and current
source identity. Use the Sigil 0.9 understanding skill for meaning. When a
compatible `sigil retrieve --purpose implementation` is available, use its
results to locate candidate code and tests. A retrieval result or ownership
annotation is a navigation hint, not a code range or proof of coverage.

Inspect the paths that actually produce or consume the Component's promised
behavior. Follow a material path into helpers and dependencies when needed;
include code without annotations. Do not follow importers or unrelated
components merely because they appear nearby. A Tag import supplies a shared
meaning and may broaden design context, but does not itself imply a runtime
call. If selected evidence is insufficient, perform a targeted search and name
the resulting coverage limit. Do not redefine the accepted contract while
evaluating its implementation.

## Diagnose consequential alignment

Assess observable behavior and binding architecture against authored
commitments. Look for implementation drift, missing implementation, ownership
gaps, and incompatibility with accepted contract decisions. Preserve free
implementation choices: the contract need not specify helper structure, caching,
cancellation, or every edge case. Distinguish a confirmed mismatch from missing
evidence and from a possible change to the contract.

For each material finding, report:

1. The Sigil Component, source path, Facet or accepted decision, and commitment.
2. The code and test path or specific search result, with current file identity.
3. The concrete user-visible or architectural consequence.
4. Whether it is confirmed drift, missing implementation, missing evidence, or a
   possible contract change.
5. A focused code repair or next evidence step. Suggest a Sigil revision only
   when a consequential design choice truly remains open.

Say when the selected evidence supports no material finding. State which code
paths and tests were inspected and what remains unverified. A passing test or
ownership comment alone cannot establish conformance.

## Independent review boundary

If the host can delegate, give this reference, the selected source identity,
relevant accepted context, and a bounded workspace to a fresh read-only
evaluator with no inherited conversation. Ask for the diagnostic format above.
The evaluator may inspect source, tests, and local version history, but must not
edit files, run network calls, generate code, or run implementation experiments.
Record whether the host enforces read-only access or merely instructs it. The
`sigil-align` agent checks findings against current evidence, makes determinate
code repairs, runs applicable checks, then requests another read-only assessment
of the changed paths when delegation is available. If delegation is unavailable,
perform the same diagnostic pass directly and disclose that it was not
independent.
