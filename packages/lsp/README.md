# sigil-lsp

Implemented pre-production language-server package for editor-facing Sigil
semantics, versioned for publication as `@qoherent/sigil-lsp` 0.3.0.

The language server should be the reusable bridge between `sigil-core` and concrete editor integrations.

Version 0.2 responsibilities:

- implement Language Server Protocol 3.18 over standard input and output;
- implement initialize, initialized, shutdown, and exit lifecycle handling;
- synchronize open files using full-document changes and in-memory overlays;
- surface diagnostics inline;
- provide go-to-definition for imports and components;
- provide document symbols for components, expands, and sections;
- support hover or preview content for collected expansions;
- provide resolver-backed semantic highlighting for component names through
  full-document semantic tokens;

Deferred responsibilities:

- formatting and structure actions;
- completion, references, rename, and code actions;
- non-file URI schemes and transports other than standard input and output.

Non-responsibilities:

- implement VS Code-specific UI;
- duplicate parser or resolver logic;
- own Codex-specific behavior;
- replace the CLI for automation.

The approved package contract lives in [#module.sigil](./%23module.sigil).

Run the server locally:

```bash
deno task start
```

Run package tests:

```bash
deno task test
```
