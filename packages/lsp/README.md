# sigil-lsp

Implemented pre-production language-server package for editor-facing Sigil
semantics for language 0.8. The artifact version is declared independently in
`deno.json`.

The language server should be the reusable bridge between `sigil-core` and
concrete editor integrations.

Language 0.8 responsibilities:

- implement Language Server Protocol 3.18 over standard input and output;
- implement initialize, initialized, shutdown, and exit lifecycle handling;
- synchronize open files using full-document changes and in-memory overlays;
- surface diagnostics inline;
- navigate explicit provider selections, local Tag introductions and resolved
  references using their captured source spans;
- provide document symbols for components, sections, local Tag groups and inline
  definitions;
- show complete provider contracts alongside consumer-owned Facets in Tag hover;
- provide resolver-backed semantic highlighting for component and Tag names
  through full-document semantic tokens;
- prefer the owning inline definition as a Tag destination, otherwise the earliest
  valid grouping heading;
- highlight reviewed glossary occurrences with the `term` semantic-token type;
- show canonical glossary definitions and bounded context through hover;
- navigate glossary occurrences to their authoritative JSON entries;
- publish glossary parse, schema, context-overlap, and collision diagnostics;

Deferred responsibilities:

- formatting and structure actions;
- completion, references, rename, and code actions;
- non-file URI schemes and transports other than standard input and output.

Non-responsibilities:

- implement VS Code-specific UI;
- duplicate parser or resolver logic;
- own Codex-specific behavior;
- replace the CLI for automation.

The approved package contract lives in [_module.sigil](./_module.sigil).

Run the server locally:

```bash
deno task start
```

Run package tests:

```bash
deno task test
```

## Source snapshots and freshness

Disk Sigil, config and glossary inputs retain original UTF-8 bytes. Open documents
supply validated scalar text. One captured generation supplies navigation,
diagnostics, related locations, symbols and tokens; requests do not reread source
to reinterpret byte ranges. Protocol positions and token lengths use UTF-16,
including BOM, supplementary characters and CR/LF/CRLF boundaries.

Late reloads cannot overwrite newer overlays. Pending requests return content
modified when their workspace generation changes. Closing an overlay restores disk
content, and older document versions do not overwrite a newer edit.

Clients supporting dynamic registration receive a language workspace watcher and
the existing precise implementation-source watchers. Source/config changes reload
the language snapshot; implementation changes invalidate the ownership scan and
hover cache. Unsupported clients retain document synchronization and reload-based
freshness. Ownership links remain advisory and retain the consumer scope and
separate originating Tag owner.
