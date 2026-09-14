# Migrating To Sigil 0.4

Sigil 0.4 introduced reusable Concept identifiers. Current canonical language
clarifies that they are optional grouping, not a migration requirement for
ungrouped Interface Facets. Earlier guidance requiring those wrappers is
superseded by [the language specification](sigil-reference.md).

1. Use matching core, CLI, LSP, extension, and skill versions for the selected
   workspace language version.
2. Keep Facets directly under any contract when no grouping is needed. A contract
   may mix those Facets with Concept-grouped Facets without a warning.
3. Add a Concept identifier when it usefully connects the same idea across
   contracts, especially when a component describes several concepts. Do not
   repeat a single-concept component's identity just to wrap its Facets.
4. Keep grouping blocks flat and nonempty. They retain their bare heading
   syntax as Concept Tags in the [Tag revision](migrating-to-0.8.md).
5. Reuse accessible imported public identities instead of inventing equivalent
   local names. Preserve provider identity and consumer contribution context.
6. Imports expose public vocabulary, not a provider's private operational
   Facets. Select the provider directly when private context is needed.
7. Resolve actual malformed-block and identity-ambiguity diagnostics. Ungrouped
   Facets are not malformed and do not require warning repair.

Concept identifiers provide semantic grouping across contracts. They do not
make Facets valid, introduce another component, or establish behavioral equality.
