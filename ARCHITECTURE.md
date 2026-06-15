# Qode Architecture

This document describes the durable technical architecture for Qode. The current implementation plan is in [PRD.md](./PRD.md). The product scope and language intent are in [README.md](./README.md).

The architecture is designed around one rule: the Qode AST is the source of truth. TypeScript projections, LSP responses, diagnostics, documentation, and future runtime behavior are derived from that AST.

## System Overview

```text
.qode source
  |
Lexer and parser
  |
Qode AST with source ranges
  |
Validation and indexing
  |
Concept surface model
  |
Virtual TypeScript declarations
  |
TypeScript language service
  |
CLI and LSP features
```

## Core Concepts

### Qode AST

The Qode AST represents the language directly:

- concepts
- type parameters
- sections
- prose blocks
- definition declarations
- interface declarations
- state variants
- behavior paragraphs
- source ranges
- diagnostics

The AST must not encode implementation assumptions such as "this concept is a class".

### Concept Surface

`ConceptSurface` is an implementation-agnostic model of what a concept exposes.

It can represent:

- constructable values
- callable values
- methods
- fields
- static-like value members
- modules
- records
- ports
- messages
- state variants

The surface describes architectural capabilities. It does not decide how the implementation is written.

### TypeScript Projection

TypeScript-compatible parts of Qode are projected into virtual `.d.ts` files. These files exist so TypeScript tooling can provide ASTs, diagnostics, hover text, definitions, and references.

The projection layer must preserve a source map from virtual TypeScript positions back to original `.qode` positions.

Projection is not code generation. It is a tooling facade.

### Implementation Mapping

Cross-navigation between concept files and TypeScript implementation files should start with explicit configuration.

Example shape:

```json
{
  "implementations": {
    "Promise": {
      "file": "src/promise.ts",
      "symbol": "Promise"
    }
  }
}
```

Later versions may infer mappings from conventions or annotations, but explicit mappings are the safest first step.

## Proposed Source Layout

```text
src/
  main.ts
  cli/
    mod.ts
    commands.ts
    check.ts
    lsp.ts
  parser/
    ast.ts
    lexer.ts
    parser.ts
    spans.ts
    diagnostics.ts
  ts/
    fragment_parser.ts
    projection.ts
    source_map.ts
    virtual_file.ts
    language_service.ts
  index/
    concept_index.ts
    symbol_index.ts
    implementation_index.ts
  lsp/
    server.ts
    documents.ts
    capabilities.ts
    diagnostics.ts
    document_symbols.ts
    definition.ts
    implementation.ts
    references.ts
    hover.ts
    completion.ts
    semantic_tokens.ts
  config/
    qode_config.ts
```

## Module Responsibilities

### `src/main.ts`

Binary entrypoint. It should delegate immediately to the CLI module and stay small.

### `src/cli`

Owns command parsing and process-facing behavior.

Expected commands:

- `qode check`
- `qode lsp`
- `qode --help`

The command handler should be testable in-process without requiring subprocess tests for every case.

### `src/parser`

Owns Qode syntax.

The parser should:

- parse the outer concept structure
- preserve prose blocks
- parse state variants
- capture TypeScript-compatible fragments as source-ranged text
- recover from errors where practical
- produce stable diagnostic codes

It should not invoke LSP code or TypeScript language service code directly.

### `src/ts`

Owns all TypeScript integration.

Responsibilities:

- parse TypeScript fragments with `npm:typescript`
- project `ConceptSurface` values to virtual declarations
- maintain virtual file source maps
- create and update a TypeScript language service host
- translate TypeScript diagnostics back to Qode diagnostics

This module is the only layer that should depend directly on TypeScript compiler APIs.

### `src/index`

Owns workspace-level symbol knowledge.

Responsibilities:

- index concept declarations
- index concept members and state variants
- index implementation mappings
- answer symbol lookup queries for LSP features

### `src/lsp`

Owns Language Server Protocol behavior.

Responsibilities:

- document lifecycle
- diagnostics publication
- document symbols
- definition
- type definition
- implementation
- references
- hover
- completion
- semantic tokens

The LSP layer should compose parser, index, and TypeScript service APIs. It should not parse TypeScript fragments itself.

### `src/config`

Owns workspace configuration.

Responsibilities:

- locate config files
- parse implementation mappings
- expose settings to CLI and LSP

## Data Flow

### CLI Check

```text
qode check path
  |
read files
  |
parse Qode AST
  |
validate sections and state declarations
  |
parse TypeScript fragments
  |
build concept surfaces
  |
report diagnostics
```

### LSP Diagnostics

```text
textDocument/didOpen or didChange
  |
update document store
  |
parse Qode AST
  |
validate Qode syntax
  |
validate TypeScript fragments
  |
publish diagnostics
```

### LSP Definition

```text
position in .qode or .ts
  |
identify token and region
  |
if Qode-native symbol: use ConceptIndex
  |
if TypeScript-compatible region: use TypeScript language service
  |
map virtual TS result through SourceMap when needed
  |
return LSP Location or LocationLink
```

### LSP Implementation

```text
concept symbol
  |
ConceptIndex lookup
  |
ImplementationIndex lookup
  |
resolve configured TypeScript symbol
  |
return implementation location
```

## Diagnostics

Diagnostics should have stable codes.

Suggested prefixes:

- `QODE_PARSE_*`
- `QODE_SECTION_*`
- `QODE_STATE_*`
- `QODE_TS_*`
- `QODE_CONFIG_*`

Every diagnostic should include:

- file URI or path
- range
- severity
- code
- message

CLI diagnostics should print file, line, column, code, and message.

LSP diagnostics should use native LSP ranges.

## Source Maps

Source maps are required because TypeScript diagnostics and language service results may point into virtual `.d.ts` files.

The mapping must support:

- original URI
- original range
- virtual URI
- virtual range
- symbol identity when available

Source maps should be created during projection and reused by diagnostics, hover, definition, type definition, implementation, and references.

## Testing Strategy

Tests should be grouped by layer:

- parser fixture tests
- state parser tests
- TypeScript fragment tests
- projection tests
- source map tests
- TypeScript language service tests
- LSP protocol tests
- CLI command tests

Prefer in-process tests for command handlers and LSP request handlers. Add subprocess tests only for binary-level behavior.

Every feature should have a positive fixture and at least one malformed fixture.

## Runtime Dependencies

Expected dependencies:

```json
{
  "typescript": "npm:typescript@^5",
  "vscode-languageserver": "npm:vscode-languageserver@^9",
  "vscode-languageserver-textdocument": "npm:vscode-languageserver-textdocument@^1"
}
```

`npm:typescript` is used for TypeScript AST and language service integration. Qode still owns its parser because the full `.qode` syntax is not TypeScript.

## Binary Model

The main app is a self-contained Deno-compiled binary.

Expected build command:

```sh
deno task build
```

Expected output:

```text
build/qode
```

The binary should include the CLI and LSP server.
