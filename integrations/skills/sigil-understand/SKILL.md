---
name: sigil-understand
description: Explain Sigil 0.8 design intent, contract roles, Tag ownership, and relevant context from source. Use for understanding a design; writing and advisory evaluation have separate skills.
---

# Understand Sigil 0.8

Explain the selected design at the user's requested scope. Use available source
and linked or provider context; no compiler, repository checkout, network access,
or legacy skill bootstrap is required to read the bundled language authority.
Missing project context remains a stated limitation.

Read [understanding](references/understanding.md) for the interpretation boundary.
The [language reference](references/language/sigil-reference.md) and
[grammar](references/language/sigil.ebnf) jointly define Sigil 0.8.0. Read the
relevant rules before deciding syntax, resolution, or ownership. The
[guide](references/language/sigil-language.md) supplies examples and authoring
advice; it adds no language requirements. For discovery questions, use the
[configuration reference](references/language/sigil-config.md) and
[schema](references/language/sigil-config.schema.json).

Describe responsibility and observable commitments, preserving their component
owner and contract role. Separate authored commitments, supported deductions,
unresolved intent, and implementation choices. Keep a compact design compact:
optional sections, Tags, exhaustive edge cases, helper decomposition, and a
mapping to each code declaration are not completion requirements.

Do not run or claim 0.8 compiler validation through legacy 0.7 tooling. The
configuration examples still describe the implemented 0.7 version; their
workspace discovery rules apply without changing the current workspace version.
Do not import legacy expansion, public namespace, or module-index rules into 0.8.

Return a concise explanation with evidence anchors and material limitations.
Understanding does not modify the source, establish implementation conformance,
or prove saturated coherence. Use the separately callable sibling capabilities
when the task requests writing or design evaluation.

The generated [source manifest](references/language/manifest.json) records exact
source/output digests and the upstream revision used for optional background
links. Bundled language and configuration references work offline. Background
links do not require retrieval for ordinary interpretation.
