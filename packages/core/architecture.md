# sigil-core Architecture

**Status:** Draft
**Owner:** _TBD_
**Last updated:** 2026-07-09

This document defines the architecture style, internal modules, dependency rules, and implementation guidelines for `sigil-core`.
Product requirements live in [spec.md](spec.md).
Platform-wide boundaries live in [../../spec/sigil-platform-architecture.md](../../spec/sigil-platform-architecture.md).

## 1. Architecture Style

`sigil-core` uses a pipeline plus ports architecture.

The main flow is:

```text
parse -> load workspace -> resolve imports/components/expands -> build graph -> emit diagnostics/projection primitives
```

The pipeline should move typed data forward through pure or mostly pure stages.
Host-specific effects enter through ports, especially the filesystem boundary.

## 2. Design Principles

- Keep the model typed and explicit.
- Preserve source fidelity from the first parse.
- Prefer partial results plus diagnostics over hard failure.
- Keep section body text free-form.
- Treat parser, resolver, graph, diagnostics, and projections as peers.
- Keep host behavior outside `sigil-core`.
- Make tests possible with an in-memory filesystem.

## 3. Internal Modules

### `model`

Owns shared immutable types.

Responsibilities:

- source locations and ranges;
- document and declaration models;
- sections and semantic lines;
- workspace and graph models;
- diagnostic shape;
- public result wrappers.

Rules:

- must be dependency-free;
- must not know about parsing, filesystem, CLI, LSP, Codex, or editors.

### `parser`

Parses one `.sigil` source into a partial `SigilDocument`.

Responsibilities:

- parse top-level imports, components, and expands;
- parse known section boundaries;
- preserve raw section body lines;
- create semantic lines;
- recover from malformed structure where practical;
- emit parser diagnostics.

Rules:

- may depend on `model` and diagnostic code definitions;
- must not read files;
- must not resolve imports;
- must not enforce workspace-level rules.

### `filesystem`

Defines abstract filesystem port types.

Responsibilities:

- describe file read, existence, listing, and path normalization operations;
- enable in-memory tests;
- keep host filesystem details out of parser and resolver logic.

Rules:

- may depend on `model` for path-related result types if needed;
- must not call Deno filesystem APIs in core logic;
- must not know about CLI or editor hosts.

### `workspace`

Discovers and loads Sigil workspaces.

Responsibilities:

- discover the nearest ancestor config whose parent workspaces exclude its subtree unless an explicit configured root is supplied;
- parse config and apply file include and exclude globs;
- reject missing, invalid, unsupported, and unexcluded nested configuration;
- load relevant `.sigil` files through `filesystem`;
- identify the root project and workspace-member roots exclusively from
  `sigil.config`;
- identify valid `RootSigil` locations.

Rules:

- may depend on `model`, `filesystem`, `parser`, and `diagnostics`;
- must not resolve imported component names;
- must not build the final graph.

### `resolver`

Resolves declarations across loaded documents.

Responsibilities:

- resolve `@path` import paths from the workspace root;
- resolve imported names to `component Name` declarations;
- collect matching `expand Name` blocks;
- detect expands without matching components;
- detect duplicate component ambiguity;
- protect against import cycles.

Rules:

- may depend on `model`, `workspace`, and `diagnostics`;
- must preserve collective expand semantics;
- must not introduce override, shadowing, or inheritance behavior.

### `graph`

Builds relationship data from resolved declarations.

Responsibilities:

- create file dependency edges;
- create component dependency edges;
- represent import relationships;
- represent component-to-expansion relationships.

Rules:

- may depend on `model` and `resolver`;
- must not perform file IO;
- must not parse source text.

### `diagnostics`

Owns diagnostic construction and stable diagnostic codes.

Responsibilities:

- define diagnostic severity levels;
- define stable diagnostic code names;
- create diagnostics with source ranges when possible;
- keep diagnostic messages consistent.

Rules:

- may depend on `model`;
- must not depend on parser, workspace, resolver, graph, CLI, LSP, or editor APIs.

### `projections`

Exposes primitive structured views over resolved models.

Responsibilities:

- expose component contract views;
- expose collected expansion views;
- expose graph-oriented summaries;
- provide reusable data shapes for CLI, LSP, renderers, and agent context builders.

Rules:

- may depend on `model`, `resolver`, and `graph`;
- must not implement full agent ranking;
- must not render Markdown;
- must not know about editor UI.

### `testing`

Provides package-local test helpers.

Responsibilities:

- in-memory filesystem implementation;
- fixture loading helpers;
- malformed Sigil examples;
- assertions for diagnostics and semantic lines.

Rules:

- may depend on all core modules;
- must not become a runtime dependency of production modules.

## 4. Dependency Direction

Allowed dependency direction:

```text
model
  <- diagnostics
  <- filesystem
  <- parser
  <- workspace
  <- resolver
  <- graph
  <- projections
```

More explicitly:

- `model` is dependency-free.
- `parser`, `diagnostics`, and `filesystem` may depend on `model`.
- `workspace` may depend on `model`, `filesystem`, `parser`, and `diagnostics`.
- `resolver` may depend on `model`, `workspace`, and `diagnostics`.
- `graph` may depend on `model` and `resolver`.
- `projections` may depend on `model`, `resolver`, and `graph`.
- `testing` may depend on any core module.

Forbidden dependencies:

- no module may depend on `sigil-cli`;
- no module may depend on `sigil-lsp`;
- no module may depend on Codex skill files;
- no module may depend on VS Code APIs;
- no module may depend on MCP or other host transports;
- no production module may depend on `testing`.

## 5. Implementation Guidelines

Use Deno TypeScript.

Prefer plain typed data over class-heavy domain objects.

Prefer functions that accept explicit inputs and return explicit result objects.

Represent diagnostics as data, not thrown exceptions, for Sigil source problems.

Use exceptions only for programmer errors or failed host operations that cannot produce a meaningful partial model.

Keep path handling explicit and cross-platform.

Avoid global mutable state.

Avoid parser-side knowledge of workspace rules.

Avoid resolver-side knowledge of presentation or agent ranking behavior.

## 6. Result Shape Guidelines

Public operations should return result objects that include:

- requested data when available;
- diagnostics;
- workspace root when relevant;
- enough source location data for downstream CLI and LSP users.

Machine-readable consumers must not need to parse human diagnostic messages.

## 7. Testing Guidelines

Core tests should run without touching the real filesystem unless the test explicitly covers a concrete filesystem adapter.

Required test fixtures include:

- valid programming abstraction Sigil;
- valid nested module Sigil;
- unresolved import;
- missing `goal`;
- missing `interface`;
- unknown section;
- malformed brace structure;
- duplicate component name;
- expand without matching component;
- import cycle.

Tests should assert diagnostic codes, not only messages.

Tests should assert semantic line source ranges for representative inputs.
