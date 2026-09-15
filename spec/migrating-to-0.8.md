# Migrating Sigil 0.7 to the Tag Revision

The [normative reference](sigil-reference.md) and [EBNF grammar](sigil.ebnf)
define 0.8.0, a breaking
revision from 0.7. Current tools and the repository's `.sigil` sources still use 0.7.0.
The [language guide](sigil-language.md) teaches authoring through examples.
This migration guide does not claim that an automatic
converter or a Tag-capable compiler is available. Update workspace version
configuration only with tools that support the new revision.

## Replace identity-only Concepts with simple Tags

Before 0.8, naming a concern with a Concept ID required a Concept block.
Concept IDs were optional, but that form coupled identity to grouping.
In 0.8, a [Tag](sigil-reference.md#tags-and-references) supplies the identity;
a [Concept Tag block](sigil-reference.md#grouping-taggroup) adds optional
grouping. Many existing Concept blocks can therefore become simple inline
Tags in direct Facets when their headings only supply a name.

Introduce the local Tag once with `*name*` and use bare references in the other
relevant Facets. When removing a block, make its concern explicit in the prose
and preserve each Facet's meaning, boundaries, contract role, and ownership.
Keep grouping when it helps connect related contributions. Leave prose
untagged when a reusable identity adds nothing; components may have no Tags.

Existing grouping syntax remains valid:

```sigil
interface {
  Search {
    Start a search and return results.
  }
}
```

Search is now a Concept Tag. Its bare heading introduces or reuses a local Tag;
no asterisks are added to the heading. Repeated headings connect contributions
across contracts of the same component. Grouping remains
optional. Every heading belongs to that component; imports cannot supply its
identity.

If an existing block reused an imported Concept as its heading, give the block
a distinct local concern name and reference the imported Tag in its Facet prose.
For example, use a local SearchPresentation heading and mention imported Search
in its body. A local heading named Search conflicts with an imported Search; it
does not become a provider-owned grouping. Local headings retain their owner and importability regardless of imports.

See the [team proposal](proposals/local-concept-tag-headings.md) for examples,
rationale, and tradeoffs.

## Introduce inline Tags explicitly

Before:

```sigil
interface {
  Query is the caller's search text.

  submit(Query) produces Results.
}
```

After:

```sigil
interface {
  *Query* is the caller's search text.

  *submit* accepts Query and produces *search results*.
}
```

Asterisks introduce an inline Tag only when they touch its name: `*Query*`
is a declaration, while `* Query *` is not. Later uses omit the asterisks.
Outside each asterisk, require whitespace, a physical line boundary, an ASCII
comma, or an ASCII period. Backticks and parentheses do not qualify. Thus
`a *Query*.` defines Query but `` `*Query*` `` does not. Backticks have no special
protection; ordinary bare reference scanning still applies to their contents.
This supersedes the earlier draft's optional delimiter padding; remove padding
from intended declarations in ordinary prose.
Multiword names such as search results are one Tag. Unmarked prose still contributes to the
Interface contract, but it no longer implicitly declares importable vocabulary.

Tags introduced inline or through local grouping headings in any contract are
owned by the component and can be selected by imports. Bare prose reuse does
not introduce another Tag or change its owner.

Keep at most one inline `*name*` definition for each exact Tag name in a
component. Repeated inline definitions are errors, even when their prose agrees;
convert later occurrences to bare references while preserving their Facets.
Repeated grouping headings remain valid reuse, including alongside one inline
definition, independently of section order.

## Exact names and complete references

Tag spelling is exact. Repeated spaces, tabs, nonbreaking spaces, and Unicode
spelling differences are not normalized. Keep each definition and reference on
one physical line. This replaces the earlier draft's whitespace-normalized,
wrappable names. Review names and references before reformatting; a line join
must not create a reference that was absent in the original source.

Hyphens and dots join word segments: order is not referenced inside pre-order
or order.status. Ordinary trailing sentence punctuation still permits a match.
See the [reference matching algorithm](sigil-reference.md#tags-and-references).

## Match the longest Tag and protect embedded syntax

Bare references choose the longest complete accessible name where matches
overlap. Equal-length matches at different positions prefer the earlier
position. Different identities with the same spelling remain a resolution
error. This replaces the earlier draft's semantic choice among overlapping
candidates; review prose when adding longer names to accessible scope.

Inline Link labels no longer introduce or reference Tags. Move intended Tag
introductions or references into surrounding prose. Embedded Facet introductions
follow normal Tag declaration and reference rules; only fenced payloads are
excluded from Tag scanning. Attaching a payload does not change Tag recognition
in unchanged introducing prose.
Do not modify asterisks inside linked material or fenced payloads to migrate Tag
syntax; that material retains its own notation.

## Replace component and namespace imports

Before:

```text
@search import { RecordSearch }
@search/records.sigil import { RecordSearch }
```

After:

```sigil
@search/records.sigil from RecordSearch import { Query, search results }
```

Resolve the exact source file declaring RecordSearch and select only its needed
Tags. RecordSearch identifies the provider; it is not itself imported.
Use commas between names. The selection list may span lines and have one
trailing comma; each complete Tag name must stay on one line. The path/provider
prefix remains on one line. Names are unquoted and have no asterisk delimiters.

Select each originating Tag at most once per source, including across separate
import statements. Repeated selections are duplicate-import errors, even when
they resolve to the same identity. Different providers' same-named Tags and
local/import name collisions remain resolution errors.

A directory path does not resolve through `_module.sigil`. An index that imported
RecordSearch does not become its owner or re-export its Tags. Import from the
source that actually declares the provider component. `_module.sigil` may remain
an ordinary source containing a summary component with its own Tags.

Tag imports preserve provider identities and consumer contribution context.
They do not make unselected Tag names accessible or copy provider obligations
into the consumer. Imported Tags may be used in Facet prose, including Embedded Facet introductions,
outside Inline Links. Complete Inline Links and fenced payloads are excluded
from Tag scanning. Bare reuse does not create
a new owner or an automatic downstream re-export.

## Consolidate expands into their components

The 0.8.0 language has two top-level forms: Tag imports and components.
`expand` is removed. Move State, Logic, Constraints, Decisions, and Cases from
all matching expands into the owning component declaration, alongside Goal
and Interface. Preserve all Facets and resolve conflicting contributions;
source order must not discard or override them.

Each component keeps one declaration and a workspace-unique name. Do not replace
expands with duplicate component declarations. A component can describe code in
multiple implementation files without splitting its Sigil declaration.

When moving Facets between source files, rebase relative Inline Links to retain
their targets. Bring over the selected Tag imports needed by the moved prose,
check same-name collisions, and preserve the origin of imported identities.
Imports used only to attach an expand are removed without replacement.

For example, a SearchPanel declaration and its separate State and Logic expands
become:

```sigil
component SearchPanel {
  goal {
    Let a user search and select records.
  }

  interface {
    *select* chooses a displayed result.
  }

  state {
    The *selection* is empty or contains one displayed result.
  }

  logic {
    select replaces the selection with the chosen result.
  }
}
```

## Enforce section, import, and notation validity

Each contract section may occur at most once in a component. When consolidating
expands, combine Facets under one section of each kind; repeated sections are
invalid and do not merge automatically. Repeated Concept Tag blocks remain
additive. Goal and Interface must each contain at least one direct or grouped
Facet; missing, empty, or whitespace-only required sections are invalid.

Tag names are case-sensitive in declarations, headings, imports, and references.
Every resolved imported Tag must have a qualifying prose reference in the
importing source. An unused imported Tag is a validity error, not a warning.
References in Embedded Facet introductions count as use; fenced payloads and
complete Inline Links do not.

Block openers keep their names and opening braces on one line; closing braces
have their own lines. An opening brace on the following line does not attach
to the preceding name. Inline brace expressions can remain ordinary prose.

Sigil 0.8.0 has no comment syntax. Comment-like prose is authored content, not
ignored commentary. Fenced payloads retain their own notation's comment rules.

Move notation whose syntax or meaning depends on line breaks or indentation
into a fenced payload immediately following introducing prose. Each introduction
attaches one payload, and its closing fence ends the Facet. Following prose
starts another Facet; a second payload needs its own introduction. This includes
multiline code, pseudocode, Markdown lists and tables, and ASCII diagrams.
Tag definitions and references must stay on one physical line; name spelling
is exact, with no whitespace or Unicode normalization. Paragraph display may
join ordinary prose lines, but that join cannot create Tag references. Wrap prose
to the 79-content-character limit without changing Facet boundaries; structural
lines, fence delimiters, fenced payloads, and link destinations retain the
specification's exemptions.

## Remove language-level public and private distinctions

Every Tag introduced by a component in any contract can be selected by an
explicit Tag import. Interface no longer determines which Tags are importable.
A Tag introduced in State, Logic, Constraints, Decisions, or Cases is owned by
the same component and follows the same import rules.

An imported Tag is interpreted within the provider's full component design,
while only explicitly selected names enter consumer scope. Preserve each
Facet's contract role and owner; rationale does not become a binding consumer
requirement merely because it supplies context.

Public and private access in the implemented system are implementation design
decisions. Preserve intended access restrictions as authored requirements and
their rationale as Decisions; importing a Tag does not grant runtime access.

This replaces the earlier 0.8 draft's Interface-only exports and import-free
expand binding. The language specification describes only the current model.

## Use Inline Links for design material

Use `[label](destination)` for Markdown documents, API designs, schemas, images,
and external designs. Replace documentary bare URLs, including Figma URLs,
with the same named Inline Link form:

```sigil
interface {
  Follow [API design](./api-design.md#request) for request fields.

  Follow the layout in
  [Calendar design](https://www.figma.com/design/EXAMPLE/Calendar?node-id=1-2).
}
```

These are Facet content references, not Tag imports. Relative link paths resolve
from the `.sigil` source directory; retain query strings and fragments. State
the intended role of the target in the containing Facet. Existing Markdown
image syntax can still present an image; the general Inline Link form can
reference that same image as supporting material.

The 0.7 parser preserves link-shaped text as prose. The new content model must
retain Inline Link labels, destinations, optional titles, source ranges, and
Facet ownership. Link recognition must protect destinations and titles from
Tag and brace parsing, preserve long destinations during formatting, and keep
fenced payloads inert. Exclude complete links, including labels, and fenced
payloads from Tag scanning. Preserve normal Tag recognition in introductory
prose, including imported references that count as import use. Retrieval and
semantic interpretation must record the
material actually read and keep missing targets or fragments unresolved.

## Implementation status

The language specification defines the breaking Tag revision. The repository's
parser, resolver, formatter, editor grammar, `.sigil` contracts, configuration,
and native frontend still target language 0.7.0. The new syntax is not yet an
implemented or released tool capability. Do not treat the examples as passing
compiler checks or change the workspace config to claim unsupported tooling.

The migration replaces the previous “infer public identifiers from Interface
prose” gap with explicit Tag introductions. It also requires:

- Tag declaration and reference ranges, multiword names, and Concept Tag headings
  in the parser and source model;
- Inline Links as native Facet content references, with general local/external
  destinations and source-supported interpretation of linked material;
- `from Component import { Tags }` parsing and selected component-owned Tag resolution;
- removal of directory and component imports and their automatic import surfaces;
- local-only grouping identity in components, with imported Tags
  resolved only in prose and preserved as provider-owned references;
- all seven contracts inside one component declaration, removal of expand
  syntax and resolution, and imports of Tags introduced in any contract;
- Tag-use checks, diagnostics, and recovery;
- preservation of declarations, references, grouping, name accessibility, and ownership
  through Design export, semantic input, catalogs, and saturation;
- formatter, LSP navigation/completion/diagnostics, editor syntax, authoring
  skills, examples, and migration tooling for the new syntax.

The [language tooling contract](language.sigil) still describes 0.7 behavior and
must be revised together with its implementation. It does not override this
language specification. The behavior algebra under `packages/eqval/` is an
unaccepted idea, not a language contract or a prerequisite for the Tag migration.

Under the repository's pre-1.0 version policy, this breaking revision uses
0.8.0. The specification update does not change an implemented version constant
or publish a release.

The 0.7 `SIGIL_*CONCEPT*`, component-import, module-index, and unused-import
diagnostics require revised codes, source ranges, severity, recovery, and
ordering for Tag syntax. The 0.7 formatter likewise cannot validate or migrate
the new import and Tag grammar.

Tag-use checking now accepts references in every contract, including Goal and
Decisions, instead of applying the old component-name and section restrictions.
Tag import cycles are allowed in 0.8.0. Replace cycle-only validity failures
with collective declaration and import resolution, preserving errors for
missing declarations and ambiguous names. Track visited sources and
identities so import traversal terminates. Circular references alone must not
count as satisfying requirements; accepting cycles does not merge identities,
expose unselected names, or introduce re-exports. This policy requires tooling
changes and does not describe current compiler support.

## Migrate tooling without discarding source meaning

Preserve Facet boundaries, introducing prose and fenced payloads, source ranges,
contract roles, originating Tag identity, and consumer ownership. A Facet may
have a grouping Tag and several inline Tag declarations or references. Do not
reduce that model to the old single optional Concept identifier.

Update parser/model/resolver contracts and implementations, Design export,
catalogs and saturation inputs, formatter, diagnostics, LSP, editor grammar,
authoring skills, and examples together. The current compiler cannot validate
the new syntax merely because the specification defines it.

Validation needs to cover:

- rejection of repeated contract sections and missing or empty Goal and Interface,
  while allowing nonempty direct or grouped Facets in required sections;
- case-sensitive Tag declarations, headings, imports, and references;
- outer asterisk boundaries allowing whitespace, line boundaries, commas, and
  periods, while backticks remain ordinary unprotected text;
- multiline import lists and optional trailing commas with single-line names;
- full-line block syntax and one payload per Embedded Facet;
- rejection of duplicate exact-name inline Tag definitions across a component's
  contracts, while allowing repeated headings and bare prose reuse;
- rejection of duplicate Tag selections within one import list or across
  import statements, including equivalent normalized paths and exact Tag names;
- unused resolved imports as validity errors, without duplicate unused-import
  errors for unresolved or ambiguous selections;
- comment-like prose preserved as authored content rather than ignored comments;
- fenced notation preserving significant line breaks and indentation, and
  ordinary example prose respecting the 79-content-character limit;
- adjacent Tag delimiters with no padding, exact single-line multiword Tags,
  and prose wrapping that preserves reference identities;
- no name normalization and no order reference inside pre-order or order.status;
- longest complete-name matching for nested and crossing overlaps, equal-length
  position ties, disjoint references, and unresolved same-name identity collisions;
- no Tag introductions or references inside complete Inline Links, linked
  content, or fenced payloads;
- normal Tag declarations and references in Embedded Facet introductions,
  including imported references that count as use, with unchanged recognition
  when a fenced payload is attached or removed;
- unchanged bare Concept Tag headings that introduce or reuse local identities;
- imports that never rebind headings, same-name local/import collision errors,
  and headings that never count as import use;
- selective imports from every contract, unknown selections, and ambiguous identities;
- valid mutual Tag imports independent of source order, terminating cyclic
  traversal, and retained diagnostics for invalid selections inside cycles;
- circular references that do not establish unsupported requirement satisfaction;
- rejection of old component and directory imports in the new grammar;
- all seven contracts in one declaration, rejection of expand syntax and
  duplicate components, and absence of accidental re-exports;
- preserved Tag identity and relative link targets when consolidating sources;
- Inline Links in every contract, relative paths, fragments, titles, long URLs,
  multiple links per Facet, Figma links, and unavailable referenced material;
- literal link-like text in fences and protected destination/title syntax;
- Tag and Facet provenance through saturation without equating all contributions
  merely because they share a Tag.

## Repository sources to migrate

The checked-in `.sigil` examples and contracts currently use the 0.7 syntax.
They illustrate component responsibilities, Facets, and contract roles, but
must be migrated before serving as Tag-language syntax examples. See the
[language specification](sigil-reference.md) and [implementation status](#implementation-status).

| Source | Meaning to preserve during migration |
| --- | --- |
| [Parser](../packages/core/src/parser.sigil) | Native Facet boundaries, embedded content, and source recovery. |
| [Source model](../packages/core/src/model/source.ts) | Source ownership and ranges; extend the single optional grouping field to carry Tag declarations and references. |
| [Workspace pipeline](../packages/core/src/pipeline.sigil) | Explicit stage ordering and separate behavior owners. |
| [Model summary](../packages/core/src/model/_module.sigil) | Independently owned domains; replace the directory import surface with explicit Tag imports. |
| [Core summary](../packages/core/_module.sigil) | Package responsibility without importing whole component namespaces. |
| [Design conversation](../integrations/skills/sigil/design-conversation.sigil) | Several recurring concerns across all relevant contracts. |
| [Skill summary](../integrations/skills/sigil/_module.sigil) | Workflow responsibilities with explicit public Tag dependencies. |

## Implementation follow-through and future extensions

The lexical and diagnostic requirements are now defined in the reference and
grammar. Implementation still needs to satisfy them; possible future extensions
are not part of the 0.8 grammar:

- Implementation of the [diagnostic catalog and recovery requirements](sigil-reference.md#diagnostics-and-recovery),
  including source ranges, severity, suppression, and deterministic ordering.
- Whether any future syntax should support Tag names containing the reserved
  delimiters; no quoting or escape form is defined here.
- Whether future versions should support aliases or explicit re-export; neither
  is part of this revision.

## Historical platform proposal: anchors

Anchors are a rejected historical platform proposal for connecting Sigil
Facets to implementation evidence.

An anchor would not change the meaning of a Sigil line.
It would record traceability between specification intent and implementation evidence.

The historical storage proposal used a committed workspace sidecar
`.sigil/anchors.json`, not inline syntax in `.sigil` files.
Generated AST indexes remain disposable.
The proposal would have allowed tools to map a component, section, or semantic
line to related files, symbols, tests, migrations, or generated code.

Source AST nodes would have provided structural evidence and recovery signals
without becoming permanent identities. The design was rejected because those
relationships create a second maintenance lifecycle without proving that
implementation conforms to Sigil.

The rejected anchor design was consolidated with the now-rejected generated
Receipts, readiness, evidence, and review-record design in
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
This proposal does not authorize an active language capability.
