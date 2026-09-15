# sigil-core requirements

**Implemented language:** 0.8.0. Artifact and release status are recorded in
`deno.json` and [COMPATIBILITY.md](../../COMPATIBILITY.md). The normative
[reference](../../spec/sigil-reference.md), [grammar](../../spec/sigil.ebnf) and
colocated Sigil contracts govern detailed language behavior.

## Source and structure

Accept explicit language versions. Disk input is original UTF-8 bytes, strictly
decoded; text overlays must contain Unicode scalar values. Preserve BOMs, physical
line endings, exact names, links and literal bodies. Half-open byte ranges derive
scalar/UTF-16 coordinates without replacement decoding or source rereads.

Parse Tag imports and components. Each component owns its Goal, Interface and
optional State, Logic, Constraints, Decisions and Cases. Retain ordered Facets,
local grouping occurrences, inline introductions and embedded content. Protect
complete links/images and fenced payloads from Tag interpretation. Apply the
normative staged diagnostics, recovery and suppression rules; partial results
must not imply validity or completeness that was not established.

## Workspace and resolution

Require strict `.sigil/config.json`. Discover the nearest eligible ancestor or
accept an explicit root. Parent workspaces must exclude independent nested
workspaces. Apply include/exclude globs and declared member metadata. A member
root does not create a namespace or import surface. `_module.sigil` is ordinary.

Resolve root-relative explicit source imports, optional provider component
selection and exact Tag names. A Tag's identity includes its owner component and
declaration source. Imports select provider-owned Tags without re-export,
visibility classes, normalization, aliases or wildcard selection. Duplicate or
ambiguous identities have no arbitrary winner. Valid cycles terminate and remain
valid. Qualifying uses belong to the consumer's eligible Facet prose; grouping
headings are local introductions, and protected text does not satisfy import use.

## Formatting and projections

Wrap prose at 79 content characters according to the language width policy.
Keep exact Tag references on one line and protect inline content/payloads. Obtain
provider vocabulary before formatting import-dependent prose. Reject recovered
or non-width-invalid input. Verify proposed text by reparsing, resolution and a
meaning signature before exposing it to a writing host.

Graphs preserve declarations, imports, selections and actual uses without
inferring runtime calls. Context includes complete provider declarations, while
consumer Facets and implementation ownership retain their owner. Retrieval keeps
purpose, direct dependency behavior, budget/truncation, inclusion reasons,
frontiers, evidence outcomes and versioned canonical bindings.

Optional `.sigil/glossary.json` remains a separately reviewed vocabulary policy:
validate schema/context overlap, use case-insensitive longest phrase matching,
retain source occurrences and agent visibility, and never rename a Tag to match
a glossary spelling. Core does not infer or mutate glossary definitions.

Implementation annotations select component/Tag sections and retain source
locations under their explicit UTF-16 convention. Validate supported source kinds,
selectors and evidence availability. A provider Tag reference does not transfer
consumer obligations or code ownership to its provider.

Schema-2 Design export retains original sources/context, identities, Facets,
groups, introductions, imports/selections, references, links, payloads, diagnostics
and validity/completeness. Invalid UTF-8 prevents export of a misleading bundle;
representable structural errors can accompany a partial bundle. Structural export
is not semantic proof. Native consumers own reconstruction, saturation and states.

## API and verification

Expose typed immutable models and a filesystem port for source reads, text reads,
existence and listing. Keep parser/resolver logic host-independent. Return stable
machine-readable diagnostics rather than losing unrelated results on failure.

Tests cover strict ingress, Unicode boundaries, all contract roles, protected
content, exact ownership, cycles, duplicate/ambiguous resolution, width repair,
partial recovery, workspace boundaries, glossary/ownership context, retrieval
budgets/freshness and native transport parity. Cross-host acceptance is recorded
in [migration verification](../../docs/verification/sigil-080/).

CLI/LSP protocols, editor UI, automatic migration, model calls, inferred behavior
and the eqval algebra are outside this package's language implementation scope.
