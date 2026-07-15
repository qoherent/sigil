# sigil-core Requirements

**Status:** Accepted for 1.0.0
**Last updated:** 2026-07-13

This document defines the v1 product requirements for `sigil-core`.
Architecture style, module boundaries, and dependency rules live in [architecture.md](architecture.md).

## 1. Purpose

`sigil-core` is the shared semantic engine for the Sigil platform.

It must give CLI, LSP, editor integrations, renderers, agent context builders, and tests one consistent way to understand Sigil.

## 2. V1 Scope

V1 is the parser and resolver foundation.

It must:

- parse `.sigil` files using an explicit supported Sigil version;
- parse and validate strict `.sigil/config.json` using the canonical Sigil version;
- preserve source locations and semantic lines;
- discover the nearest eligible ancestor config or use an explicit configured root;
- apply include and exclude globs and permit independent workspaces only inside excluded subtrees;
- load workspace files through an abstract filesystem boundary;
- resolve `@path import { Name }` declarations from the workspace root;
- read additional project roots exclusively from `workspace.members` in
  `.sigil/config.json`;
- reject `#module.sigil` files and directory imports outside valid `RootSigil`
  locations;
- identify public components and matching expansions;
- collect all matching `expand Name` blocks without override or shadowing semantics;
- build graph primitives for files, imports, components, and expansions;
- return partial models plus diagnostics when source is malformed;
- expose stable machine-readable diagnostic codes.

## 3. Out Of Scope

V1 must not implement:

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
- import aliases, re-exports, or wildcard imports.

Anchors remain outside `sigil-core`. The proposed vNext design in ADR-010 adds
them through a separate deterministic `sigil-indexer` package that consumes
core semantic-line and workspace models.

## 4. Public Interface Requirements

`sigil-core` should expose a typed Deno TypeScript library API.

Exact function names may evolve during implementation, but the public API must provide these capabilities:

- parse one Sigil source file;
- discover or accept a workspace root;
- load a workspace through an abstract filesystem;
- resolve imports, components, expansions, and graph relationships;
- return diagnostics with stable codes;
- expose primitive structured projections over resolved models.

The public API should be usable by:

- `sigil-cli`;
- `sigil-lsp`;
- editor integrations;
- tests with an in-memory filesystem;
- future host integrations.

## 5. Required Types

The model should include typed concepts equivalent to:

- `SourceRange`;
- `SourceLocation`;
- `SigilDocument`;
- `ImportDeclaration`;
- `ComponentDeclaration`;
- `ExpandDeclaration`;
- `Section`;
- `SemanticLine`;
- `SigilWorkspace`;
- `SigilConfig`;
- `ResolvedComponent`;
- `CollectedExpansion`;
- `SigilGraph`;
- `SigilDiagnostic`;
- `SigilFileSystem`.

`SemanticLine` must include:

- file path;
- source range;
- owner kind;
- owner name;
- section name;
- text.

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

Concrete filesystem adapters belong outside core logic or in thin adapter layers that do not leak into parser and resolver modules.

## 7. Error And Diagnostic Policy

Malformed Sigil should produce partial models plus diagnostics.

`sigil-core` should fail only when the host-provided filesystem boundary itself cannot satisfy an operation required by the requested API.

V1 diagnostics must include stable codes for:

- parse structure errors;
- unknown section;
- missing `goal`;
- missing `interface`;
- unresolved import path;
- unresolved imported component;
- invalid `RootSigil` location;
- invalid directory import;
- expand without matching component;
- duplicate component ambiguity;
- missing, malformed, invalid, unsupported, existing, or nested config;
- import cycle protection.

## 8. Workspace And Import Requirements

The workspace root contains mandatory `.sigil/config.json` with the canonical Sigil version.
Without an explicit root, the nearest ancestor config owns the target when every
higher configured workspace excludes that nearer root. An explicit root must
contain the config directly. Nested configs inside included paths are errors;
excluded nested subtrees are independent workspaces and are skipped by parents.

Import paths begin with `@` and resolve from the workspace root.

A directory import resolves to `#module.sigil` only at the workspace root or a
member root declared by `workspace.members`. Package manifests and repository
workspace declarations do not authorize RootSigil locations. A nested directory
with its own `.sigil/config.json` is an excluded independent workspace rather than a
member project. Ordinary internal contracts use explicit `.sigil` filenames.

A file import resolves to the exact `.sigil` file.

Imported names must resolve to matching `component Name` declarations.

## 9. Acceptance Scenarios

V1 is acceptable when tests demonstrate that `sigil-core` can:

- parse `examples/promise/promise.sigil`;
- preserve semantic lines with owner, section, text, file, and source range;
- discover the repository `.sigil/config.json` from nested targets that remain in the root workspace;
- discover Promise and Slotted through their independent example configs;
- treat `examples/slotted/#module.sigil` as the Slotted workspace summary;
- resolve `examples/slotted/auth.sigil` imports from the Slotted workspace root;
- collect matching expansions for resolved components;
- return partial models plus diagnostics for malformed files;
- emit stable diagnostic codes;
- run core tests with an in-memory filesystem implementation.
