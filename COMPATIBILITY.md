# Compatibility

| Contract          | Version | Compatible dependencies                  |
| ----------------- | ------- | ---------------------------------------- |
| Sigil Language    | 1.0.0   | config schema 1.0.0; core 1.x            |
| `sigil.config`    | 1.0.0   | language 1.0.0; core 1.x                 |
| `@sigil/core`     | 1.0.0   | config 1.0.0; language 1.0.0             |
| `@sigil/cli`      | 1.0.0   | core `^1.0.0`                            |
| `@sigil/lsp`      | 1.0.0   | core `^1.0.0`; LSP 3.18                  |
| Codex Sigil skill | 1.0.0   | CLI/core `^1.0.0`; config/language 1.0.0 |

These contracts start aligned at 1.0.0 but release independently. A tool must
reject configured versions it does not explicitly support.
