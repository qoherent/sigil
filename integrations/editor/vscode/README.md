# VS Code Integration

Implemented pre-production VS Code extension for Sigil.

Version 0.1 responsibilities:

- provide `.sigil` TextMate syntax highlighting and resolver-backed component
  highlighting through LSP semantic tokens;
- bundle and connect to `sigil-lsp` for diagnostics, symbols, navigation, hover,
  and semantic highlighting;
- expose `Sigil: Show Component Preview` using the standard LSP hover response;
- provide editor-native affordances without duplicating `sigil-core` behavior.

This integration should become the first concrete human UI for Sigil.

Version 0.1 targets desktop and remote Node extension hosts with file-backed
workspaces. VS Code for the Web, virtual workspaces, telemetry, document
mutation, and custom LSP methods remain outside the initial version.

The approved member-root contract lives in [#module.sigil](./%23module.sigil).

Development:

```bash
npm install
npm test
npm run test:extension
npm run package
```

`npm run package` creates `build/sigil-vscode-0.1.0.vsix`. The manifest uses
the development publisher identifier `sigil-dev`; Marketplace publication
remains deferred until an approved publisher identity exists.

Tagged `vscode-vX.Y.Z` releases package the extension and attach the VSIX to a
GitHub Release. Install a downloaded package with **Extensions: Install from
VSIX...** in VS Code or:

```bash
code --install-extension sigil-vscode-0.1.0.vsix
```
