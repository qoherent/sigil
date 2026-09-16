# sigil-core architecture

Core uses typed pipeline stages behind a filesystem port. The
[colocated designs](_module.sigil) and [requirements](spec.md) describe its
commitments; host integrations adapt presentation and effects.

```text
original bytes / scalar overlays
  -> captureSource / SourceText
  -> structural parser + protected inline-content scan
  -> workspace discovery and loading
  -> collective component-owned Tag resolution
  -> formatter / graph / context / ownership / Design export
```

## Boundaries

| Module | Responsibility |
| --- | --- |
| `model/` | Immutable source, identity, resolution, diagnostic, graph, glossary, ownership and retrieval types. |
| `source-text.ts` | Strict UTF-8/scalar capture and original byte, scalar and UTF-16 boundaries. |
| `parser.ts`, `inline-content.ts` | Structure, Facets, grouping/inline introductions and protected links/payloads; no filesystem or import resolution. |
| `workspace.ts`, `config.ts`, `filesystem.ts` | Config discovery, source capture, include/exclude/member boundaries and strict optional glossary loading through a host port. |
| `resolver.ts` | Collective local Tag identities, explicit provider selections, exact eligible references and deterministic ambiguity/recovery diagnostics. |
| `formatter.ts`, `prose-width.ts` | Width-aware proposals verified against resolved vocabulary and meaning signatures; hosts own writes. |
| `graph.ts`, `projections.ts` | File/owner/import/use relationships and complete contract projections without inferred execution semantics. |
| `context-retrieval.ts`, `retrieval-projection.ts` | Purpose, budget, dependency and glossary projections with explicit truncation and unavailable evidence. |
| `implementation-ownership.ts` | Supported annotation discovery, section selectors and consumer-owned implementation evidence. |
| `source-provenance.ts`, `canonical.ts` | Portable source identities, stable bindings, fingerprints and evidence snapshots. |
| `design-input.ts` | Source-faithful schema-2 structural export for separately validated native consumers. |

## Data flow rules

Parsing is independent of filesystem traversal and provider resolution. Resolution
runs over captured documents collectively, so valid import cycles need no recursive
expansion or ordering winner. Ordinary source paths and exact owned Tag names
identify providers; `_module.sigil` adds no special namespace behavior.

Keep original byte ranges through all language stages. Host adapters derive
presentation coordinates from those snapshots. Editor overlays are text evidence,
not proof of a file's byte encoding. Implementation-source line/column ranges have
an explicit separate convention. Never reinterpret a byte offset as a line number.

Recovered nodes retain validity and completeness. Diagnostics stay staged, ordered
and source-supported, including related locations. Missing evidence and ambiguous
identities remain visible in projections. General links retain their source base;
parsing does not fetch linked material. Embedded payloads remain uninterpreted.

Formatting obtains accessible vocabulary and validates the whole proposed change
before a host writes it. Retrieval preserves complete provider interpretation
context subject to an explicit budget, with omissions reported. Ownership
projections never move a consumer's Facets or implementations to an imported Tag's
provider. Structural transport retains all occurrence relationships and original
source, independently of native semantic interpretation.

## Implementation and tests

Prefer pure transformations and explicit result types. Effectful hosts implement
the filesystem port; core has no Deno disk calls, VS Code APIs, transport session,
model prompts or command dispatch. Tests use in-memory filesystems and exact source
fixtures, with cross-host/native fixtures checking the same capture downstream.
Keep shared coordinate, link-scanning and provenance rules centralized rather than
reimplementing them in each host. See [verification](../../docs/verification/sigil-080/)
for tested behavior and platform limitations.
