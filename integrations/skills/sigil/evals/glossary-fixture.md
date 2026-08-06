# Reviewed glossary workflow fixture

The workspace contains a valid `.sigil/glossary.json` with workspace terms and
one path-glob-bounded context. Several `.sigil` components use one accepted term
consistently, one alias of a contextual term, one repeated unknown domain term,
and one spelling with conflicting meanings. An accepted component contract
contradicts one glossary definition. Markdown files contain additional
vocabulary but Markdown extraction is deferred. Deterministic glossary
inspection returns zero diagnostics even though the changed Sigil prose still
contains unknown candidate vocabulary requiring model-assisted review. The
written Sigil has not yet passed skill-assisted semantic-readiness review, and
one variant of the fixture requires concept grouping.

Session variants also include an implementation-only change with an existing
GlossaryFile, a correction-required semantic review, and an explicit vocabulary
review request without changed Sigil.

Expected skill behavior:

1. After every approved Sigil write or semantic edit, run deterministic glossary
   inspection and ordinary workspace validation, including when GlossaryFile is
   absent.
2. Treat deterministic inspection and model-assisted candidate extraction as
   separate mandatory stages.
3. Never infer that no glossary changes are needed from zero CLI diagnostics;
   zero diagnostics establish only a valid deterministic projection.
4. Treat CLI success as structural evidence rather than semantic readiness.
5. Do not perform model-assisted extraction while semantic readiness is
   unassessed or correction is required.
6. Run the skill-assisted semantic-readiness review before concept grouping or
   extraction.
7. When grouping is required, wait for the approved grouping change and repeat
   deterministic and semantic review afterward.
8. Perform model-assisted extraction only after the final semantic-readiness
   review appears aligned, regardless of diagnostic count or GlossaryFile
   presence.
9. Treat accepted entries and resolved occurrences as authority, not extraction
   suggestions.
10. Keep concept identifiers and glossary terms as separate identities.
11. Extract candidate vocabulary only from eligible free-form `.sigil` prose.
12. Exclude structural syntax, code fences, inline code, and URLs.
13. Collect source, owner, section, occurrence text, variants, and supported
   meaning for every candidate.
14. Avoid proposing ordinary English merely because it is frequent.
15. Present the conflicting unknown term as a review question rather than
    inventing one merged definition.
16. Treat approved Sigil as normative and propose correction of the conflicting
    glossary entry.
17. Recommend workspace or bounded-context scope from semantic ownership and
    verify that proposed globs do not overlap.
18. Explain any context-local replacement of a workspace spelling.
19. Present canonical term, definition, aliases, scope, evidence, rejected
    alternatives, classification, and exact JSON changes.
20. Submit the exact proposal to `ReviewGate(action: glossary-change)` and leave
    GlossaryFile unchanged until ready.
21. When ReviewGate returns ready, write only the accepted JSON, run
    `sigil glossary` and `sigil check`, inspect occurrences, and report the
    result without another glossary approval gate.
22. Block Sigil review and implementation only when terminology could materially
    change behavior, ownership, state, APIs, or implementation.
23. Allow ordinary unambiguous vocabulary to proceed without requiring a
    glossary entry.
24. When model-assisted extraction finds no material candidate, report the
    changed semantic units and relevant surrounding occurrences inspected
    instead of citing the diagnostic count.
25. Continue to the next applicable ReviewGate action after applying and
    validating an approved glossary change.
26. Before coding, run `sigil context` and include its scoped `glossaryContext`
    in the coding-agent handoff.
27. Supplement that handoff with an accepted request-matched term when needed,
    without injecting unrelated workspace vocabulary.
28. Report Markdown extraction as deferred rather than claiming its vocabulary
    was reviewed.
29. Classify every Sigil session as `extraction required`,
    `extraction deferred`, or `deterministic inspection only`.
30. When GlossaryFile exists, perform deterministic glossary inspection even
    when model-assisted extraction is not triggered.
31. When extraction is triggered but semantic readiness is unassessed or
    correction required, report extraction as deferred and name the blocking
    review state.
32. For an implementation-only or read-only session without a vocabulary-review
    or material-ambiguity trigger, report deterministic inspection only and
    explain that no semantic Sigil lines entered candidate extraction.
33. An explicit vocabulary-review request triggers extraction after semantic
    readiness appears aligned even when no Sigil line changed.
34. Vocabulary review without changed Sigil examines only the selected loaded
    Sigil scope rather than expanding into an unrelated workspace-wide scan.
