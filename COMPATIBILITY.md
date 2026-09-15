# Compatibility

| Contract                 | Version | Compatible dependencies                        |
| ------------------------ | ------- | ---------------------------------------------- |
| Sigil                    | 0.7.0   | `.sigil/config.json` sigilVersion 0.7.0        |
| `.sigil/config.json`     | 0.7.0   | core `packages/core/deno.json`                 |
| `@qoherent/sigil-core`   | 0.7.1   | `.sigil/config.json` sigilVersion 0.7.0        |
| `@qoherent/sigil`        | 0.7.1   | core `0.7.x`                                   |
| `@qoherent/sigil-lsp`    | 0.7.1   | core `0.7.x`; LSP 3.18                         |
| VS Code extension        | 0.7.1   | `@qoherent/sigil-lsp` 0.7.x; VS Code `^1.91.0` |
| Legacy `sigil` skill | 0.9.0 | CLI `^0.8.0`, core `^0.7.0`, sigilc `^0.1.0`; Sigil 0.7.0 |
| `sigil-understand` | 0.1.0 | Sigil 0.8.0 reference pack; no compiler requirement |
| `sigil-evaluate` | 0.1.0 | Sigil 0.8.0; sibling `sigil-understand` |
| `sigil-write` | 0.1.0 | Sigil 0.8.0; siblings `sigil-understand`, `sigil-evaluate` |

The language contract in `spec/language.sigil` owns the Sigil version. Core
exposes that supported language version independently from the core artifact
version owned by `packages/core/deno.json`. A tool must reject a configured
`sigilVersion` it does not explicitly support.

The new design skills' `compatibility.json` files declare `sigilVersion` and
`requiredSkills`, independently from compiler/package versions. The joint 0.8.0
authority is `spec/sigil-reference.md` and `spec/sigil.ebnf`; portable copies and
source digests live in `sigil-understand/references/language`. The installed
frontend and root workspace still target 0.7.0. A design review does not assert
compiler conformance or saturated coherence. Install all sibling skills together.
