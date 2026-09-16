# sigil-core

The shared Sigil 0.8 implementation. Artifact version **0.8.0** is prepared in
this checkout; publication is separate. After publication, import with:

```ts
import { parseSigilDocument } from "jsr:@qoherent/sigil-core@0.8";
```

Raw parsing requires an explicit `sigilVersion`. Workspace APIs discover and
validate `.sigil/config.json` before loading sources. Disk adapters supply original
bytes; editor overlays supply scalar text. Source ranges are half-open UTF-8 byte
ranges, with scalar and UTF-16 positions derived from the same captured source.

Core owns deterministic language behavior used by CLI, LSP and native export:

- All seven contract sections belong to a component. Preserve Facets, embedded
  payloads, Inline Links, grouping occurrences and inline Tag introductions.
- Resolve exact component-owned Tags and explicit file/provider selections.
  Imported Tags remain provider-owned; using Facets remain consumer-owned. Cycles
  are valid. `_module.sigil` is an ordinary source, with no re-export behavior.
- Preserve independent valid results and staged diagnostics when other input is
  invalid. Reject unsupported configured versions and removed language forms.
- Format against resolved spans and provider vocabulary, preserving exact Tag
  recognition, Facet boundaries, payloads and link targets. Repair width errors
  only when reparsing and resolution preserve meaning.
- Build graphs, complete contract views, bounded retrieval projections, glossary
  context, implementation ownership and source-faithful schema-2 Design export.
- Retain explicit missing evidence, truncation, ambiguity and freshness metadata.

Core does not own CLI arguments, editor APIs, LSP transport, model prompts or
semantic interpretation. Native `sigilc` consumes structural export separately.

See [_module.sigil](./_module.sigil), [requirements](spec.md),
[architecture](architecture.md), the [language reference](../../spec/sigil-reference.md)
and [migration verification](../../docs/verification/sigil-080/).
