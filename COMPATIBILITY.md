# Compatibility

| Contract          | Version | Compatible dependencies                  |
| ----------------- | ------- | ---------------------------------------- |
| Sigil Language    | 1.0.0   | config schema 1.0.0; core 1.x            |
| `sigil.config`    | 1.0.0   | language 1.0.0; core 1.x                 |
| `@qoherent/sigil-core` | 0.1.0 | config 1.0.0; language 1.0.0             |
| `@qoherent/sigil`      | 0.1.0 | core `0.1.x`                              |
| `@qoherent/sigil-lsp`  | 0.1.0 | core `0.1.x`; LSP 3.18                   |
| VS Code extension      | 1.0.0 | `@qoherent/sigil-lsp` 0.x; VS Code `^1.91.0` |
| Codex Sigil skill | 1.1.0   | CLI/core `^1.0.0`; config/language 1.0.0 |

These contracts start aligned at 1.0.0 but release independently. A tool must
reject configured versions it does not explicitly support.
