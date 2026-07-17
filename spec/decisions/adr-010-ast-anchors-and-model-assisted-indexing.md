# ADR-010: AST Anchors And Model-Assisted Indexing

**Status:** Superseded by ADR-011

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-13

> This proposal is preserved for history. Its anchor, evidence, provenance, and
> reconciliation decisions are consolidated into
> [ADR-011: Generated Rationale, Evidence, And Review Records](adr-011-generated-rationale-evidence-and-review-records.md).

## 1. Decision

Sigil may introduce anchors as a staged future platform capability.

An anchor is a reviewed, durable relationship between one Sigil semantic line
and one implementation-evidence target. Targets may eventually include source
symbols, tests, configuration, migrations, generated code, and other indexed
artifacts.

Anchors will not add syntax to `.sigil` files and will not change the meaning of
a semantic line. Reviewed anchors will be stored in the committed workspace
sidecar `.sigil/anchors.json`. Generated AST and candidate indexes remain
disposable.

The platform will split responsibilities as follows:

- `sigil-core` continues to own Sigil parsing, semantic lines, workspace
  resolution, and source fidelity without source-language or model dependencies;
- `packages/indexer` owns deterministic source indexing, candidate
  generation, anchor validation, persistence, and reconciliation;
- source-language adapters own AST and symbol extraction, beginning with a
  TypeScript adapter pinned to `npm:typescript@5.9.3`;
- `sigil-cli` exposes deterministic `sigil anchors` automation commands in its
  future surface;
- host integrations may use models to interpret natural-language Sigil and
  propose anchors, but models do not accept, persist, or silently repair them;
- humans approve every initial anchor and every ambiguous remapping.

## 2. Context

Every non-empty Sigil section line is already represented as a semantic line
with file, owner, section, text, and source range. Source ranges identify where
a line exists in one revision, but they do not preserve identity after wording,
surrounding lines, or files change.

Source ASTs provide better implementation locations than raw line numbers. A
function, method, class, or test can often be recovered after formatting or
movement. AST nodes are still parse-revision objects rather than durable
identities. A rename, extraction, merge, or behavioral rewrite may replace the
node while preserving, splitting, or changing responsibility.

Natural-language Sigil also cannot be mapped reliably through names alone. A
line about retaining canceled bookings may correspond to a state transition,
repository update, and regression test whose symbols use different words.
Models can interpret that relationship, but nondeterministic interpretation is
not a safe persistence or validation mechanism.

## 3. Anchor Model

The committed file uses a versioned top-level shape:

```json
{
  "schemaVersion": 1,
  "anchors": []
}
```

Each accepted anchor has:

- a stable UUID for the relationship itself;
- a Sigil semantic-line locator and review snapshot;
- a source-target locator and AST snapshot;
- one relationship: `implements`, `verifies`, or `supports`;
- concise evidence explaining why the target corresponds to the line;
- proposal provenance and an acceptance timestamp.

Proposal provenance contains a host identifier, an optional model identifier,
and a proposal timestamp. It intentionally omits prompts and hidden reasoning.
Accepted relationship and proposal IDs use UUIDs. Hashes use SHA-256 over
canonical normalized values; exact normalization is specified by
`packages/indexer/spec.md`.

The index is many-to-many. One Sigil line may have implementation and test
anchors, and one source target may support more than one semantic line.

The persisted schema is host-neutral. It does not contain Codex thread IDs,
subagent IDs, prompts, hidden reasoning, or provider-specific state.

## 4. Sigil Semantic-Line Location

The Sigil locator stores:

- workspace-relative file path;
- owner kind, owner name, and section name;
- normalized-text SHA-256 hash;
- context hash derived from adjacent semantic lines;
- last-known source range.

The anchor UUID remains stable even though a locator snapshot can become stale.
The indexer first resolves an exact owner, section, and text hash. It may use
neighbor context and the last-known range to find a unique relocation.

A materially changed line is not silently treated as the same intent. It
requires model-assisted or human review and a newly accepted locator snapshot.
Sigil source is not given inline anchor IDs in this version.

## 5. Source Target Location

The first adapter indexes TypeScript and TSX targets.

The source locator stores:

- language and workspace-relative file path;
- target kind: source symbol or test;
- AST node kind;
- qualified symbol or test name;
- signature hash;
- optional body hash;
- last-known source range.

The TypeScript adapter indexes functions, methods, classes, interfaces, type
aliases, function-valued variables, exports, and common test declarations such
as `Deno.test`, `test`, and `it`.

The adapter uses the compiler AST and type checker when resolution is available.
Unresolved Deno, npm, or external imports produce partial index results plus
diagnostics rather than discarding usable local symbols.

## 6. Deterministic Candidate Generation

Before a model sees repository context, the indexer produces at most twenty
ordered candidates per semantic line.

Ordering uses inspectable signals:

- component and file colocation;
- qualified-name and semantic-line token overlap;
- Sigil and source import relationships;
- source call relationships when available;
- implementation versus test classification;
- exact references from nearby tests.

The result reports the signals that affected ordering. It does not expose an
opaque model confidence score and does not use embeddings in the first version.

## 7. Model-Assisted Proposal Workflow

Models operate only after deterministic candidate generation.

The first host is a Codex skill that may delegate bounded batches to subagents.
Each batch contains one component, its collected expansions, no more than ten
semantic lines, and the deterministic candidate bundle.

Subagents return structured outcomes:

- `proposed`: one candidate is supported by concrete evidence;
- `ambiguous`: multiple candidates remain plausible;
- `no-match`: the provided candidates do not implement or verify the line.

Subagents must not edit Sigil, source code, proposal files, or the accepted
anchor index. The primary host reconciles overlapping proposals, validates
targets deterministically, and presents the result for human approval.

The proposal schema is reusable by other hosts. No platform package calls a
model or imports Codex behavior.

## 8. Reconciliation And Drift

Anchor checks return one resolution state:

- `resolved`: the accepted locator still identifies the same target;
- `changed`: a unique target remains identifiable but its structure changed;
- `ambiguous`: more than one target could inherit the accepted relationship;
- `missing`: no current target can be resolved.

Formatting-only changes and exact source relocation remain deterministic.
Unique body-preserving moves may be recovered with a warning. A changed result
is a review signal rather than proof of a specification violation.

Ambiguous and missing accepted anchors are errors. They are never automatically
reattached. Target splits, merges, deletions, material source changes, and
material Sigil changes return to model-assisted and human review.

## 9. CLI Surface

The staged future CLI adds:

```text
sigil anchors candidates [path] --component <name> --format json
sigil anchors check [path] --format json
sigil anchors apply <proposal-file> --format json
```

`candidates` and `check` are read-only. `apply` is the only anchor mutation in
this surface. It validates the proposal schema, workspace containment, current
Sigil and source hashes, duplicates, and target resolution before atomically
updating `.sigil/anchors.json`.

Calling `apply` is not proof of human approval. Host workflows must obtain
approval before invoking it. The CLI rejects `ambiguous`, `no-match`, stale, or
invalid proposals and performs no partial write.

## 10. Privacy And Reproducibility

Deterministic tools must minimize the candidate context handed to a host model.
The host owns permission to expose repository content to its model.

Accepted anchors are reproducible from committed locators, fingerprints,
evidence, and provenance. Re-running a model is not required to recover an
accepted relationship.

Proposal provenance may record a host and model identifier when available, but
the schema does not require provider-specific identifiers. Hidden reasoning and
full prompts are not persisted.

## 11. Consequences

Benefits:

- anchors survive more refactors than raw line-number links;
- natural-language matching is available without making core nondeterministic;
- humans retain control over durable relationships;
- accepted mappings can be queried by agents, CI, editors, and future hosts;
- ambiguous drift is surfaced rather than silently repaired.

Costs:

- the repository gains a committed generated-by-workflow sidecar;
- TypeScript compiler upgrades require deliberate adapter validation;
- acceptance and reconciliation add review work;
- source adapters must be implemented separately for each language ecosystem;
- AST and lexical evidence cannot prove behavioral compliance.

## 12. Delivery Stages

1. Approve this ADR and the colocated Sigil contracts.
2. Implement the deterministic `sigil-indexer` package and TypeScript adapter.
3. Add the three CLI commands and committed anchor schema.
4. Add and validate the Codex proposal skill.
5. Forward-test clear, ambiguous, and missing mappings.
6. Evaluate another source-language adapter only after the TypeScript workflow
   demonstrates useful reviewed anchors.

## 13. Deferred Questions

- Which language adapter should follow TypeScript?
- Should accepted anchor evidence be editable independently from the locator?
- How should editor integrations display one-to-many and many-to-one anchors?
- Should CI offer a strict mode that fails on `changed` as well as errors?
- How should anchors to non-AST artifacts such as SQL migrations be indexed?
- When should obsolete accepted anchors be removed rather than retained as
  historical evidence?
