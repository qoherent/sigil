# Compatibility

| Contract                 | Version | Compatible dependencies                        |
| ------------------------ | ------- | ---------------------------------------------- |
| Sigil                    | 0.8.0   | `.sigil/config.json` sigilVersion 0.8.0        |
| `.sigil/config.json`     | 0.8.0   | core `packages/core/deno.json`                 |
| `@qoherent/sigil-core`   | 0.8.0   | `.sigil/config.json` sigilVersion 0.8.0        |
| `@qoherent/sigil`        | 0.8.0   | core `0.8.x`                                   |
| `@qoherent/sigil-lsp`    | 0.8.0   | core `0.8.x`; LSP 3.18                         |
| VS Code extension        | 0.8.0   | `@qoherent/sigil-lsp` 0.8.x; VS Code `^1.91.0` |
| Coding-agent Sigil skill | 0.10.0  | CLI/core `^0.8.0`; Sigil 0.8.0                 |

The language contract in `spec/language.sigil` owns the Sigil version. Core
exposes that supported language version independently from the core artifact
version owned by `packages/core/deno.json`. A tool must reject a configured
`sigilVersion` it does not explicitly support.
