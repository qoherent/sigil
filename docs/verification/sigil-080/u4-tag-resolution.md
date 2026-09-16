# U4: collective Tag and import resolution

The resolver collects component-owned Tag introductions before resolving imports.
Repeated local headings share one identity; duplicate inline definitions,
duplicate selections, and spelling collisions retain conflicting evidence without
choosing a winner. References retain their consumer Facet and provider origin.
Explicit paths resolve from the workspace root; cycles are valid, sibling local
Tags remain local, and imports never re-export a provider's selected vocabulary.

Reference matching uses a generated Unicode 15.1 table with pinned source hash
and license. It preserves exact spelling, physical boundaries, protected inline
regions, connector boundaries, and global longest-match ordering.

Workspace checks preserve exclusions, members, and nested configuration boundaries
with related parent evidence. Valid disk and overlay text now share the specified
64-digit snapshot identity. Invalid ingress has an `invalid:` capture identity;
an unavailable configuration has `unavailable`, neither claiming a complete textual
workspace snapshot. Pipeline diagnostic assembly uses canonical complete records.

## Evidence

- New resolution tests first failed on the old resolver's `document.expands`
  dependency. Additional tests exposed absolute-root import lookup, provider
  diagnostic locations, snapshot identity, and missing parent diagnostic evidence
  before their fixes.
- U4 targeted checks passed **21 tests and 61 configuration parity steps**.
- After simplification, combined U3/U4 checks passed **48 tests and 100 steps**.
  Resolver/workspace entry points type-check and repository lint passes.
- Direct parsing and resolution of all **53 reviewed designs** passed with no
  diagnostics across the root and two independent example boundaries: **55
  components, 341 Tags, 129 imports, 168 selections, and 378 references**. This
  scoped probe uses the reviewed source set; it does not activate the transitional
  root configuration or claim full CLI/editor acceptance.
- `deno task check` still reports **233 errors** in unmigrated aggregate consumers
  (projections/exporter/CLI/LSP). These remain assigned to U5–U9; no compatibility
  shims or weaker final checks were introduced.

The source and resolution simplification pass used a delegated reuse reviewer;
the quality and efficiency rubrics ran inline after the next reviewer dispatch
hit the agent thread limit. Reuse: 0 changes. Quality: 0 changes. Efficiency:
3 changes—reuse captured source maps, index relationships by file, and precompute
Tag lengths. No proposed findings were skipped. Tests passed afterward, and the
reviewed-design probe remained byte-for-byte identical.

Session logs and probes are retained under `/tmp/sigil080-execution/U4-*`.
Graph-backed pipeline acceptance, formatter width decisions, retrieval, and
ownership projections belong to U5; full core acceptance belongs to U6.
