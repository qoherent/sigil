# sigil-lsp

Future language-server package for editor-facing Sigil semantics.

The language server should be the reusable bridge between `sigil-core` and concrete editor integrations.

Planned responsibilities:

- surface diagnostics inline;
- provide go-to-definition for imports and components;
- provide document symbols for components, expands, and sections;
- support hover or preview content for collected expansions;
- expose formatting or structure actions only after the parser model is stable.

Non-responsibilities:

- implement VS Code-specific UI;
- duplicate parser or resolver logic;
- own Codex-specific behavior;
- replace the CLI for automation.
