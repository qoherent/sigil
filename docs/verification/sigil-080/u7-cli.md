# U7: CLI language 0.8 migration

CLI parse, check, graph, context, retrieve, render, format and Design export now use the 0.8 core. Context retains complete owner declarations, provider-selected Tags and actual consumer references. Markdown includes consumer contract sections and provider context; retrieval uses the v2 shared presentation model and labels imported annotation scope separately from local groups.

Disk parsing uses strict source capture. Diagnostic display converts byte ranges through the captured source map; implementation coordinates stay separate. Relative path presentation touches structured path metadata and preserves authored text, link destinations and payloads. Invalid UTF-8 export emits no stdout bundle and reports diagnostics on stderr. Representable language-invalid exports retain source and partial diagnostic evidence.

Formatting uses captured providers and verifies all candidate files together before writing. A regression test reproduced the earlier failure where each formatted file still carried another selected file's repairable width error. The fixed batch path preserves imported multiword Tag recognition, supports read-only checking and remains idempotent.

Skill catalog and installation output expose declared compatibility and an explicit `runtimeValidation: "not-run"`. Legacy language/tool requirements are unchanged and visibly incompatible with language 0.8. Documentation follows these command contracts without changing artifact versions early.

## Verification

- CLI suite: 63 tests pass. CLI lint, type checking, formatting and diff whitespace checks pass.
- Real CLI export of the 48-source reviewed root capture passes native scope and Design compilation with report schema 2. With no supplied projections, compilation reports Loose; this proves protocol interoperability, not semantic coherence. Independent example captures were already covered in U6.
- CLI output exactly matches the shared schema-2 native fixture, including original BOM/CRLF, Tag introductions, references, links and payloads.
- Tests cover malformed UTF-8 with empty export stdout, preserved absolute text inside relative output, Unicode scalar diagnostic columns, full provider/consumer context, duplicate identities, exact Tag collisions, ordinary module filenames, removed expand rejection, ownership scope, glossary isolation, formatting transactions and unchanged command/installer lifecycle cases.
- Existing .7 projection scenarios were migrated individually to their .8 counterparts, retaining their test count and failure/identity/selector coverage. Repository-dependent tests now use isolated .8 captures because root activation remains U10. Test fixtures use the real core export rather than fabricated legacy namespaces.
- All 73 design-review inputs and all six excluded user WIP files retain their recorded hashes. No Sigil design or normative authority changed.

U8–U10 still own LSP, VS Code, artifact versions and final actual-root acceptance.
