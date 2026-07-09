# sigil-core Requirements

**Status:** Draft
**Owner:** _TBD_
**Last updated:** 2026-07-09

This document defines the v1 product requirements for `sigil-core`.
Architecture style, module boundaries, and dependency rules live in [architecture.md](architecture.md).

## 1. Purpose

`sigil-core` is the shared semantic engine for the Sigil platform.

It must give CLI, LSP, editor integrations, renderers, agent context builders, and tests one consistent way to understand Sigil.

## 2. V1 Scope

V1 is the parser and resolver foundation.

It must:

- parse `.sigil` files into typed document models;
- preserve source locations and semantic lines;
- discover Sigil workspaces through an explicit root or the topmost discovered `#module.sigil`;
- load workspace files through an abstract filesystem boundary;
- resolve `@path import { Name }` declarations from the workspace root;
- treat nested `#module.sigil` files as importable module directory summaries;
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
- expand without matching component;
- duplicate component ambiguity;
- inferred workspace root;
- import cycle protection.

## 8. Workspace And Import Requirements

Until project configuration exists, the workspace root is the topmost ancestor directory containing `#module.sigil`, unless a caller supplies an explicit root.

If no ancestor `#module.sigil` exists and no explicit root is supplied, `sigil-core` may infer the caller-provided current directory as the workspace root and must emit an inferred-root diagnostic.

Import paths begin with `@` and resolve from the workspace root.

A directory import resolves to `#module.sigil` inside that directory.

A file import resolves to the exact `.sigil` file.

Imported names must resolve to matching `component Name` declarations.

## 9. Acceptance Scenarios

V1 is acceptable when tests demonstrate that `sigil-core` can:

- parse `examples/promise/promise.sigil`;
- preserve semantic lines with owner, section, text, file, and source range;
- discover the repository root `#module.sigil` as the workspace root;
- treat `examples/slotted/#module.sigil` as a nested module summary;
- resolve `examples/slotted/auth.sigil` imports from the topmost workspace root;
- collect matching expansions for resolved components;
- return partial models plus diagnostics for malformed files;
- emit stable diagnostic codes;
- run core tests with an in-memory filesystem implementation.
