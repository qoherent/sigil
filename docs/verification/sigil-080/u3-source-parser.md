# U3: source capture and parser

The core parser now reads Sigil 0.8 source through one strict source snapshot.
Disk ingress retains original UTF-8 bytes; overlays retain explicitly supplied
scalar text. Source ranges are half-open byte offsets, with scalar and UTF-16
positions derived from the same snapshot. Invalid encoding never becomes
replacement-decoded source.

Structural parsing retains components, sections, flat Tag group occurrences,
Facet prose, inline definitions, complete links, and one optional fenced payload.
Recovered regions carry validity and completeness. Diagnostics include stages
and related locations and use canonical ordering and complete-record coalescing.
Glossary coordinates and filesystem adapters use the shared source boundary.

## Verification

- Before implementation, the old core suite passed 70 tests and 61 steps.
- New tests observed failures for unsupported 0.8 parsing, missing strict source
  capture and inline scanning, import recovery, Unicode whitespace, related
  location ordering, binary ingress, glossary byte ranges, and repeated-keyword
  component name locations before the corresponding fixes.
- Final targeted core run: **30 tests and 39 steps passed** across
  `source_text_test`, `diagnostics_test`, `inline_content_test`, `parser_080_test`,
  `glossary_source_test`, and `workspace_ingress_test`.
- The inline-link fixture covers adopted CommonMark 0.31.2 examples; its source,
  hash, license, and adaptation limits are included in the fixture.
- Source/parser/workspace entry points type-check; targeted lint passes.
- The real LSP overlay filesystem test passed with type checking disabled because
  its aggregate core import still reaches consumers assigned to U4–U6.
- The VS Code bundle built with the shared entity decoder dependency. This is
  bundling evidence, not editor runtime acceptance.

Execution logs are retained under `/tmp/sigil080-execution/U3-*` in this session.
Collective Tag resolution and reference-aware width handling belong to U4–U5.
Full core, native, CLI, and editor acceptance remain assigned to U6–U10; the
root workspace configuration remains transitional until those gates pass.
