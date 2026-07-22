# Migrating To Sigil 0.4

Sigil 0.4.0 adds reusable concept identifiers while preserving free-form
authoring and warning-only migration for existing interfaces.

1. Set `sigilVersion` to `0.4.0` in `.sigil/config.json`.
2. Upgrade `@qoherent/sigil-core`, `@qoherent/sigil`, `@qoherent/sigil-lsp`, the
   VS Code extension, and the Sigil skill to compatible 0.4 releases.
3. Run `sigil check .` and inspect each
   `SIGIL_MISSING_CONCEPT_IDENTIFIER` warning. Warnings do not make the command
   fail.
4. Group each interface concept under a concise `ConceptIdentifier { ... }`
   block. A block may name one heavily reused concept or several related lines.
5. Add blocks in `state`, `logic`, `constraints`, or `cases` only when reusing a
   concept across the contract is valuable.
6. Keep identifiers flat, nonempty, unnested, and unique case-insensitively
   across the component, all matching expands, and accessible imported public
   concepts. PascalCase without hyphens or underscores is the preferred style.
7. Reuse imported public concepts by their bare identifiers. Do not add dotted
   notation, aliases, or local shadowing. Interface reuse re-exposes the same
   originating identity downstream.
8. Do not expose or rely on a provider's private expansion concepts through an
   import; select the provider directly when private implementation context is
   needed.
9. Resolve all concept errors and review informational style suggestions.

Existing ungrouped interfaces remain parseable so authors can migrate
incrementally. Concept identifiers do not introduce anchoring behavior.
