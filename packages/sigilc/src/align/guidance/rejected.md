# Refused or incomplete answers

Return only `element`, `realizes`, `act`, `measure` data rows. A rule, declaration,
law, variable, or executable form refuses the artifact. Unknown row shapes,
wrong arity, unknown element kinds, relations, or measures refuse the file.
Do not return design `claim`, `property`, `reading`, or flow rows.

Every row referring to a local element must have an element declaration in the
same file answer. An empty answer, or rows without any element, leaves the file
unread. Use nonempty local names and finite numeric measure values.

Unknown design names are refused. An ambiguous bare label is refused with its
qualified alternatives; use the component-qualified name from the request.
An element in another file is never an act target. Do not use a path to infer
membership or copy a mapping from an annotation.

An unmapped element is accepted as honest evidence of undesigned work. It is
not an admission error. A whole-file reading cannot silently skip such work.
