# Semantic readiness

Determine whether the selected component is semantically ready for architecture
evaluation and implementation planning. Treat the supplied semantic-purpose
retrieval result as authoritative, including its selected contracts, expansions,
direct relations, glossary evidence, reasons, and exclusions. Inspect selected
evidence paths only to verify a citation or report an explicit retrieval gap; do
not independently traverse the workspace graph.

Evaluate:

- whether the goal names a clear responsibility, boundary, and success outcome;
- ambiguity or contradiction in normative statements and vocabulary;
- materially applicable interface inputs, outputs, failures, side effects,
  lifecycle, ordering, authorization, retry, and compatibility behavior;
- observable cases implied by states, constraints, failure modes, and boundary
  behavior;
- reconstructable rationale for material choices, including consequences and
  rejected alternatives when they matter;
- coherence between the selected component, expands, dependencies, dependency
  decisions, and affected importers.

Treat selected Sigil as the desired contract. Implementation evidence may
clarify a repository capability or expose a possible missing decision, but do
not report a finding solely because current implementation differs, is missing,
or lacks ownership annotations. Report a semantic finding only when the problem
exists independently in the Sigil contract or repository evidence demonstrates
a genuine feasibility constraint. Compatibility behavior in this stage means
compatibility promised by the public contract, not compatibility with current
code. Implementation comparison belongs exclusively to
current-code-compatibility.

Use `SEMANTIC_CONTRADICTION` only after inspecting enough related evidence to
show incompatible normative claims. Use `EVIDENCE_INCOMPLETE` when a suspected
problem cannot be confirmed because material evidence is inaccessible or the
inspection budget is exhausted. A detailed cohesion, coupling, or dependency
direction judgment belongs to architecture-design; report only a semantic gap or
suspected boundary issue here. External standards research belongs to
standards-risk.

Every finding must cite a workspace path and exact reproducible evidence. Do not
edit files, use the network, run another compilation, generate code, or perform
implementation experiments.
