# U5: formatting, context, and ownership

Graph and context APIs now expose selected provider-owned Tags and actual consumer
references. Provider context retains the complete declaration. Facets keep their
consumer, contract, local grouping, references, links, and original payloads.
Ordinary summary files have no implicit ancestry or export behavior.

Formatting protects resolved Tag spans and complete links, retains physical prose
boundaries, and checks the reparsed meaning before accepting a rewrite. Width-only
failures can be repaired; unrelated errors and unavailable provider context stop
formatting. Original BOM, line endings, and payload bytes survive.

Ownership annotations accept exact JSON-quoted Tag suffixes and retain separate
Tag origin and consumer Facet scope. Implementation ranges use explicit UTF-16
coordinates; Sigil ranges remain original UTF-8 byte spans. Compilation boundary
selection uses direct providers and consumers and rejects ambiguous component
seeds without choosing a declaration.

Retrieval and derived projections use schema 2. They retain full Facet evidence,
provider interpretation context, complete diagnostic identities, deterministic
selection reasons and visible budget truncation. Nested provenance is workspace-
relative, so identical checkouts produce identical results. Implementation evidence
is snapshot-bound and validated for ordered, unique, supported source records;
inapplicable evidence is ignored. Identity collision handling distinguishes
canonical duplicates from conflicting items in the same kind domain.

## Verification

- Targeted combined core tests: **84 tests and 39 steps passed**. Configuration
  parity adds **61 passing steps**. These include ten existing ownership scanner
  tests moved from the aggregate suite and migrated without losing scanner cases.
- New behavioral tests exposed old graph/projection, formatter, ownership,
  compilation-boundary, and retrieval assumptions before implementation. Additional
  failing tests caught absolute provenance, malformed evidence acceptance, and
  ambiguous exact boundary selection before their fixes.
- Targeted lint and type-checked test entrypoints pass. The reviewed-design probe
  remains **53 designs, 55 components, 341 Tags, 129 imports, 168 selections,
  378 references, zero diagnostics**.
- Aggregate `deno task check` has **108 transitional errors** in the old exporter
  and CLI/LSP consumers. Full core acceptance belongs to U6; hosts belong to U7–U9.
  The old aggregate fixtures are retained pending their owning migration units.

Logs are under `/tmp/sigil080-execution/U5-*`. No Sigil design, root language
activation, or protected user document changed in this unit.
