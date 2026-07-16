# Compatibility

| Contract          | Version | Compatible dependencies                  |
| ----------------- | ------- | ---------------------------------------- |
| Sigil             | 0.1.0   | `.sigil/config.json` sigilVersion 0.1.0  |
| `.sigil/config.json`    | 0.1.0   | core `packages/core/deno.json`           |
| `@qoherent/sigil-core` | 0.1.0 | `.sigil/config.json` sigilVersion 0.1.0 |
| `@qoherent/sigil`      | 0.1.0 | core `0.1.x`                              |
| `@qoherent/sigil-lsp`  | 0.1.0 | core `0.1.x`; LSP 3.18                   |
| VS Code extension      | 0.1.0 | `@qoherent/sigil-lsp` 0.x; VS Code `^1.91.0` |
| Codex Sigil skill | 0.1.0   | CLI/core `^0.1.0`; Sigil 0.1.0 |

The Sigil version is canonical in `packages/core/deno.json`; a tool must reject
a configured `sigilVersion` it does not explicitly support.
