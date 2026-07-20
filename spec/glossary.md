# Sigil Glossary

This glossary defines the project-specific vocabulary used by the Sigil
language, platform, documentation, and development workflow. It exists to keep
the same word from acquiring different meanings across specifications, code,
tools, and conversations.

It defines technical and project-specific terms, not ordinary English words.
When a definition here conflicts with an approved normative contract, the
normative contract governs and this glossary must be corrected.

Primary authorities are:

- [Sigil Language Specification](sigil-language.md) for language and source
  semantics;
- [Sigil workspace configuration](sigil-config.md) for workspace discovery and
  configuration;
- [Sigil Workflow](sigil-workflow.md) for design, review, and implementation
  gates;
- [Sigil 0.1 API](api-0.1.md) for implemented public tool surfaces;
- [Sigil Platform Architecture](sigil-platform-architecture.md) for package and
  integration boundaries;
- accepted ADRs for the decisions they own.

Proposed and superseded ADRs provide design context but do not override an
approved or implemented contract.

## Usage Rules

- Use the preferred term shown in this glossary when writing normative text.
- Qualify `root` as `workspace root`, `root project`, or `project root`.
- Do not use `workspace`, `project`, `package`, `module`, and `directory` as
  synonyms.
- Do not use `component` as a synonym for a source file, class, package, or
  visual element.
- Do not use `expand` to mean inheritance, override, replacement, or export.
- Do not use `valid`, `ready`, and `approved` as synonyms; they represent
  separate gates.
- State whether a future concept is `proposed`, `accepted`, `implemented`, or
  `deferred`.
- Avoid the unqualified word `module` when `project`, `component`, `package`,
  `source file`, or `implementation module` is more precise.

## Language And Source Model

### Sigil

The rationale-oriented modeling language and platform defined by this
repository. Depending on context, `Sigil` may name the language, the overall
project, or the platform; qualify it when ambiguity is possible.

### Sigil Language

The versioned contract governing `.sigil` syntax, structure, sections, imports,
workspace interpretation, and meaning. The current supported version is
`0.1.0`.

### Sigil source

UTF-8 text interpreted according to a supported Sigil Language version.

### Sigil source file

A file whose name ends in `.sigil` and whose contents are Sigil source.

### Sigil document

The parsed model of one Sigil source file, including imports, components,
expands, sections, semantic lines, source ranges, and diagnostics.

### Top-level form

An `import`, `component`, or `expand` declaration appearing outside every other
form in a Sigil document.

### Declaration

A top-level form that introduces an import, component, or expand into a Sigil
document.

### Import

A declaration that names components required from another Sigil source. An
import makes the named component contracts and their collected expands
available to the importing source; it is not a re-export.

### Import path

The workspace-root-relative path following `@` in an import declaration.

### Explicit-file import

An import whose path ends with a `.sigil` filename, such as
`@features/auth/auth.sigil`. Ordinary internal contracts use explicit-file
imports.

### Directory import

An import path without a `.sigil` filename. It may target only the workspace
root or a declared workspace member and resolves to that project root's
`#module.sigil`.

### Imported name

A case-sensitive component name listed inside an import declaration's braces.
It must match a component declared in the resolved target document.

### Component

A coherent system unit with a stable contract relied upon by users, callers, or
other components. A component may represent a product module, service boundary,
domain concept, programming abstraction, internal API, state machine, screen,
view, or reusable UI surface.

### Component declaration

The `component Name` form that defines one component's public contract through
required `goal` and `interface` sections.

### Component name

The case-sensitive identifier following `component` or `expand`. A component
name identifies a contract across its declaration and every matching expand.

### Public contract

The observable responsibility and interactions promised by a component's
`goal` and `interface`. `Public` is relative to the component's dependents and
does not necessarily mean externally available outside the application.

### Dependent

A user, caller, component, tool, or other system part that relies on a
component's public contract.

### Caller

A dependent that invokes an operation or API-shaped interface.

### Goal

The required component section describing why the component exists, the
responsibility it owns, and its intended outcome.

### Interface

The required component section describing how users, callers, external
systems, or other components interact with the component through observable
inputs, outputs, operations, events, guarantees, and failures.

### Expand

A top-level form that adds operational detail to a matching component. An
expand does not override, replace, inherit from, or change the component's
public contract.

### Expansion

The parsed or resolved representation of one `expand Name` declaration.

### Collected expansion

The complete set of all `expand Name` declarations matching one component.
Matching expands are cumulative; none shadows another.

### Implementation-specific expand

An expand colocated with implementation that records operational rationale
owned by an existing component without introducing a separate dependent-facing
contract.

### State

An optional expand section describing meaningful runtime or domain
configurations, modes, and conditions that exist or change during execution.
It does not mean storage layout unless that layout is itself a domain decision.

### Logic

An optional expand section describing behavior, flows, algorithms,
transformations, decisions, and lifecycle transitions.

### Constraint

One binding rule, policy, invariant, architecture decision, ownership rule,
dependency rule, or technology choice that a valid implementation must obey.

### Constraints

The optional expand section containing constraints.

### Case

One representative, externally observable example, edge condition, acceptance
scenario, or outcome.

### Cases

The optional expand section containing cases.

### Section

A named block inside a component or expand. Component sections are `goal` and
`interface`; expand sections are `state`, `logic`, `constraints`, and `cases`.

### Section body

The free-form content enclosed by a section's braces.

### Free-form content

Text that the structural parser preserves without assigning additional grammar
inside the section. It may contain prose, Markdown, signatures, pseudocode,
tables, or brace-safe ASCII layouts.

### Semantic line

One non-empty line inside a section body, preserved as a distinct semantic unit
with its owner, section, file, and source range.

### Source location

A line and column identifying one position in a source file.

### Source range

A start and end source location identifying a span of source text.

### Partial document

A usable parsed document returned alongside diagnostics when malformed source
permits structural recovery.

### Structural validity

The absence of error diagnostics for grammar, required sections, imports,
workspace rules, and other deterministic language constraints. Structural
validity does not imply semantic readiness or human approval.

### Semantic readiness

The degree to which a contract is specific and coherent enough to guide the
intended implementation or review without material invention. It includes goal
clarity, interface completeness, observable cases, cross-Sigil coherence,
modularity, and applicable external guidance. It is not a parser result.

### Visual reference

An image, screenshot, ASCII wireframe, or external design link included as
free-form interface content. Sigil defines no special visual-reference keyword
or authority syntax.

## Workspace And Project Model

### `.sigil/config.json`

The mandatory strict JSON configuration file that defines a Sigil workspace
root, language version, workspace identity, optional project members, source
discovery rules, and namespaced host settings.

### Workspace

All Sigil sources governed by one `.sigil/config.json`. A workspace may contain
one root project and zero or more declared member projects.

### Workspace root

The directory containing `.sigil/config.json`. It is also the root project's
location and the base for `@` import resolution.

### Workspace name

The non-empty stable identifier stored in `workspace.name`. It identifies the
workspace and does not name every project inside it.

### Workspace member

A non-root, workspace-relative project path explicitly listed in
`workspace.members`.

### Member root

The directory identified by a `workspace.members` entry. It is a project root
eligible to contain `#module.sigil`, but it does not contain a separate
`.sigil/config.json`.

### Project

A coherent buildable, distributable, deployable, or otherwise independently
summarized unit located at the workspace root or a declared member root. In
Sigil, a project is not inferred from a package manifest or arbitrary
directory.

### Root project

The project located at the workspace root.

### Project root

The directory containing one project: either the workspace root or a declared
member root.

### RootSigil

The project-level contract stored in an eligible `#module.sigil`. It summarizes
one project's purpose, external interaction surfaces, and project-wide
operational decisions. It does not define workspace discovery or membership.

### `#module.sigil`

The reserved filename for RootSigil. It is valid only at the workspace root or
a declared member root. Ordinary internal directories and components use
descriptive `.sigil` filenames.

### Descriptive Sigil filename

An ordinary `.sigil` filename that identifies the responsibility or concern it
describes, such as `auth.sigil`, `workspace.sigil`, or
`booking-calendar-view.sigil`.

### Internal Sigil source

A Sigil source below a project boundary that describes a component or
implementation concern rather than the entire project. It uses a descriptive
filename and explicit-file imports.

### Independent workspace

A nested directory with its own `.sigil/config.json` whose entire subtree is
excluded by every configured parent workspace. It is not a member of its
parent.

### Nested configuration

A `.sigil/config.json` below another configured workspace. It is valid only
when its subtree is excluded from the parent; otherwise it is a workspace
diagnostic.

### Included source

A `.sigil` file matching at least one `files.include` glob and no
`files.exclude` glob in the governing workspace configuration.

### Excluded subtree

A directory tree matched by the parent workspace's exclusion rules. Its Sigil
sources do not belong to that parent workspace.

### Workspace discovery

The deterministic process of locating and validating the governing
`.sigil/config.json`, including nested-workspace eligibility.

### Source discovery

The deterministic process of selecting included Sigil files under a discovered
workspace root.

## Parsing, Resolution, Graphs, And Diagnostics

### Parser

The deterministic core stage that converts one Sigil source into a partial or
complete Sigil document without reading files or resolving imports.

### Parse

To interpret the structure of one Sigil source using an explicit supported
language version.

### Workspace loader

The deterministic core stage that discovers configuration, selects source
files, parses them, and identifies member and RootSigil locations.

### Resolver

The deterministic core stage that connects imports to target documents and
components, detects relationship errors, and collects expansions.

### Resolution

The result of resolving imports, components, expansions, and their diagnostics
across a loaded workspace.

### Unresolved import path

An import whose resolved target file does not exist in the loaded workspace.

### Unresolved imported component

An imported name for which the target document has no matching component
declaration.

### Duplicate component

Multiple declarations of the same case-sensitive component name in one
workspace, making name-based references ambiguous.

### Import cycle

A dependency path in which following file imports returns to a previously
visited file.

### Graph

The deterministic relationship model derived from resolved Sigil declarations.

### Node

One entity represented in a graph. The current Sigil graph exposes component
nodes.

### Edge

One directed relationship represented in a graph, such as a file import,
imported component, or component-to-expansion relationship.

### Projection

A structured view derived from resolved core models for use by CLI, LSP,
editors, agents, or renderers without changing Sigil semantics.

### Component contract projection

A structured view of a component's name, source, goal lines, and interface
lines.

### Diagnostic

A structured finding with a stable code, severity, message, and optional file
and source range.

### Error diagnostic

A diagnostic that makes the checked source or workspace structurally invalid
for the affected operation.

### Warning diagnostic

A non-fatal diagnostic identifying a concern that does not make the operation
structurally invalid.

### Informational diagnostic

A non-fatal diagnostic providing context without indicating structural
invalidity.

### Host failure

An operating-system, runtime, filesystem, or process failure that prevents a
tool from completing its operation. It is propagated to the host rather than
recast as a Sigil source diagnostic.

### Stable diagnostic code

A machine-readable identifier whose meaning is part of the core API contract.
Consumers should branch on the code rather than parse the human message.

## Workflow And Review

### Agent

A coding or reasoning system that reads Sigil and repository evidence, works
with the user, and may propose or implement changes within the review gates.

### Host

The environment integrating an agent or tool with Sigil, such as Codex, an
editor, CI, or another automation system.

### Host integration

Host-specific behavior under `integrations/`, including user elicitation,
model-assisted judgment, external research, and editor adapters.

### Deterministic

Given the same versioned inputs and environment contract, the operation is
expected to produce the same semantic result without model inference or
external research.

### Model-assisted

An operation in which a model interprets natural language, reconciles evidence,
or proposes a result. Model-assisted output must remain attributed and must not
be presented as deterministic core truth.

### Greenfield

A design situation in which the selected behavior or component has no existing
implementation constraining its intended contract.

### Brownfield

A design or reconciliation situation in which relevant implementation exists
but Sigil coverage is absent, incomplete, ambiguous, or suspected to have
drifted.

### Repository evidence

Existing code, tests, documentation, manifests, executable configuration,
entrypoints, designs, and related artifacts used to understand current
behavior. Evidence does not automatically establish desired intent.

### Application picture

A provisional description of an existing application's responsibility, users
or systems, boundaries, and external interaction surfaces derived from
repository evidence and user confirmation.

### Pilot boundary

The deliberately limited component or behavior selected for initial brownfield
Sigil adoption.

### Change frontier

The smallest coherent boundary containing the behavior and decisions affected
by a requested change.

### Design conversation

A structured collaboration that frames, explores, resolves, and synthesizes
material product, contract, ownership, lifecycle, architecture, risk, and
verification decisions before Sigil or implementation is proposed.

### Framing

The design-conversation phase that establishes outcome, users or callers,
boundary, and relevant evidence.

### Exploring

The phase that discovers material decisions, alternatives, conflicts,
assumptions, and pitfalls.

### Resolving

The phase that decides questions shaping the contract.

### Synthesizing

The phase that combines resolved decisions into a coherent design and exact
proposed Sigil.

### Confirmed decision

A material decision explicitly selected by the user or already established by
approved Sigil.

### Provisional assumption

A conservative, reversible decision temporarily used with the user's
knowledge because certainty is unavailable.

### Intentionally deferred decision

A visible unresolved choice that does not materially block the current
contract and is deliberately postponed.

### Unresolved decision

A material choice for which no governing intent has been selected.

### Blocking decision

An unresolved choice that could materially change public behavior, ownership,
permissions, persistent data, lifecycle, failure behavior, architecture, or
acceptance criteria.

### Proposal gate

The requirement to show exact proposed semantic changes and obtain approval
before writing brownfield-reconstructed or externally informed Sigil.

### Semantic review gate

The mandatory stop after creating or semantically changing Sigil. The user must
review and approve the complete resulting contract before implementation.

### Approval

An explicit human decision accepting a specific Sigil contract or proposal for
its stated next use. Successful parsing, checking, rendering, or testing never
implies approval.

### Implementation coverage

The degree to which every material implementation concern has an intentional
component, expand, or omit decision with a clear owner and location.

### Implementation coverage map

A review artifact listing material concerns, owners, dependents, selected Sigil
forms, and owning locations before code is written.

### Omit decision

An explicit decision not to create separate Sigil for trivial mechanics whose
behavior and rationale are local, obvious, and safely reconstructable.

### Colocation

Placing an approved component or implementation-specific expand as near as
practical to the implementation it owns or explains.

### Placement-only change

Moving or splitting approved Sigil without adding, removing, or changing its
semantic lines, plus the import-path updates required by that relocation.

### Semantic change

Any addition, removal, or modification of a semantic line or public component
contract. A semantic change requires review even when structural checks pass.

### Drift

A disagreement between Sigil and relevant implementation, tests,
documentation, configuration, or other approved contracts. Drift identifies a
conflict; it does not determine which side is correct.

### Standards-aware review

Semantic review that assesses whether authoritative external standards,
protocols, platform guidance, or best practices materially affect the selected
contract.

### Compatible guidance

External guidance that adds useful detail without contradicting approved
Sigil, repository facts, or explicit user decisions.

### Potential conflict

A possible disagreement whose applicability, scope, evidence, or intended
contract remains uncertain.

### Definite conflict

Two applicable requirements or explicit decisions that cannot both be
satisfied as written.

### Unverifiable guidance

Purportedly relevant guidance whose authoritative material is unavailable,
ambiguous, obsolete, or outside the reviewer's competence.

### Non-applicable guidance

Guidance that does not govern or materially inform the selected component.

### Appears aligned

A provisional review outcome meaning accessible evidence revealed no conflict
within the stated scope. It is not a certification claim.

### Partially assessed

A provisional review outcome meaning only part of the relevant guidance or
scope was available or reviewed.

### Gap identified

A provisional review outcome meaning the contract omits a relevant decision or
guidance item.

### Conflict identified

A provisional review outcome meaning the contract and applicable guidance
cannot both hold as written.

### Not assessable

A provisional review outcome meaning available evidence or expertise is
insufficient to reach an assessment.

## Platform And Tooling

### `sigil-core`

The deterministic TypeScript library owning configuration parsing, source
parsing, workspace discovery and loading, resolution, graphs, diagnostics,
source fidelity, and projection primitives.

### Core

Short name for `sigil-core` when the package boundary is clear.

### `sigil-cli`

The non-interactive command-line adapter exposing Sigil behavior to agents, CI,
scripts, debugging, and review workflows. Its published package is
`@qoherent/sigil` and its executable is `sigil`.

### CLI

Command-line interface. In this project, the unqualified term usually means
`sigil-cli`.

### `sigil-lsp`

The editor-neutral language server that exposes core-backed Sigil diagnostics,
symbols, definitions, hover, and semantic tokens through LSP.

### LSP

Language Server Protocol, the editor-neutral request, response, notification,
and capability protocol used by `sigil-lsp`.

### JSON-RPC

The message model and framing semantics used by LSP requests, responses,
notifications, and errors.

### Language server

A process implementing LSP features independently of one specific editor UI.

### VS Code extension

The concrete editor integration that registers `.sigil`, supplies TextMate
syntax highlighting, starts the bundled language server, and exposes component
preview behavior.

### TextMate grammar

The editor grammar used for syntax-based coloring without workspace resolution.

### Semantic token

An LSP-provided, resolver-backed classification used for semantic highlighting.

### Hover

An LSP response showing contextual Markdown for a selected component or source
position.

### Component preview

The VS Code read-only Markdown view derived from a standard component hover
response.

### Filesystem port

The abstract file-reading, existence, and listing interface through which core
accesses host filesystems.

### Filesystem adapter

A host-specific implementation of the filesystem port, such as the Deno or
Node adapter.

### Overlay filesystem

A filesystem view that substitutes in-memory open-document text for the
corresponding on-disk file while preserving other filesystem behavior.

### Pipeline

The core composition that moves typed data through loading, resolution, graph
construction, and projections without mixing host presentation concerns into
semantic stages.

### Context

A focused projection of selected component contracts, collected expansions,
related files, and diagnostics. It is smaller than the complete workspace.

### Render

To project resolved Sigil into human-readable Markdown without changing its
meaning or source.

### Machine-readable output

Structured JSON intended as the stable automation interface for agents, CI,
and scripts.

### Human-readable output

Convenience text or Markdown intended for direct reading. It is not the stable
automation contract unless explicitly documented otherwise.

### CI

Continuous integration: automated validation run for repository changes.

### API

Application programming interface. In this project it may refer to exported
library functions, CLI result shapes, or LSP behavior; qualify which interface
is intended.

### ADR

Architecture Decision Record: a document capturing the context, options,
decision, rationale, and consequences of a material architectural choice.

### AST

Abstract syntax tree: a structured representation produced by a programming
language parser. In the proposed indexer, AST nodes are source evidence and not
durable identities.

### VSIX

The installable archive format used to distribute the VS Code extension.

## Versions, Statuses, And Scope

### Sigil version

The language and workspace-contract version stored as `sigilVersion` in
`.sigil/config.json` and sourced from `packages/core/deno.json`.

### Package version

The independently versioned release number of a package such as core, CLI, or
LSP. It is not a workspace configuration field.

### Integration version

The independently versioned release number of a host integration such as the
VS Code extension or Sigil skill.

### Semantic version

A version shaped as `major.minor.patch`, optionally with prerelease or build
metadata. Breaking interpretation changes require an appropriate language
version change.

### Pre-production

A released or implemented surface that is not claimed to have production
stability, readiness, or a stable 1.0 compatibility contract.

### Initial 0.x scope

The capabilities deliberately included before production readiness. It is a
scope boundary, not a promise that every future 0.x feature is implemented.

### Proposed

Documented for review but not yet approved as a governing decision or
authorized for implementation.

### Accepted

Reviewed and approved as a governing design decision. Acceptance does not by
itself prove that implementation is complete.

### Implemented

Present in executable code or a working integration and supported by relevant
validation. Implementation does not imply production readiness.

### Deferred

Deliberately placed outside the current delivery scope without being rejected.

### Superseded

Replaced as the current decision authority by a newer decision while retained
as historical context.

### Out of scope

Explicitly excluded from the selected contract or delivery stage.

## Proposed Receipts And Anchors

The terms in this section describe proposed capabilities from
[ADR-011](decisions/adr-011-generated-rationale-evidence-and-review-records.md).
They are not part of the implemented Sigil 0.1 surface unless separately marked
implemented.

### Receipt

An attributed, generated record describing what one Sigil target says, how it
was interpreted, which material inventions or uncertainties remain, which
checks ran, and what evidence supported them.

### Receipt target

The entity assessed by a receipt. The proposed initial target is one semantic
line.

### Receipt fragment

One validated contribution to a receipt, such as a deterministic fact, host
interpretation, researched finding, invention, check, or evidence reference.

### Review run

One explicit generation of a versioned set of receipts and its manifest.
Durable completed runs are proposed to be immutable.

### Run manifest

Metadata describing a review run's identity, versions, inputs, policies,
fingerprints, provenance, completion, counts, and digest.

### Producer

The attributed origin of a receipt contribution. Proposed producer kinds are
`core`, `checker`, `host`, `research`, and `human`.

### Check

A structured evaluation record with a stable kind, producer, status, summary,
requirement flag, evidence references, and version information.

### Check status

The result of one proposed receipt check: `pass`, `warning`, `fail`, or
`not_checked`.

### Assessment

The proposed receipt dimension summarizing required check results and remaining
material uncertainty as `green`, `yellow`, `red`, or `gray`.

### Green

Every check required by the selected policy passed and no material unresolved
invention remains. It does not mean approved or certified.

### Yellow

The target is interpretable but warnings, uncertainty, or material invention
remain.

### Red

A required check failed, a reference is broken, or a contradiction or invalid
state is present.

### Gray

The target was parsed but no applicable semantic review policy was run.

### Freshness

The proposed receipt dimension indicating whether recorded inputs, policies,
producers, and evidence still match the current environment.

### Current

The receipt still matches the relevant recorded inputs and fingerprints.

### Stale

At least one relevant source, dependency, context, checker, policy, producer,
or evidence fingerprint has changed since the receipt was produced.

### Approval state

The proposed receipt dimension recording human review independently from
assessment and freshness: `unreviewed`, `approved`, `rejected`, or
`superseded`.

### Evidence

An identified source supporting or challenging a check or interpretation, such
as resolved Sigil, code, tests, configuration, documentation, an accepted
anchor, external guidance, or human attestation. Evidence does not
automatically prove a claim.

### Invention

A material behavior, assumption, or decision introduced by an interpreter that
was not established by the source or governing evidence.

### Anchor

A reviewed relationship connecting a Sigil semantic line to implementation
evidence without changing the line's meaning or proving behavioral compliance.

### Anchor index

The proposed versioned workspace sidecar `.sigil/anchors.json` containing
accepted anchor relationships and locator snapshots.

### Source index

A deterministic, disposable model of implementation symbols, tests,
relationships, ranges, and fingerprints used to generate or reconcile anchor
candidates.

### Anchor candidate

A bounded possible implementation target produced deterministically for human
inspection or model-assisted proposal.

### Anchor proposal

An attributed suggestion that one semantic line has a particular relationship
to one candidate source target. A proposal is not an accepted anchor.

### Locator

A versioned set of identifying and recovery data for a Sigil semantic line or
source target, including paths, names, ranges, hashes, and contextual signals.

### Fingerprint

A deterministic digest or summary used to identify content and detect change.
A fingerprint is evidence for reconciliation, not permanent identity by itself.

### Relationship ID

A stable identifier for one accepted anchor relationship across locator
updates.

### `implements`

The proposed anchor relationship indicating that a source target implements
behavior or structure described by a Sigil line.

### `verifies`

The proposed anchor relationship indicating that a test or check verifies an
observable expectation described by a Sigil line.

### `supports`

The proposed anchor relationship indicating that a source target provides
relevant supporting evidence without being the primary implementation or
verification.

### Reconciliation

The deterministic process of comparing stored locators with current source and
classifying each accepted anchor after change.

### Resolved anchor

An anchor whose current target is identified without material structural
change.

### Changed anchor

An anchor whose target remains identifiable but changed structurally and needs
review attention.

### Ambiguous anchor

An anchor for which multiple current targets are plausible and no target may be
selected silently.

### Missing anchor

An anchor whose target can no longer be located.

## Stable Diagnostic Codes

| Code | Meaning |
| --- | --- |
| `SIGIL_PARSE_STRUCTURE` | Source structure or brace organization is malformed. |
| `SIGIL_UNKNOWN_SECTION` | A form contains a section name not allowed for that form. |
| `SIGIL_MISSING_GOAL` | A component lacks its required `goal` section. |
| `SIGIL_MISSING_INTERFACE` | A component lacks its required `interface` section. |
| `SIGIL_UNRESOLVED_IMPORT_PATH` | An import path does not resolve to a loaded Sigil source. |
| `SIGIL_UNRESOLVED_IMPORTED_COMPONENT` | An imported name is not declared as a component in the target source. |
| `SIGIL_INVALID_ROOT_MODULE` | `#module.sigil` appears outside the workspace root or a declared member root. |
| `SIGIL_INVALID_DIRECTORY_IMPORT` | A directory import targets a location that is not an eligible project root. |
| `SIGIL_EXPAND_WITHOUT_COMPONENT` | An expand has no matching component declaration in the workspace. |
| `SIGIL_DUPLICATE_COMPONENT` | More than one component declares the same name, making references ambiguous. |
| `SIGIL_IMPORT_CYCLE` | File import relationships contain a cycle. |
| `SIGIL_CONFIG_NOT_FOUND` | The required workspace configuration cannot be found at the selected location. |
| `SIGIL_CONFIG_PARSE` | `.sigil/config.json` is not valid JSON. |
| `SIGIL_CONFIG_INVALID` | The parsed configuration violates the configuration contract. |
| `SIGIL_UNSUPPORTED_VERSION` | The configured Sigil version is not supported by the running core. |
| `SIGIL_NESTED_CONFIG` | A nested configuration violates parent exclusion or member rules. |
| `SIGIL_CONFIG_EXISTS` | Initialization was asked to create a configuration where one already exists. |

## CLI Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed without error diagnostics; warnings may exist. |
| `1` | The command completed and reported configuration or Sigil error diagnostics. |
| `2` | Command arguments or usage are invalid. |
| `3` | A host or runtime failure prevented normal completion. |

## Reserved Names And Paths

| Name or path | Meaning |
| --- | --- |
| `.sigil/config.json` | Mandatory workspace configuration and workspace-boundary authority. |
| `#module.sigil` | RootSigil filename allowed only at eligible project roots. |
| `.sigil/anchors.json` | Proposed committed sidecar for accepted anchors. |
| `.sigil/runs/` | Proposed directory for immutable receipt review runs. |
| `.sigil/latest.json` | Proposed pointer to the latest completed receipt run. |
| `spec/` | Durable language, workflow, architecture, compatibility, and decision documentation. |
| `packages/` | Buildable or distributable shared platform units. |
| `integrations/` | Host-specific skills, adapters, and editor integrations. |
| `examples/` | Independent fixtures and design-pressure examples, not the repository's product purpose. |

## Maintenance

Add or update a glossary entry when a change introduces:

- a language keyword or form;
- a reserved filename, path, configuration key, status, or diagnostic code;
- a public package, tool, command family, or protocol term;
- a workflow gate or decision state;
- a term whose meaning differs from common programming usage;
- a proposed concept used across more than one design document.

Definitions should identify whether a concept is normative, implemented,
proposed, or deferred. A glossary update summarizes an approved contract; it
must not silently create a new language rule or architectural decision.
