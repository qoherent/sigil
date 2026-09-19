# sigil-core Requirements

**Status:** Accepted for 0.7.1 **Last updated:** 2026-08-04

This document defines the 0.7 product requirements for `sigil-core`.
Architecture style, module boundaries, and dependency rules live in
[architecture.md](architecture.md).

## 1. Purpose

`sigil-core` is the shared semantic engine for the Sigil platform.

It must give CLI, LSP, editor integrations, renderers, agent context builders,
and tests one consistent way to understand Sigil.

## 2. Version 0.7 Scope

Version 0.7 extends the parser and resolver foundation with reviewed glossary
authority, scoped terminology projections, reusable Concepts, and visibility for
Tags introduced in or outside `interface`, and optional decision rationale.

It must:

- parse `.sigil` files using an explicit supported Sigil version;
- parse and validate strict `.sigil/config.json` using the canonical Sigil
  version;
- parse and validate optional strict `.sigil/glossary.json` schema version 1;
- preserve source locations and Facets;
- preserve attached fenced content as uninterpreted content;
- diagnose every resolved imported name without qualifying local use;
- provide deterministic in-memory formatting at 79 prose content characters;
- resolve non-overlapping path-glob glossary contexts;
- match reviewed canonical terms and aliases in eligible Sigil prose using
  case-insensitive whole-phrase, longest-first rules;
- preserve glossary declaration and occurrence source ranges;
- parse flat, nonempty Concepts and retain each line's Tag name;
- parse optional `decisions` sections as free-form grouped or ungrouped semantic
  content;
- discover the nearest eligible ancestor config or use an explicit configured
  root;
- apply include and exclude globs and permit independent workspaces only inside
  excluded subtrees;
- load workspace files through an abstract filesystem boundary;
- resolve `@path import { Name }` declarations from the workspace root;
- read additional project roots exclusively from `workspace.members` in
  `.sigil/config.json`;
- allow `_module.sigil` in any included directory and resolve its local and
  independently resolved imported names through converged directory imports;
- preserve explicit-file import access to every public component regardless of
  module-index membership;
- identify public components and matching expansions;
- collect all matching `expand Name` blocks without override or shadowing
  semantics;
- share one case-insensitively unique Tag scope across each component
  and all matching expands;
- expose imported Tags introduced in `interface` without making private expansion
  details part of the dependent-facing contract;
- project direct dependencies' public contracts and `decisions` sections as
  bounded agent rationale while excluding transitive and other private
  dependency sections by default;
- preserve an imported Tag's originating identity through contextual reuse
  and downstream `interface` re-exposure;
- build graph primitives for files, imports, components, and expansions;
- return partial models plus diagnostics when source is malformed;
- expose stable machine-readable diagnostic codes.

## 3. Out Of Scope

Version 0.7 must not implement:

- CLI argument parsing;
- LSP transport;
- VS Code APIs;
- Codex prompt behavior;
- editor UI;
- Markdown rendering;
- full agent context ranking;
- embeddings or semantic search;
- anchors or code/spec synchronization;
- generated diagrams;
- export forms, import aliases, or wildcard imports;
- dotted Concept notation, Concept aliases, shadowing, or nested Concepts;
- Concept-based anchoring behavior.
- inferred glossary definitions or automatic glossary mutation.

Anchors remain outside `sigil-core`. The historical design in ADR-011 described
them through a separate deterministic `sigil-indexer` package that consumes core
Facet and workspace models.

## 4. Public Interface Requirements

`sigil-core` should expose a typed Deno TypeScript library API.

Exact function names may evolve during implementation, but the public API must
provide these capabilities:

- parse one Sigil source file;
- discover or accept a workspace root;
- load a workspace through an abstract filesystem;
- resolve imports, components, expansions, and graph relationships;
- format a valid parsed document deterministically without filesystem access;
- return diagnostics with stable codes;
- expose primitive structured projections over resolved models.

The public API should be usable by:

- `sigil-cli`;
- `sigil-lsp`;
- editor integrations;
- tests with an in-memory filesystem;
- future host integrations.

## 5. Required Types

The model should include typed entities equivalent to:

- `SourceRange`;
- `SourceLocation`;
- `SigilDocument`;
- `ImportDeclaration`;
- `ComponentDeclaration`;
- `ExpandDeclaration`;
- `Section`;
- `Facet`;
- `EmbeddedFacet`;
- `EmbeddedContent`;
- `TagGroup`;
- `WorkspaceGlossary`;
- `GlossaryTerm`;
- `GlossaryContext`;
- `GlossaryOccurrence`;
- `GlossaryProjection`;
- `GlossaryContextProjection`;
- `ResolvedTagReference`;
- `ResolvedTagScope`;
- `SigilWorkspace`;
- `SigilConfig`;
- `ResolvedComponent`;
- `CollectedExpansion`;
- `AgentDependencyContext`;
- `DependencyDecisionView`;
- `SigilGraph`;
- `SigilDiagnostic`;
- `SigilFileSystem`.

`glossaryContextForFiles` must preserve deterministic declaration and source
order while returning only accepted terms and occurrences recognized in the
selected source files.

`Facet` must include:

- file path;
- source range;
- owner kind;
- owner name;
- section name;
- optional Concept grouping;
- normalized prose;
- original physical lines;
- attached fenced content.

An `EmbeddedFacet` includes introducing prose and nonempty `EmbeddedContent`.
The fenced payload alone is not the native Facet. Existing serialized `units`
and `literalBlocks` field names remain stable; they do not define language
primitives. `isEmbeddedFacet` narrows the complete content-bearing Facet.

`SigilDiagnostic` must include:

- stable code;
- severity;
- message;
- file path when available;
- source range when available.

## 6. Filesystem Boundary

`sigil-core` must use an abstract filesystem port.

Core logic must not call Deno filesystem APIs directly.

The filesystem boundary must support:

- reading text files;
- checking whether paths exist;
- listing workspace files needed for discovery and loading;
- normalizing paths consistently enough for cross-platform behavior.

Concrete filesystem adapters belong outside core logic or in thin adapter layers
that do not leak into parser and resolver modules.

## 7. Error And Diagnostic Policy

Malformed Sigil should produce partial models plus diagnostics.

`sigil-core` should fail only when the host-provided filesystem boundary itself
cannot satisfy an operation required by the requested API.

Version 0.7 diagnostics must include stable codes for:

- parse structure errors;
- unknown section;
- missing `goal`;
- missing `interface`;
- unresolved import path;
- unresolved imported component;
- expand without matching component;
- duplicate component ambiguity;
- missing, malformed, invalid, unsupported, existing, or nested config;
- import cycle protection.
- incomplete, invalid, ambiguous, and non-preferred Tag names, and empty or
  nested Concepts.

## 8. Workspace And Import Requirements

The workspace root contains mandatory `.sigil/config.json` with the canonical
Sigil version. Without an explicit root, the nearest ancestor config owns the
target when every higher configured workspace excludes that nearer root. An
explicit root must contain the config directly. Nested configs inside included
paths are errors; excluded nested subtrees are independent workspaces and are
skipped by parents.

Import paths begin with `@` and resolve from the workspace root.

A directory import resolves to `_module.sigil` in the target directory. The
directory-import surface contains components declared locally in that index and
components named by its independently resolved imports. Chained and cyclic
surfaces converge by declaration identity; repeated identities deduplicate and
names with distinct identities remain absent. Diagnostics on one import or the
local-component requirement do not discard unaffected names. Workspace members
do not grant or restrict module-index locations. A nested directory with its
own `.sigil/config.json` is an excluded independent workspace rather than a
member project.

A file import resolves to the exact `.sigil` file.
The legacy `#module.sigil` basename is an ordinary source and has no
directory-index behavior.

Imported names must resolve to matching public `component Name` declarations.
Components omitted from a module index remain importable through explicit file
paths.

Every resolved imported name must have qualifying local use in `interface`,
`state`, `logic`, `constraints`, or `cases`, through a matching local `expand`,
or through direct `_module.sigil` surface exposure. Documentary mentions in
`goal`, `decisions`, fenced content, comments, and annotations do not count.

## 9. Acceptance Scenarios

Version 0.7 is acceptable when tests demonstrate that `sigil-core` can:

- parse `examples/promise/promise.sigil`;
- preserve Facets with owner, section, normalized prose, original
  physical lines, attached fenced content, file, and source range;
- discover the repository `.sigil/config.json` from nested targets that remain
  in the root workspace;
- discover Promise and Slotted through their independent example configs;
- treat `examples/slotted/_module.sigil` as the Slotted workspace summary;
- diagnose imports-only module indexes with `SIGIL_MODULE_WITHOUT_COMPONENT`;
- preserve original declaration paths through module indexes for graphs and
  editors;
- keep omitted components importable through explicit `.sigil` paths;
- resolve `examples/slotted/auth.sigil` imports from the Slotted workspace root;
- diagnose each resolved imported name without qualifying use;
- exclude embedded-content content from import, Tag, and glossary references;
- format prose idempotently at 79 content characters while preserving literal
  bodies and structural indentation;
- collect matching expansions for resolved components;
- preserve ungrouped and Concept-grouped Facets in source order without grouping
  diagnostics in any contract;
- resolve imported Tags introduced in `interface` as bare names and keep Tags
  introduced outside `interface` inaccessible to dependents;
- project each direct dependency contract and decision section once for agent
  context while excluding transitive decisions and non-decision private
  sections;
- resolve exact-case whole-word Tag references into Tag scopes
  with originating identities and source ranges;
- exclude ambiguous identities, case mismatches, substrings, and unmatched words
  from contextual references without producing unresolved-Tag diagnostics;
- diagnose case-insensitive ambiguity and invalid Tag names or empty or nested
  Concepts;
- return partial models plus diagnostics for malformed files;
- emit stable diagnostic codes;
- run core tests with an in-memory filesystem implementation.
