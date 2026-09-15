# U8 — Sigil 0.8 language service

The server uses captured source snapshots for diagnostics, symbols, navigation,
hover, semantic tokens and preview. Tag occurrences retain their provider identity;
consumer Facets and implementation ownership stay with the consumer. Byte ranges
map to UTF-16 protocol positions without rereading source. Provider links displayed
in hover or preview resolve against their originating source.

Document versions and workspace generations prevent overlapping reloads or delayed
hover work from publishing stale results. Source/configuration watches and precise
implementation watches retain their separate contracts. A regression covers an
implementation watch arriving during a pending language reload.

Validation: all 36 LSP tests and 63 CLI tests pass; targeted lint passes. Cases cover
BOM, CRLF/CR-only, supplementary Unicode, multiword Tags, protected links/payloads,
related diagnostics, overlays, source-read reuse, stale results and ownership.
The link-target and watcher-race regressions were observed failing before fixes.
Logs: `/tmp/sigil080-execution/U8-{lsp,cli,lint}-final.log`.

U7/U8 simplification: delegated reuse review completed; quality and efficiency
reviews ran inline after the agent thread limit. Renamed stale Concept helper
locals and indexed hover references/Tags once per renderer. The suggested CLI
relative-path helper replacement was skipped because root-equality behavior differs.
Both suites pass after these changes. Aggregate core/CLI/LSP type checks pass;
VS Code's existing `entities/decode` type resolution failure is assigned to U9.

Root activation and editor-visible raw/normalized coordinate verification remain
U9/U10 gates; these results do not claim the transitional root is valid.
