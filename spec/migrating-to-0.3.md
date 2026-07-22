# Migrating To Sigil 0.3

Sigil 0.3.0 makes module indexes responsibility-bearing and clarifies the public
component contract.

1. Set `sigilVersion` to `0.3.0` in `.sigil/config.json`.
2. Upgrade `@qoherent/sigil-core`, `@qoherent/sigil`, `@qoherent/sigil-lsp`, the
   VS Code extension, and the Sigil skill to compatible 0.3 releases.
3. Add at least one meaningful local component to every `#module.sigil`.
   Imports-only indexes now produce `SIGIL_MODULE_WITHOUT_COMPONENT`.
4. Treat both `goal` and `interface` as public to component dependents.
5. Remove dependency declarations such as `depends on` and `uses` from
   interfaces; the corresponding imports declare those dependencies.
6. Move implementation-hiding and forbidden-access rules to `constraints`
   unless they define an externally observable promise.
7. Separate distinct prose-level ideas with blank lines in every section while
   keeping compact constructs such as type shapes and ASCII diagrams together.
8. Run `sigil check . --format json --pretty` and resolve all diagnostics.

Explicit file imports and directory-import surface resolution otherwise retain
their Sigil 0.2 behavior.
