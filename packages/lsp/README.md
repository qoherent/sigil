# sigil-lsp

Implemented pre-production language-server package for editor-facing Sigil
semantics for language 0.9. The crate version, 0.8.0, is declared independently in
`Cargo.toml`.

The language server should be the reusable bridge between `sigil-core` and
concrete editor integrations.

Language 0.9 responsibilities:

- implement Language Server Protocol 3.18 over standard input and output;
- implement initialize, initialized, shutdown, and exit lifecycle handling;
- synchronize open files using full-document changes and in-memory overlays;
- serve each document from the nearest workspace above it, so a nested workspace
  gets the same answers as the enclosing one. The workspace the editor starts in
  stays loaded; a nested workspace is read when its first file opens and
  released when its last file closes;
- answer `sigil/documentWorkspace` with the workspace that owns a document
  (`workspace`, with its name and root), or with why none serves it (`excluded`
  by the files selection of its workspace, or `none` because no config sits
  above the file), and send `sigil/workspacesChanged` once a changed workspace
  config has been read, so a client asks again;
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

Run the server through the `sigil` command; it takes no options and speaks the
protocol on standard input and output:

```bash
sigil lsp
```

The crate is `sigil-lsp`, a library over `sigil-core` in this package's `src/`
directory; the `sigil` binary in `packages/cli` links it. Its behavior is
specified by the contract [lsp.sigil](lsp.sigil). The VS Code extension runs
`sigil lsp`.

Run package tests from the repository root with `deno task test:lsp`, or:

```bash
cargo test --manifest-path packages/lsp/Cargo.toml
```

The parity tests replay `tests/fixtures/lsp-parity.json`, sessions recorded from
the earlier TypeScript server, and `packages/cli/tests/lsp.rs` runs a real
process. `deno task test:lsp-smoke` opens a document in a built `sigil lsp`.

What the server does not do, by contract:

- Hover never lists owned implementations, and there is no ownership scanner.
- There is no ownership file-watch registration or its cache.

Other behavior to know:

- A client that supports dynamic registration gets one watch registration
  (`sigil/language-watch`, request id `sigil/watch/request`).
- A request that has a document change or a relevant file-change event already
  queued behind it answers content modified, because its answer would be
  discarded. A burst of edits is applied with one reload.
- The process exits with status 0 when the editor sends `exit` after
  `shutdown`, 1 when it sends `exit` without `shutdown`, and 3 when standard
  input or output fails.
- A byte-order mark at the start of a file read from disk is hidden in every
  position, document symbols included, as the editor hides it.

## Source snapshots and freshness

Disk Sigil, config and glossary inputs retain original UTF-8 bytes. Open documents
supply validated scalar text. One captured generation supplies navigation,
diagnostics, related locations, symbols and tokens; requests do not reread source
to reinterpret byte ranges. Protocol positions and token lengths use UTF-16,
including BOM, supplementary characters and CR/LF/CRLF boundaries.

Late reloads cannot overwrite newer overlays. Pending requests return content
modified when their workspace generation changes. Closing an overlay restores disk
content, and older document versions do not overwrite a newer edit.

Clients supporting dynamic registration receive one workspace watcher. Source and
config changes reload the language snapshot. Unsupported clients retain document
synchronization and reload-based freshness.
