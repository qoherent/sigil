# U9 — VS Code 0.8 integration

TextMate recognizes explicit provider imports, multiline Tag selections, local
headings and inline introductions, while protecting links and fenced payloads.
Semantic tokens use the shared Tag vocabulary. The bundled server retains raw
source bytes while its protocol view accounts for VS Code hiding a disk BOM.

Native compilation requires schema-2 language export and report version 2.
Locations declare byte or UTF-16 coordinates and a SHA-256 source digest. The
adapter verifies the disk snapshot and visible editor text, maps exact boundaries,
and rejects stale or invalid locations before publishing diagnostics/state.
Document versions and workspace revisions are rechecked after async projection.
Existing trust, host, cancellation, output bounds and unavailable-state contracts
remain covered. Compilation still only exports and compiles; interpretation
preparation/ingestion remain external.

Validation: 20 unit tests, including actual TextMate/Oniguruma tokenization,
coordinate parity and legacy exporter rejection; all 36 LSP tests; aggregate
TypeScript checks and repository lint. Real macOS VS Code 1.137.0 extension-host
checks pass with rebuilt CLI/native binaries: imported Tag hover/definition,
preview, file dependency scope, Loose/unavailable reports, missing binaries,
dirty-document rejection, first-line BOM navigation and native Unicode Facet
selection after CRLF normalization. Logs are under `/tmp/sigil080-execution/`:
`U9-unit-final.log`, `U9-lsp.log`, `U9-check.log`, `U9-lint.log`, and
`U9-host-verified.log`.

The host runner uses a temporary copy of the reviewed slotted example because
ancestor workspace discovery correctly rejects the still-0.7 repository root.
`SIGIL_TEST_WORKSPACE` enables actual-root example acceptance after U10 activation.
File-creation notifications can invalidate a compilation; the coordinate test
retries until its fixture is stable. The test distinguishes native file-only
findings from byte-ranged findings instead of inventing a range for the former.
