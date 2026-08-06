# VS Code Integration

Implemented pre-production VS Code extension for Sigil.

Version 0.7 responsibilities:

- provide `.sigil` TextMate syntax highlighting and resolver-backed component
  concept, and reviewed glossary-term highlighting through LSP semantic tokens;
- bundle and connect to `sigil-lsp` for diagnostics, symbols, navigation, hover,
  and semantic highlighting;
- expose `Sigil: Show Component Preview` using the standard LSP hover response;
- provide standard VS Code JSON completion and validation for `.sigil/config.json`
  from the bundled Sigil configuration schema;
- expose explicit component and workspace compilation through an external
  compatible `sigil` executable;
- provide editor-native affordances without duplicating `sigil-core` behavior.

Compilation does not bundle the compiler into the VSIX. Install a compatible
Sigil CLI, then use **Sigil: Compile Component** or **Sigil: Compile
Workspace**. Configure `sigil.compile.executable` when `sigil` is not on the
extension host's `PATH`, and `sigil.compile.profile` to select a profile.

Component compilation sends the active file plus its one-based cursor position,
so the compiler resolves the exact enclosing component or expansion. In a
multi-root workspace the extension uses the active document's containing
workspace folder; workspace compilation prompts for a folder when no active
document disambiguates it. The JSONL bridge validates protocol version, run
identity, sequence, payloads, reports, and the single terminal event before
projecting diagnostics.

This integration should become the first concrete human UI for Sigil.

## Configuration schema

Opening `.sigil/config.json` gets JSON completion and validation for the
existing `sigilVersion`, `workspace`, `files`, and `tools` fields. The extension
bundles a copy of [`spec/sigil-config.schema.json`](../../../spec/sigil-config.schema.json)
under `schemas/` and associates it with `.sigil/config.json` through VS Code's
standard `jsonValidation` contribution — no network access is required. The
bundled copy is refreshed from the source at build time (`esbuild.mjs`) and a
unit test asserts it stays byte-for-byte in sync, so the VSIX cannot ship a
stale schema. This does not change the configuration format or duplicate
`sigil check`.

Version 0.7 targets desktop and remote Node extension hosts with file-backed
workspaces. VS Code for the Web, virtual workspaces, telemetry, document
mutation, and custom LSP methods remain outside the initial version.

The approved member-root contract lives in [_module.sigil](./_module.sigil).

Development:

```bash
npm install
npm test
npm run test:extension
npm run package
```

`npm run package` derives the artifact version from `package.json` and creates
`build/sigil-vscode-<version>.vsix`. The manifest uses the development publisher
identifier `sigil-dev`; Marketplace publication remains deferred until an
approved publisher identity exists.

Tagged `vscode-vX.Y.Z` releases package the extension and attach the VSIX to a
GitHub Release. Install a downloaded package with **Extensions: Install from
VSIX...** in VS Code or:

```bash
code --install-extension sigil-vscode-VERSION.vsix
```
