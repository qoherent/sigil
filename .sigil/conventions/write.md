# Write instructions: decision structure

These add to the Sigil language rules. They cannot relax one.

A named group in `decisions` records a decision. Write it as separate
paragraphs, each starting with a label:

- `Decision:` states the selected course or outcome whose rationale is being
  recorded. Required.
- `Scope:` states the governed boundary and important exclusions. Required.
- `Assumptions:` states conditions treated as true when making the decision.
  Add it when a condition could change the decision.
- `Trade-offs:` states the benefits, costs, and tensions the decision accepts.
  Add it when a real cost was knowingly taken.
- `Design issues addressed:` states the problems or pressures the decision
  resolves. Add it when the reader could not guess why the decision exists.
- `Discarded alternatives:` states options not selected and why. Add it when
  a reasonable reader would ask "why not X?".
- `Consequences:` states effects and obligations the decision creates. Add it
  when the decision binds work outside its scope.
- `Revisit when:` states the condition that should reopen the decision. Add it
  when the decision is expected to age.

Keep each paragraph to one contribution. Explain important exclusions without
listing every dependent. A binding architecture or technology choice belongs in
Constraints; `decisions` supplies its reason.

A short decision can stay unlabeled outside a named group. Use a group when the
decision should carry the required labels.
