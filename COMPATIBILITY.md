# Compatibility

Prepared artifact versions below describe this checkout. Publication is separate;
no release is published by the 0.8 migration.

| Contract | Version | Compatible dependencies |
| --- | --- | --- |
| Sigil language/configuration | 0.8.0 | Explicit `sigilVersion: "0.8.0"` |
| `@qoherent/sigil-core` | 0.8.0 | Sigil 0.8.0 only |
| `@qoherent/sigil` CLI | 0.9.0 | Core 0.8.x |
| `@qoherent/sigil-lsp` | 0.8.0 | Core 0.8.x; UTF-16 LSP |
| VS Code extension | 0.8.0 | Bundled LSP/core 0.8.x; VS Code `^1.91.0` |
| Native `sigilc` | 0.2.0 | Design export schema 2, language 0.8.0, report version 2 |
| Legacy `sigil` skill | 0.9.0 | CLI `^0.8.0`, core `^0.7.0`, native `^0.1.0`, language 0.7.0 |
| `sigil-understand` | 0.1.0 | Sigil 0.8.0 reference pack; no compiler requirement |
| `sigil-evaluate` | 0.1.0 | Sigil 0.8.0; sibling `sigil-understand` |
| `sigil-write` | 0.1.0 | Sigil 0.8.0; both sibling skills |

The language contract owns the supported language version. Manifests own artifact
versions independently. Unsupported workspace versions are rejected; no automatic
converter or 0.7 interpretation is bundled into current tools.

The retained legacy skill is installed as historical material with its frozen
requirements, and is excluded from active root discovery. `sigil skill list`
reports compatibility separately from installation and runtime validation. Its
normal validation is static. Optional old-tool execution requires both
`SIGIL_LEGACY_LANGUAGE` and `SIGIL_LEGACY_COMPILER`; current protocol tests use
separate current binaries and fixed Turtle for all six native states.

Old native captures, bindings, indexes and projections remain stored. Incompatible
artifacts cannot supply current evidence and must be regenerated explicitly; tools
do not delete or translate them. The 0.8 skill reference pack is reproduced from
its recorded sources and digests. Design review is separate from compiler validity
and implementation conformance. See [verification](docs/verification/sigil-080/).
