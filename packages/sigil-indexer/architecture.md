# sigil-indexer Architecture

**Status:** Proposed
**Owner:** _TBD_
**Last updated:** 2026-07-13

## 1. Architecture

`sigil-indexer` uses a deterministic pipeline with source-language adapters:

```text
resolved Sigil + source files
  -> semantic-line locators + TypeScript source index
  -> bounded candidates
  -> externally reviewed proposals
  -> deterministic validation
  -> canonical anchor index
```

## 2. Internal Boundaries

- `model`: dependency-light immutable anchor, proposal, index, source, and diagnostic types.
- `fingerprints`: normalized text, context, signature, and body hashing.
- `semantic-lines`: locator creation and deterministic Sigil-line reconciliation.
- `source-adapter`: interface for language-specific source indexing.
- `typescript-adapter`: TypeScript/TSX AST, symbols, imports, calls, and common test extraction.
- `candidates`: deterministic ordering and bounded candidate bundles.
- `schema`: sidecar and proposal parsing, versioning, and canonical serialization.
- `reconcile`: accepted target resolution and drift states.
- `apply`: all-or-nothing validation and immutable updated-index construction.

## 3. Dependency Rules

`sigil-indexer` may depend on `sigil-core`, Web Crypto hashing, and the pinned
TypeScript compiler API. It must not depend on `sigil-cli`, Codex, LSP, editor
APIs, model SDKs, or network services.

Language adapters implement a shared source-index contract. Generic candidate,
schema, and reconciliation logic must not inspect TypeScript compiler objects.

Filesystem IO stays outside the package. Public operations accept source text
or abstract inputs and return data plus diagnostics. The CLI owns concrete file
discovery and atomic persistence.

## 4. Identity And Reconciliation

An anchor UUID identifies an accepted relationship, not a semantic line or AST
node. Locators are review snapshots.

Sigil resolution order:

1. exact file, owner, section, and text hash;
2. unique owner/section match using context hash;
3. unique last-range and normalized-text recovery;
4. ambiguous or missing.

Source resolution order:

1. exact file, node kind, qualified name, and signature;
2. unique qualified-name and signature relocation;
3. unique body-preserving relocation;
4. changed when a unique target remains but fingerprints differ;
5. ambiguous or missing.

No ambiguous step selects a target.

## 5. Security And Persistence

All persisted paths are normalized workspace-relative paths and must remain
inside the resolved workspace. Concrete hosts must validate both lexical path
containment and canonical real-path containment when a target exists, so a
workspace symlink cannot resolve an accepted target outside the workspace.
JSON parsing uses explicit field validation and rejects unknown schema versions.

Canonical output uses two-space indentation, stable field ordering, stable
anchor ordering by ID, and a trailing newline. Applying proposals constructs a
complete updated value in memory; the CLI writes only after all diagnostics are
known and no error remains.

## 6. Partial TypeScript Models

The adapter creates a compiler program when possible and uses its type checker
for qualified symbols and references. Unresolved external modules do not erase
syntax-level local declarations. Each incomplete relationship produces a
diagnostic while preserving the usable source index.

Generated directories and dependency caches are excluded before parsing:
`.git`, `.deno`, `node_modules`, `build`, and `coverage`.
