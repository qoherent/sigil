# Sigil Language Reference

**Language version:** 0.8.0. **Status:** Unreleased specification; implementation pending.

This is the normative definition of Sigil's source model, syntax, ownership,
name resolution, interpretation boundaries, validity, and required diagnostics.
The [Language Guide](sigil-language.md) teaches authoring through examples.
The [EBNF grammar](sigil.ebnf) defines productions using the notation below.
The reference and grammar form one specification: productions define syntax;
this document supplies lexical algorithms and contextual conditions. A conflict
between them is a specification defect, not permission to choose either result.
Guide examples and style advice do not add requirements.

The current parser, resolver, formatter, editor integration, and `.sigil`
contracts still target 0.7.0. This document does not release 0.8 tooling or change
an implemented version constant. See [Migrating to 0.8](migrating-to-0.8.md).

## Contents

- [Conformance and notation](#conformance-and-notation)
- [Source text](#source-text)
- [Lexical structure](#lexical-structure)
- [Components and contracts](#components-and-contracts)
- [Facets and embedded content](#facets-and-embedded-content)
- [Tags and references](#tags-and-references)
- [Workspaces and imports](#workspaces-and-imports)
- [Interpretation boundaries](#interpretation-boundaries)
- [Formatting](#formatting)
- [Diagnostics and recovery](#diagnostics-and-recovery)
- [Conformance examples](#conformance-examples)

## Conformance and notation

### Authority and stages

Requirements use **must**, **must not**, and **may** in their ordinary mandatory,
prohibitive, and permissive senses. Recommendations and examples are explicitly
identified. Rule identifiers in parentheses are stable cross-reference names;
they are not source syntax or Tag names.

An implementation may organize its internal stages differently, but must
preserve the following externally observable distinctions:

| Stage | Establishes | Does not establish |
| --- | --- | --- |
| Parsing | Source structure, Facet boundaries, declarations, links, and payloads. | Provider availability or behavioral truth. |
| Structural validation | Required content, permitted nesting, and declaration shape. | Whether prose requirements agree. |
| Resolution | Name ownership, accessible references, import validity and use. | Runtime invocation, access, or implementation conformance. |
| Interpretation | The meaning of authored contributions and required external context. | That a test ran or production behavior was observed. |

A source is syntactically valid when its text satisfies the grammar and lexical
conditions. A workspace is language-valid when its discovered sources also
satisfy structural, resolution, and physical-formatting rules. Interpretation
can remain unresolved or contain a semantic conflict even in a language-valid
workspace. An implementation must not report unavailable interpretation as a
satisfied requirement.

A parser may expose a partial source model for invalid input. Partial results
must retain invalidity and source evidence; recovery is not acceptance. Tools
may offer additional style warnings without changing language validity.

### Grammar notation

The grammar operates on decoded source after recognizing an optional initial
BOM, preserving a mapping to original bytes. The EBNF uses
`name = expression ;` productions, quoted literal strings,
`,` for concatenation, `|` for alternatives, `[ ... ]` for optional content,
`{ ... }` for zero or more repetitions, and `( ... )` for grouping.
`(* ... *)` encloses a grammar comment; it does not add comments to Sigil.
Concatenation binds more tightly than alternation. Whitespace outside quoted
strings has no significance in the grammar file.

Special sequences written `? ... ?` refer to the exact lexical algorithms in
this reference or the pinned external link syntax. They are not unspecified
wildcards. In particular, paragraphs are maximal source regions and links are
recognized before Tags. These conditions prevent arbitrary alternative Facet
splits. EBNF alone does not express name uniqueness, import existence, or the
comparison between opening and closing fence lengths.

## Source text

### Encoding and lines (source.encoding)

Sources must be valid UTF-8. A single initial UTF-8 byte-order mark is permitted
and ignored for syntax, while retained in source offsets. NUL (U+0000) is invalid.
Other Unicode scalar values are source characters, subject to contextual rules.
Do not perform Unicode normalization, case folding, or replacement decoding.

LF, CRLF, and lone CR are line endings. CRLF counts as one ending. The final
physical line may end at EOF without a terminator. Recognizing these endings
does not authorize rewriting source bytes or treating a line break as part of a
Tag name. Preserve original text and byte offsets in source models.

### Whitespace (source.whitespace)

Structural horizontal whitespace is ASCII space (U+0020) or tab (U+0009).
Indentation and structural margins consist only of these characters. A blank
line contains only structural horizontal whitespace before its ending or EOF.
Tabs are not expanded for parsing; indentation does not establish ownership.

For the rule that Tag delimiters must touch non-whitespace name characters,
whitespace is exactly U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680,
U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, and U+3000. This definition
is explicit; implementations must not substitute a platform-specific trim test.
Only CR and LF establish physical line endings. Other whitespace is literal
content when allowed inside a name; it is never collapsed or converted.

### Exact text and presentation (source.text)

A Tag name is an exact sequence of source characters on one physical line.
Repeated spaces, tabs, nonbreaking spaces, and canonically equivalent Unicode
spellings remain distinct. Comparing valid UTF-8 bytes or Unicode scalars gives
the same identity equality. Syntactic indentation and import/heading margins
are not name characters; extracting a name is not normalization of its content.

For paragraph presentation, remove structural indentation and trailing structural
horizontal whitespace from each ordinary prose line and join adjacent lines
with one space. Retain original lines and source mappings. Recognize Tags on
the original physical lines before this presentation join. A join must never
create a reference that did not exist in source. Complete links retain their own
raw spans and syntax rather than being reparsed from normalized display text.

A content character and name length mean one Unicode scalar value, not a byte,
UTF-16 code unit, grapheme, or display column. CRLF is one line ending for line
coordinates; byte offsets still account for both bytes.


## Lexical structure

### Structural lines (lexical.structure)

A component opener, contract opener, or grouping opener occupies one physical
line. Its name and opening `{` must be on that line, with only structural
horizontal whitespace after the brace. A closing `}` occupies its own line
apart from indentation and trailing horizontal whitespace. Indentation is
optional and does not change the nesting established by braces.

Recognize exact component openers at top level, contract openers inside a
component, and local grouping openers inside a contract. A grouping opener
inside a group is invalid nesting. A matching opener terminates preceding
prose without requiring a blank line. A lone closing brace closes the innermost
open structural block; an unmatched closer is a structure error. A bare `{`
line is a structure error, not an opening brace for the preceding line.

Only these full-line forms create blocks. Compact component/contract syntax is
not a supported alternative. In a prose context, an inline brace expression
such as `Return { enabled: true }.` remains prose and has no structural effect.
Text resembling a compact group inside prose does not create a group. To author
a group, use its full-line header and a separate closing line.

A line ending in an unprotected `{` is an attempted header in its current
context. If its name is invalid, report the corresponding structural/name error
instead of accepting it as ordinary prose. A complete Inline Link's contents
are protected; a brace within that link is not an unprotected header delimiter.

The grammar fixes context, rather than treating every section word as a global
keyword: a `state` header in a component opens State; the same bare name used as
a heading within a contract is a local grouping Tag. Unknown component-body
headers are invalid sections, not user-defined contract kinds.

### Region recognition (lexical.region)

A prose line is a nonblank physical line in a contract or grouping body that
is not a structural line or fence delimiter. A paragraph includes the maximal
consecutive run of such lines and their source endings. At top level or directly
inside a component, otherwise-unrecognized text is a structural error, not prose.

Use the following recognition precedence; implementations may use another
algorithm only if it produces the same source regions and relationships:

1. Inside an open fenced payload, recognize only its qualifying closing fence.
   All other lines, including apparent braces and headers, remain payload.
2. Outside a payload, recognize complete structural lines, blank lines, and
   fence opener lines in their permitted context. These delimit prose regions.
3. Within a maximal run of prose lines, recognize complete Inline Links and
   image references, including their own protected syntax. A complete reference
   may wrap over prose lines but cannot cross a blank line, structural line,
   fence delimiter, or EOF. No part of its contents changes Sigil structure.
4. Apply the inline-literal policy below. Then scan the remaining eligible
   physical prose regions for inline Tag definitions and bare references.

The link rules determine escaped delimiters and nesting within a complete
link or image. Sigil does not otherwise adopt a full Markdown block parser.
A malformed or incomplete link-shaped sequence is ordinary prose and receives
normal Tag scanning; it does not protect the remainder of the source.

### Inline backticks and escapes (lexical.literal)

Sigil has no inline-code-span syntax. Backticks within ordinary prose are
ordinary characters and do not protect their contents from Tag or link
recognition. For example, the source text `` `*query*` `` does not define query: the
adjacent backticks fail the outer asterisk-boundary rule. This is not protected
inline code. If query is already accessible, its bare name can still be
recognized there under the ordinary reference rules. Only a valid full-line
fence opener starts a protected payload.

Backslashes have no general Sigil escape effect outside complete links or
payloads. They cannot be used to suppress a Tag delimiter or structural line.
Use an introduced fenced payload for literal notation that must not participate
in Sigil recognition. Asterisks and braces inside a complete link retain the
link's own syntax and are already protected by its region boundary.


### Name characters (lexical.name)

The EBNF `name_edge` is exactly one permitted source scalar other than source
whitespace, `*`, `,`, `{`, or `}`. The `name_whitespace` production is one of
the source.whitespace characters other than CR or LF. Thus internal spaces,
tabs, and nonbreaking spaces are permitted literally, but no physical newline
is allowed. `tag_name` begins and ends with `name_edge`.

These character rules apply in definitions, headings, and imports. Contextual
scanning still excludes complete links and payloads from inline definitions.
No Unicode normalization or implicit escaping changes a name. Non-ASCII names
are permitted even though component identifiers are restricted to ASCII.

### Import layout (lexical.import)

The prefix `@path from Component import {` must be on one physical line.
The nonempty selection list may span physical lines. Commas separate complete
Tag names, and one trailing comma is permitted before the closing brace. A Tag
name itself never spans a line. Blank lines and structural horizontal whitespace
may separate list elements and delimiters, but do not alter name content.

The path is a nonempty sequence of source scalars excluding source whitespace,
`{`, `}`, `*`, and `,`. It is unquoted: quote characters have no grouping or
escape function in a path. A path containing spaces cannot be selected by this
import syntax. After the list's closing brace, only structural horizontal
whitespace and a line ending or EOF are allowed. No other top-level form can
share that physical line.

For example, this is one import, selecting two exact names:

```sigil
@search/service.sigil from SearchService import {
  query,
  search results,
}
```

The closing brace here terminates the import list, not a component. Lexical
recognition stays in import-list context until it closes or fails. Missing
commas do not turn two physical lines into a multiword Tag. An empty list,
repeated comma, or unterminated list is a structural error. Resume after the
closing line when present; if a new complete top-level opener occurs before a
close, retain the incomplete import and resume at that opener. Do not consume
later components as an import's recovery content.

### Comments and reserved content (lexical.comments)

There is no Sigil comment syntax. Comment-like text inside Facet prose remains
authored content. At top level, it must satisfy the ordinary top-level grammar
or is invalid. Payloads retain the comment syntax of their own notation.

Asterisks introduce Tags only under the definition-boundary algorithm below;
they are not Markdown emphasis. Ineligible asterisks remain ordinary content.
Neither a failed delimiter boundary nor Markdown-like typography creates an
implicit Tag definition. Ordinary content still permits bare references to
already accessible names.

Syntactic margins in headings and imports are outside Tag names. Whitespace
inside a name is literal. The EBNF defines these margins separately, so trimming
one cannot silently alter a name's internal spaces or tabs.


## Components and contracts

### Declarations (component.declaration)

The only top-level forms are Tag imports and components. A source may contain
multiple components, imports only, or no forms. `expand`, namespace imports,
directory imports, exports, and re-exports are not 0.8 forms.

A component has one declaration and owns all its contracts. Its name matches
`[A-Za-z][A-Za-z0-9_]*`, is case-sensitive, and must be unique in the configured
workspace. A Tag named Search does not declare a component named Search.
Duplicate component declarations retain evidence but establish no unambiguous
component owner; source order must not choose one.

### Sections (contract.structure)

The seven exact section names are `goal`, `interface`, `state`, `logic`,
`constraints`, `decisions`, and `cases`. Each may occur at most once in a
component. Repeated sections are errors and must not be merged.

Goal and Interface are required. Each must contain at least one Facet, directly
or inside a grouping block. Missing, empty, or whitespace-only required sections
are invalid. The other five sections are optional and may be empty. A grouping
heading alone does not supply a Facet.

Section order has no overriding effect. Goal, Interface, State, Logic,
Constraints, Decisions, Cases is the recommended presentation order.

### Contract roles (contract.role)

| Section | Interpretation role |
| --- | --- |
| `goal` | Purpose, responsibility, intended outcomes, and reason for existence. |
| `interface` | Offered interactions: operations, inputs, results, events, errors, and observable promises. |
| `state` | Meaningful runtime or domain data, configurations, modes, and conditions. |
| `logic` | Behavior: calculations, guards, sequencing, delegation, transformations, flows, and transitions. |
| `constraints` | Invariants, prohibitions, bounds, ownership restrictions, architecture, and binding technology choices. |
| `decisions` | Rationale: choices, scope, assumptions, alternatives, trade-offs, consequences, and revisit conditions. |
| `cases` | Starting situations, actions or sequences, and expected observations for examples or families of scenarios. |

The containing contract remains part of a Facet's meaning, including for
embedded and linked material. A binding architecture or technology choice is
recorded in Constraints; Decisions supplies its rationale. Labels such as
`Decision:`, `Scope:`, `Open question:`, and `Proposal:` are ordinary prose,
not keywords, required fields, or a machine-readable acceptance workflow.

An example does not silently quantify over all inputs. Required and permitted
outcomes differ. A rejected alternative or explicitly unaccepted proposal is
not an implementation obligation. A parser does not infer behavioral truth
from a contract name or prose label.

## Facets and embedded content

### Authored units (facet.boundary)

A Facet is the finest authored unit. It has a component owner, contract role,
source range, and optional local grouping Tag. It retains these when its prose
references imported Tags. A compiler may decompose its meaning for calculation
without replacing its authored identity.

A maximal run of adjacent prose lines is one paragraph and one ordinary Facet.
Blank lines terminate paragraphs and create no Facets. Structural boundaries
also terminate them. Legal physical wrapping inside a paragraph does not create
additional Facets. Distinct reviewable contributions are recommended as separate
paragraphs; this is not a mechanical one-clause-per-Facet rule.

There are two authored forms: ordinary Facets and Embedded Facets. Inline Links
are content within either form and do not create additional Facets.

### Grouping (tag.group)

A Concept Tag block is a bare local Tag heading with a braced body containing
Facets. Blocks are flat and must contain at least one Facet. They cannot nest.
Their headings are not Facets. Every contained Facet records that grouping Tag.
Repeated blocks within or across contracts reuse the local Tag.

Grouping is optional in every contract. Direct, grouped, and mixed Facets are
valid. A component may contain no Tags. Grouping alone does not make operations,
resources, or requirements behaviorally equivalent.

### Fenced payloads (facet.fence)

Three or more backticks open a fence. The opener may carry one type matching
`[A-Za-z][A-Za-z0-9_+.-]*`. A closing delimiter contains at least the opening
number of backticks and no non-whitespace additional content.

The opening fence must directly follow introducing prose without a blank line.
The introduction and attached payload form one Embedded Facet. The payload
preserves blank lines, apparent Sigil syntax, and relative indentation. Its
content does not create Sigil declarations, Tag references, imports, grouping,
or Inline Links. Its notation and containing contract supply its meaning.
The introduction retains normal Tag and link recognition.

Each introduction attaches exactly one payload. The closing fence terminates
the Embedded Facet. Following prose begins a new Facet even without an
intervening blank line. A second fence needs its own prose introduction; it
cannot attach to the already closed Embedded Facet.

The opening delimiter is the maximal initial run of backticks after structural
indentation. A type may follow immediately or after structural horizontal
whitespace; trailing structural whitespace is permitted. The opener must end
with a physical line ending. An invalid type still opens an invalid fenced
region for recovery, so its body is not mistaken for structural Sigil.

A closing fence may have any structural indentation and trailing structural
whitespace, but no type or other content. It must contain at least the opening
number of backticks. A shorter backtick-only line remains payload. The first
qualifying closer ends the payload; apparent syntax elsewhere in the payload
is inert. EOF before a closer is an unterminated-payload error.

Retain the payload's exact source lines and delimiter ranges. For a dedented
presentation, remove the opener's exact indentation prefix from each body line
that begins with that prefix; leave other lines unchanged. Do not expand tabs,
trim payload content, or normalize its internal whitespace. The raw payload
remains available even when a dedented representation is provided.


Notation whose meaning depends on line breaks or indentation must be a fenced
payload. This includes multiline code, pseudocode, Markdown lists and tables,
aligned math, and ASCII diagrams. Ordinary prose can contain inline notation
whose meaning survives legal wrapping, subject to the lexical rules. A fence label
does not imply execution or make the payload production evidence. The requirement
to preserve notation meaning is an interpretation condition; a parser need not
classify arbitrary prose as code or prove that its meaning survives wrapping.

### Inline Links (facet.link)

An Inline Link has the form `[label](destination)` with an optional title.
Its delimiter, destination, title, escape, and balanced-parenthesis syntax is
incorporated from [CommonMark 0.31.2, Links](https://spec.commonmark.org/0.31.2/#links),
subject to the Sigil prose boundaries defined here. Reference-style links and
bare URLs do not constitute this form. Angle-bracket destinations are supported.
Images using the corresponding `![label](destination)` form are retained as
image references, using the same protected content boundary and target rules.

Preserve each reference's raw spelling, label, destination, optional title,
source range, enclosing Facet, and whether it is an image. Complete references,
including their labels, are excluded from Tag scanning. Parsing them must not
retrieve their targets.

Relative local paths resolve from the containing `.sigil` source directory,
not the workspace root. Absolute URLs identify external resources. Query
strings and fragments retain their target format's meaning. An Inline Link
does not use `@` import resolution or expose declarations from its target.

The containing prose and contract establish the linked material's role and
scope. A target name, extension, URL domain, label, or title alone does not
adopt its contents as requirements. "Must satisfy this schema" adopts a rule;
"background rationale" supplies explanation. Conflicting adopted statements
remain conflicts unless the author explicitly resolves or scopes the exception.

If interpretation requires a target or fragment and it is unavailable, preserve
the reference and report unresolved interpretation. Do not infer content from
metadata. When material is read, retain its source location separately from the
authored link. Authors manage target scope and versions; snapshots, fingerprints,
and automatic reevaluation are not language requirements.

## Tags and references

### Introduction (tag.definition)

A Tag name is nonempty text delimited inline by `*name*`, or introduced by a
local grouping heading. Names may contain multiple words and are case-sensitive.
Commas, braces, and asterisks are not name content. There is no quoting or escape
form for these reserved characters inside a name. A name cannot begin or end
with whitespace as defined in source.whitespace.

An inline definition requires both inner and outer delimiter boundaries:

- The opening asterisk directly precedes a non-whitespace name character.
- The closing asterisk directly follows a non-whitespace name character.
- Immediately before the opening and after the closing asterisk there must be
  source whitespace, a physical line boundary, an ASCII comma, or an ASCII period.
  No other punctuation qualifies. A protected-region boundary alone is not a
  substitute for these actual source characters.

Thus `a *query* contains text` and `a *query*.` define query. `* query *`,
`` `*query*` ``, `(*query*)`, and `prefix*query*suffix` do not define query.
These failures are ordinary text, not delimiter errors. Bare reference scanning
still applies to that ordinary text if query is already accessible.

Scan eligible physical prose left to right. At an asterisk with a valid left
outer boundary and right inner character, find the next asterisk in the same
eligible region on that line. If none exists, report `SIGIL_INCOMPLETE_TAG`
for the candidate through the region end and do not create a declaration.
If a closing candidate exists but its inner or outer boundary fails, treat the
opening asterisk as ordinary content and continue scanning at the next character.
If both boundaries succeed but the name contains forbidden content, report
`SIGIL_INVALID_TAG_NAME`, retain that candidate, and resume after its closer.
Otherwise record the complete definition and resume after its closer.

This algorithm does not nest names or rescan a successful/invalid definition
for a shorter declaration. Neither definitions nor bare references span a
physical line, complete link, Facet, or payload boundary.

### Ownership and duplicates (tag.identity)

All contracts in a component share its local Tags. An exact name permits
at most one inline definition across those contracts. A second definition is
an error even when the prose agrees. Do not merge definitions or choose one
by source order. Retain all conflicting source locations.

Resolve definitions and headings collectively. A heading reuses the matching
local Tag; if there is no inline definition, same-named headings introduce and
reuse one local Tag. Thus one inline definition and repeated headings are valid
regardless of section order. Bare prose references do not redefine a Tag.

Headings never receive their identity from imports. Same-spelled Tags in
different components remain distinct and are not duplicate local definitions.
A local/import collision in a component's accessible scope is an error. Two
imported identities with the same accessible name are also ambiguous. Neither
source order nor import order selects an owner. Ambiguous names remain unresolved.

Contributions through reuse are additive. Source order does not override an
older contribution. Conflicting Facets require a design resolution. A Constraint
and an operation under one heading must still concern the same action or
resource for the Constraint to apply.

### Exact names and reference matching (tag.match)

Definitions, headings, selections, and bare references compare exact Tag names.
Names cannot cross a physical line. An apparent multiword name split across
lines is not a reference to the single-line name. A formatter must keep recognized
names intact and preserve reference identities when joining or wrapping prose.

For reference boundaries, a **word character** is a character in Unicode 15.1.0
General_Category L, M, N, or Pc, or U+200C or U+200D. These categories are pinned
to the [Unicode 15.1.0 data](https://www.unicode.org/Public/15.1.0/ucd/).
A **connector run** is one or more ASCII hyphens (`-`) or dots (`.`).

For each exact candidate occurrence on an eligible physical prose line:

1. Reject it if the immediately preceding or following character is a word
   character. The start/end of the eligible region is a boundary.
2. Reject it if immediately preceded by a connector run that is itself
   immediately preceded by a word character.
3. Reject it if immediately followed by a connector run that is itself
   immediately followed by a word character.

Only characters in the same eligible region participate in these tests; a
complete link or physical line end stops
boundary inspection. Internal characters of the candidate remain part of its
exact name. This is not a host regular expression's default word-boundary test.

Thus order is not referenced by pre-order or order.status. It is referenced
by `(order)` and `order.` at the end of a sentence: a trailing dot with no
following word character is punctuation, not a joined word segment. A Tag
named C++ can be referenced by `Use C++ here`, but not by `C++17`.



Choose the longest complete accessible name among overlapping candidates,
using exact-name length. Process longer candidates first, then earlier
source positions for equal lengths. Keep a candidate only if its source range
does not overlap one already selected. Preserve all disjoint selected references.
A longer name wins even when its match starts later in the prose. Same-name
identity collisions are resolved separately; they cannot be broken by length.
Definitions are not rescanned for shorter references inside their names.

Unknown prose remains content without creating a Tag or an unresolved-reference
error. Bare Tag recognition is a lexical reference relationship, not evidence
that its statement invokes an operation or satisfies an obligation.

### Recognition regions (tag.region)

| Region | Tag definitions and references |
| --- | --- |
| Ordinary Facet prose | Recognized. |
| Embedded Facet introduction | Recognized with the same rules. |
| Complete Inline Link or image reference, including label and title | Not recognized. |
| Fenced payload | Not recognized. |
| Linked target | Does not declare or reference Tags in the linking source. |

Recognize Facet boundaries, payloads, and complete links before scanning eligible
prose for Tags. Definitions and references cannot span protected regions.
Attaching a payload must not change recognition in unchanged introductory prose.

## Workspaces and imports

### Discovery (workspace.discovery)

Sigil sources are selected by a strict JSON `.sigil/config.json` at the workspace
root. The config selects language version and file discovery; its detailed
contract is [workspace configuration](sigil-config.md), with the
[configuration schema](sigil-config.schema.json). These configuration artifacts
currently show the implemented 0.7 version; their discovery rules continue to
apply, while a 0.8 source requires a tool that supports that version.

The workspace root is the directory containing `.sigil`, whose `config.json`
controls it. A project is a coherent app, service, library, package, or system
represented at a configured boundary. The workspace root is the root project.
A workspace member is an additional project explicitly declared in
`workspace.members`; a workspace with members is a monorepo workspace.

Discover the nearest applicable ancestor config. An explicit workspace root
must contain `.sigil/config.json` directly. Missing configs and configs nested
inside included paths are errors. An excluded nested workspace has its own
config and independent boundary; it is not a member of the parent. Higher
configured workspaces must exclude that subtree. A declared member cannot
contain its own config.

`_module.sigil` is an ordinary source filename that may hold a project summary.
It has no import-resolution, directory-index, export, or re-export behavior.
Imports use explicit included `.sigil` paths, regardless of directory membership.

### Selection and resolution (import.resolve)

An import selects a nonempty comma-separated list of Tag names from one
component in an explicit file: `@path.sigil from Component import { names }`.
The provider is not itself imported and no namespace is introduced. Asterisks,
aliases, wildcards, and directory shorthand are not defined in the selection.

Normalize the path lexically from the workspace root: convert backslashes to
slashes, collapse repeated slashes and `.` segments, and resolve internal `..`.
Absolute paths (a leading slash/backslash, drive prefix, or network path) and
traversal outside the workspace are unresolved. Paths are case-sensitive source
identities; do not merge two discovered spellings based on filesystem case folding.
The normalized path must end in
`.sigil` and select a source included in the configured workspace. Do not
reinterpret a directory path as `_module.sigil`.

Resolve source, provider component, and selected Tags separately. The named
component must be declared in that exact source. Its imported names are not
its own declarations. Missing sources, missing or ambiguous components, and
unknown or ambiguous selected Tags are resolution errors. Failures must not
erase independent successful selections.

Every component-owned Tag can be selected, regardless of its introducing
contract. Contract roles do not create language-level public/private visibility.
Only selected provider identities enter the importing source's accessible
vocabulary. All components in that source see those imports; local Tags remain
local to their component. Other components' local Tags in the same file are not
implicitly accessible.

Imports and bare reuse do not create re-exports. Select a Tag from its owner.
Selecting the same originating identity twice in one source is a duplicate-import
error, including in separate statements or through equivalent normalized paths.
Duplicate selections are not silently deduplicated. Different identities with
one accessible spelling remain a name-collision error.

### Import use (import.use)

Every resolved, unambiguous selected Tag requires at least one bare reference
in eligible prose somewhere in the importing source. Any contract counts,
including Goal and Decisions. Introductions to Embedded Facets count; payloads,
complete links, headings, and mere provider-component mentions do not.

An unused selection is an error. Unresolved, duplicate, or ambiguous selections
do not also receive unused-import errors. Repeated bare references are valid.

### Cycles (import.cycle)

Cycles are allowed. Collect component-owned declarations and imports independently
of file order. A cycle cannot supply a missing definition. Follow dependencies
with visited source/identity tracking so traversal terminates without changing
ownership or exposing unselected names. Preserve independent resolved selections
when another edge in a cycle fails.

A cycle alone implies neither circular execution nor contradictory behavior.
Circular references to an unsupported claim do not establish its satisfaction.

## Interpretation boundaries

### Providers and consumers (interpretation.owner)

Interpret an imported Tag within the provider's complete component design,
including its related Tags and untagged Facets. This interpretation context is
broader than the names selected into the consumer's accessible scope.
Conditions on an operation may occur in Interface, Logic, or Constraints;
contract roles remain part of their meaning. Decision rationale stays rationale.

The consumer owns its Facets. Importing a Tag neither copies provider obligations
into the consumer nor rewrites the provider's behavior upstream. Consumer prose
establishes how it uses or relates to the provider. Invocation and delegation
require explicit authored behavior. A shared directory, a component mention,
a shared Tag, or dependency traversal alone establishes no runtime call or
behavioral equivalence.

Public/private runtime access is an implementation design matter. Authored
Constraints may prohibit access even to data or operations whose Tags can be
imported. Importability does not grant access or override those restrictions.

### Evidence and unresolved meaning (interpretation.evidence)

Preserve originating identity, Facet ownership, contract role, explicit import
selection, and source locations through loading and interpretation. References
to linked material retain their target provenance separately from the source
Facet. A missing target is unresolved when its content is needed.

Sharing a Tag does not establish that implementation realizes the associated
Facets. A Case can be meaningful before tests exist. Test expectations are not
production behavior, static reading is not execution, and a mocked helper is
not evidence of the real helper's behavior. Whether a test covers a situation,
whether its assertions agree, whether production satisfies it, and whether a
run passed are separate questions.

The reference defines these interpretation boundaries, not a complete automated
procedure for deriving or proving arbitrary natural-language meaning. Tools
must distinguish an established conflict from unresolved interpretation and
must not manufacture a proof from unavailable evidence.

## Formatting

### Physical width (format.width)

Ordinary prose is limited to 79 content characters per physical line, excluding
leading indentation. Structural lines, fence delimiters, and payloads are exempt.
Count original Unicode scalar values, including internal whitespace and source
delimiters, after removing leading ASCII indentation. Exclude the raw destination
span (including angle brackets when used) from that count. Link destinations
are exempt and must remain intact with their labels. Titles
and labels remain prose content for width accounting. Other indivisible prose
tokens longer than 79 content characters are unformattable.

A formatter must wrap only at whitespace boundaries and preserve Facet
boundaries, Tag names and references, link destinations, and payload content.
It must not split a Tag name, alter its internal whitespace, create a reference
by joining lines, remove a reference by wrapping, or turn prose into structural
syntax. Treat a complete Tag definition or recognized reference as indivisible
for wrapping. A name longer than the available width is unformattable, even if
it contains internal spaces. Source locations may change
after formatting; authored meaning and ownership must not. Formatting rules
do not require a particular indentation style for otherwise valid sources.

## Diagnostics and recovery

### Diagnostic records (diagnostic.record)

The catalog below defines 0.8 diagnostic codes, not claims about codes currently
implemented in 0.7. Each record must carry a code, stage, severity, message,
source location when available, and related conflicting locations where required.
Exact English wording and UI presentation are implementation choices.

All cataloged language violations have severity `error`. Interpretation errors
are reported in the interpretation stage and do not retroactively make parsed
syntax invalid. Additional advisory diagnostics may be warnings or information.

Ranges identify original source, before formatting or name processing. Use
half-open UTF-8 byte offsets, with optional one-based line and Unicode-scalar
column coordinates. An insertion point has equal start and end offsets. Related
locations use the same convention. A tool protocol with different coordinates
must translate them rather than reinterpret byte offsets as character offsets.

Sort diagnostics by source's normalized workspace-relative path, primary start
offset, primary end offset, code, and sorted related locations, in that order.
Compare paths and codes by Unicode scalar value. Workspace diagnostics without
a source precede source diagnostics. Coalesce identical records. For a conflict
group, report one diagnostic at its earliest occurrence under this ordering and
attach all other occurrences as related locations; this does not select a winner.

### Source and structure errors

| Code | Required condition | Primary location and minimum recovery |
| --- | --- | --- |
| `SIGIL_INVALID_ENCODING` | Source bytes are not valid UTF-8. | First invalid byte sequence; stop parsing this source, continue other sources. |
| `SIGIL_INVALID_CHARACTER` | A character forbidden by the source-text rules occurs. | Character range; preserve source, do not accept it through replacement. |
| `SIGIL_PARSE_STRUCTURE` | Text does not fit a permitted form in its structural context. | Offending token or line; retain it as invalid and continue at a structural boundary. |
| `SIGIL_UNCLOSED_BLOCK` | A component, contract, or grouping block lacks its closing brace. | Opening header, with EOF as a related insertion point; retain the incomplete block. |
| `SIGIL_UNKNOWN_SECTION` | A component-body header names an unsupported contract. | Header name; retain an invalid section and skip its balanced body. |
| `SIGIL_MISSING_GOAL` | Goal is absent or contains no Facet. | Component name if absent, section header if empty. |
| `SIGIL_MISSING_INTERFACE` | Interface is absent or contains no Facet. | Component name if absent, section header if empty. |
| `SIGIL_DUPLICATE_SECTION` | A contract section occurs more than once in a component. | Conflicting headers; retain each section separately without merging. |
| `SIGIL_DUPLICATE_COMPONENT` | Component names collide in the workspace. | Conflicting names; retain declarations without choosing an owner. |
| `SIGIL_EMPTY_TAG_GROUP` | A grouping block contains no Facet. | Grouping header; retain the empty group. |
| `SIGIL_NESTED_TAG_GROUP` | A grouping block occurs within another grouping block. | Inner header, related outer header; retain the invalid nesting without flattening it. |
| `SIGIL_INCOMPLETE_TAG` | An inline opening delimiter has no valid close within its permitted region. | Opening delimiter through the available candidate; no declaration is created. |
| `SIGIL_INVALID_TAG_NAME` | A delimited candidate or heading contains forbidden name content. | Candidate name; retain raw text without exposing an invalid Tag. |
| `SIGIL_LITERAL_WITHOUT_INTRODUCTION` | A fence has no directly preceding prose introduction. | Fence opener; preserve the payload as detached invalid content. |
| `SIGIL_DETACHED_LITERAL_BLOCK` | A blank line separates a fence from preceding introducing prose. | Fence opener, related preceding prose; do not attach across the blank line. |
| `SIGIL_INVALID_LITERAL_TYPE` | A fence opener contains an invalid type or extra non-whitespace content. | Type field; preserve the fenced region, but mark it invalid. |
| `SIGIL_UNCLOSED_LITERAL_BLOCK` | No qualifying closing fence occurs before EOF. | Fence opener, related EOF; consume the remainder as unterminated payload. |
| `SIGIL_LINE_TOO_LONG` | A prose line exceeds the width rule but can be wrapped legally. | Prose line; retain content for formatting. |
| `SIGIL_UNFORMATTABLE_LINE` | An indivisible non-exempt token exceeds the width limit, or no legal wrap preserves structure. | Token or affected prose line; do not split it destructively. |

### Workspace and name errors

| Code | Required condition | Primary location and minimum recovery |
| --- | --- | --- |
| `SIGIL_CONFIG_NOT_FOUND` | Workspace discovery finds no applicable config. | Requested target location if available; stop workspace resolution. |
| `SIGIL_CONFIG_PARSE` | Config is not strict UTF-8 JSON. | Config decoding or JSON error; stop that workspace's resolution. |
| `SIGIL_CONFIG_INVALID` | Config violates the configuration contract. | Offending property or missing property's container; do not guess discovery rules. |
| `SIGIL_UNSUPPORTED_VERSION` | The tool cannot process the configured language version. | Version value; do not interpret using a different version. |
| `SIGIL_NESTED_CONFIG` | A nested config conflicts with included workspace/member boundaries. | Nested config, related parent boundary; do not merge workspaces. |
| `SIGIL_UNRESOLVED_IMPORT_PATH` | An import path escapes the workspace or does not select an included readable `.sigil` source. | Import path; retain other independent imports. |
| `SIGIL_UNRESOLVED_IMPORTED_COMPONENT` | The selected source does not supply an unambiguous named component. | Provider name, related declarations when ambiguous. |
| `SIGIL_UNRESOLVED_IMPORTED_TAG` | The provider does not own an unambiguous selected Tag. | Selected name, related invalid/ambiguous definition locations when present. |
| `SIGIL_DUPLICATE_TAG_DEFINITION` | More than one inline definition has the same exact name in a component. | Conflicting definitions; the name remains unresolved, including for headings. |
| `SIGIL_DUPLICATE_TAG_IMPORT` | A source selects the same originating Tag more than once. | Conflicting selections; neither occurrence silently wins. |
| `SIGIL_TAG_NAME_COLLISION` | Different imported identities, or a local and imported identity, share an accessible name. | Conflicting introductions/selections; affected references remain unresolved. |
| `SIGIL_UNUSED_TAG_IMPORT` | A valid, unambiguous selected Tag has no eligible prose reference. | Import selection; preserve it and report the unused selection. |

A duplicate selected identity is excluded from successful accessible selections
until corrected. An invalid local definition cannot become valid merely because
a same-named heading exists. Unaffected local Tags and selected imports remain
available in partial results.

### Interpretation diagnostics

| Code | Condition | Required result |
| --- | --- | --- |
| `SIGIL_LINK_TARGET_UNAVAILABLE` | Required linked material or its requested fragment cannot be accessed. | Locate the link, preserve its target, and mark the dependent interpretation unresolved. |
| `SIGIL_INTERPRETATION_UNRESOLVED` | A requested interpretation cannot be established from available meaning or evidence. | Identify affected Facets and the missing or ambiguous basis; do not claim satisfaction. |
| `SIGIL_SEMANTIC_CONFLICT` | Interpretation establishes incompatible adopted requirements. | Identify the conflicting Facets and target locations; do not select one by source order. |
| `SIGIL_LAYOUT_DEPENDENT_PROSE` | Ordinary prose relies on line breaks or indentation to carry notation meaning. | Identify the Facet and require that notation to be represented in a fenced payload. |

These codes distinguish results when interpretation is performed. They do not
require a parser to detect contradictions or a tool to decide arbitrary prose.
An explicit open question is not a syntax error; whether it blocks a task is an
interpretation result relative to that task.

### Recovery and suppression (diagnostic.recovery)

Recover at existing Facet or structural boundaries; never silently create a
valid Tag, close a requirement, merge conflicting definitions, or discard a
provider's obligation. A malformed inline Tag does not consume the next Facet.
Do not scan an unterminated payload as Sigil to find apparent recovery braces.

Use a specific diagnostic instead of a generic structure diagnostic for the
same failure. An unresolved path suppresses missing-provider, unknown-Tag, and
unused-import errors for that import. An unresolved provider suppresses unknown
Tag and unused-import errors for its selections. Duplicate, ambiguous, and
unresolved selections suppress unused-import errors. An unformattable line
suppresses the ordinary width error for the same line.

Suppress absence-based checks, including unused imports, when incomplete
recovery prevents examining the relevant source region. Successfully established
references and independent errors remain available.

An unterminated fence suppresses derived unclosed-block diagnostics for the
structural blocks containing that payload; their completeness remains unknown.
Do not infer missing required sections or empty groups from content lost to an
unclosed fence or incomplete structural recovery. Mark those checks incomplete.
Errors in independent, completely parsed regions still must be reported.
Malformed link-shaped text that is not a complete Inline Link remains ordinary
prose; it has no link-target diagnostic merely because it resembles a link.

A formatter must not rewrite invalid sources as if recovery had made them valid.
A consumer of partial results must be able to distinguish a recovered node from
a valid authored declaration. Exact internal error-node shapes are not prescribed.


## Conformance examples

These expected results are normative examples of the rules above. They are
specification cases, not reports that the current 0.7 compiler passes them.
Implementations should turn them into fixtures with source ranges and diagnostic
records. Examples below are independent unless explicitly grouped as files.

### Minimal complete source (C01)

```sigil
component Minimal {
  goal {
    State one responsibility.
  }

  interface {
    Offer one interaction.
  }
}
```

Expected: one component, two sections, two ordinary Facets, no Tags or imports,
and no language errors. Its final newline is optional. Changing LF to CRLF does
not change the structure; original byte ranges change accordingly.

### Local identity and grouping (C02)

```sigil
component Vocabulary {
  goal {
    Demonstrate local identity.
  }

  interface {
    A *query* contains search text.

    query {
      Accept a query.
    }
  }

  logic {
    query {
      Reject an empty query.
    }
  }
}
```

Expected: one local query Tag, one inline definition, two grouping occurrences,
and four Facets overall. Reordering the contracts preserves that identity.
Changing either bare reference to another `*query*` definition produces
`SIGIL_DUPLICATE_TAG_DEFINITION`; the duplicated name is unresolved, not merged.
Removing the inline-definition Facet leaves one heading-introduced query Tag.

### Exact names and matching (C03)

The input column below represents a single eligible physical prose region.
Definitions are collected before testing references. In rows showing escaped
character names, `\t` and `\n` denote actual tab and physical newline characters
in the fixture; they are not a Sigil escape notation.

| Available names or setup | Input | Expected result |
| --- | --- | --- |
| order | `order` | One reference. |
| order | `pre-order` | No reference. |
| order | `order.status` | No reference. |
| order | `(order).` | One reference. |
| order | `orders` | No reference. |
| C++ | `Use C++ here.` | One reference. |
| C++ | `C++17` | No reference. |
| query | `Query` | No reference; case differs. |
| search results | `search  results` | No reference; two internal spaces differ. |
| search results | `search\tresults` | No reference; tab differs from space. |
| search results | `search\nresults` | No reference across the physical line. |
| search, results, search results | `search results replace results` | search results, then the final results. |
| new order, order status | `new order status` | Only order status; longer match wins even though it starts later. |
| a b, b c | `a b c` | Only a b; equal-length crossing matches prefer the earlier position. |
| One inline definition each | `*search results*` and `*search  results*` | Two distinct local Tags, not duplicate definitions. |
| One inline definition each | Names using U+00E9 and U+0065 U+0301 | Distinct names; Unicode normalization is not applied. |

### Protected regions and incomplete names (C04)

| Input region | Expected result |
| --- | --- |
| `A *query* contains text.` | One inline definition. |
| `` A `*query*` contains text. `` | No definition: outer boundaries fail. Backticks have no special protection. |
| `A *query*.` | One definition: period is an allowed outer boundary. |
| `(*query*)` | No definition: parentheses are not allowed outer boundaries. |
| `prefix*query*suffix` | No definition: adjacent word characters fail outer boundaries. |
| `A * query * contains text.` | No definition from the padded delimiters. |
| `quantity * unitPrice * discount` | No definitions. |
| `A *query` followed by a physical line ending | `SIGIL_INCOMPLETE_TAG`; no definition. |
| `A *request, result* contains text.` | `SIGIL_INVALID_TAG_NAME`; no partial definition. |
| `[*query*](./api.md)` | One link, no Tag definition or reference. |
| `![query](./layout.svg)` with query accessible | One image reference, no Tag reference. |
| `query` inside a fenced payload | No Tag reference. |
| `query` in the introducing prose of that payload | One reference if query is accessible. |
| `[query](unfinished` with query accessible | Ordinary malformed link-shaped prose containing a query reference. |

### Import outcomes (C05)

Use the complete provider and consumer sources in the guide's
[import example](sigil-language.md#7-connect-components-with-imports).

| Change to that workspace | Expected result |
| --- | --- |
| No change | Three selected provider-owned Tags; all used by SearchScreen. |
| Select query twice in one list | `SIGIL_DUPLICATE_TAG_IMPORT`; independent selections remain available. |
| Add a second import statement selecting query from the same provider | The same duplicate-import error. |
| Select an undeclared Tag | `SIGIL_UNRESOLVED_IMPORTED_TAG`; no additional unused error for it. |
| Remove every eligible submit reference, keeping its selection | `SIGIL_UNUSED_TAG_IMPORT` for submit. |
| Put the sole submit occurrence inside a complete link or payload | Still unused. |
| Define a local query in SearchScreen | `SIGIL_TAG_NAME_COLLISION`; neither local nor imported query silently wins. |
| Use a query grouping heading in SearchScreen | The same local/import collision, not imported-heading reuse. |
| Import two provider-owned Tags with the same exact name | `SIGIL_TAG_NAME_COLLISION`. |
| Add a valid mutual import with an owned definition at each end | No cycle-only error; traversal terminates. |
| Replace the explicit path with a directory path | `SIGIL_UNRESOLVED_IMPORT_PATH`; no index fallback. |

### Facet and structure outcomes (C06)

| Input/change | Expected result |
| --- | --- |
| Blank line between two prose paragraphs | Two Facets. |
| Wrap an ordinary paragraph without splitting or creating a Tag reference | One Facet with unchanged references. |
| Group header containing one paragraph | One Facet, not two. |
| Group with no Facets | `SIGIL_EMPTY_TAG_GROUP`. |
| Group inside another group | `SIGIL_NESTED_TAG_GROUP`. |
| Second Logic section in a component | `SIGIL_DUPLICATE_SECTION`; sections are not merged. |
| Goal containing only whitespace | `SIGIL_MISSING_GOAL`. |
| A header's opening brace moved to its own line | Invalid structural syntax. |
| `Return { enabled: true }.` inside a contract | Ordinary prose; braces do not create blocks. |
| A fence after a blank line following prose | `SIGIL_DETACHED_LITERAL_BLOCK`. |
| A fence without any preceding introduction | `SIGIL_LITERAL_WITHOUT_INTRODUCTION`. |
| Prose immediately after a closing fence | A new Facet, even without a blank line. |
| A second fence immediately after a closing fence | `SIGIL_LITERAL_WITHOUT_INTRODUCTION`; it cannot attach to the prior Facet. |
| An unclosed fence containing apparent component declarations | `SIGIL_UNCLOSED_LITERAL_BLOCK`; those declarations stay payload. |
| A required link target is unavailable | Parsing preserves the link; interpretation reports `SIGIL_LINK_TARGET_UNAVAILABLE`. |

### Scope of a conformance claim

A complete 0.8 language implementation must satisfy the grammar, lexical and
structural conditions, exact name and import rules, provenance requirements,
and diagnostic conditions above. A syntax-only parser can claim syntax support,
but not workspace resolution or semantic interpretation. It must label checks
it does not perform. A reference example that requires external material is not
fully interpreted merely because its source parses.

