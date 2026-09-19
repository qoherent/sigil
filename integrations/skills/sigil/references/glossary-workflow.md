<!-- @sigil implements integrations/skills/sigil/glossary-workflow.sigil::SigilGlossaryWorkflow::GlossaryWorkflow interface,logic,constraints,cases -->

# Glossary workflow

Use glossary extraction when the user requests vocabulary work or terminology
ambiguity materially affects the task. State whether extraction is required,
deferred, or inspection-only when relevant. Honor explicit session scope; routine
inspection or code edits do not require a glossary rewrite.

Inspect with `sigil glossary . --format json` and `sigil check . --format json`.
Review definitions, aliases, bounded-context path scopes, source occurrences, and
collision/overlap diagnostics. An absent glossary is valid; malformed definitions
must not be treated as accepted authority. Zero diagnostics prove neither complete
vocabulary nor absence of semantic conflicts.

For extraction, inspect selected authored prose and relevant existing terms.
Exclude language syntax, code literals, URLs, and Concepts as automatic candidates.
Give each candidate its actual occurrences, proposed meaning, and appropriate
workspace or bounded-context scope. A no-candidate conclusion needs prose
inspection, not a diagnostic count. Ordinary unambiguous words need no entry.

Resolve material conflicting meanings from the normative contract and user intent.
Do not silently change the contract to match a glossary definition. Concept
identity and glossary meaning are separate. Repeated usage or a model suggestion
does not automatically become accepted authority.

Make exact authorized JSON changes, preserve unrelated terms and nonoverlapping
context scopes, then validate. Refresh structural Design export and affected
native projections after a glossary change. Existing user authorization persists;
there is no additional glossary compiler stage or automatic approval gate.

Use relevant scoped vocabulary in coding context via language retrieval. Keep
independent Implementation workers restricted to native prepared source, ontology,
and catalog; do not append glossary or Design prose as extra inputs.
