# sigil-indexer Requirements

**Status:** Proposed
**Owner:** _TBD_
**Last updated:** 2026-07-13

## 1. Purpose

`sigil-indexer` provides deterministic source indexing and durable reviewed
anchors between Sigil semantic lines and implementation evidence.

## 2. Initial Scope

The first implementation must:

- depend on `sigil-core` for resolved Sigil workspaces and semantic lines;
- index TypeScript and TSX with pinned `npm:typescript@5.9.3`;
- return partial source indexes plus diagnostics when external modules do not resolve;
- derive Sigil line locators from owner, section, normalized text, neighbor context, and source range;
- derive source locators from AST kind, qualified name, signature, optional body, file, and source range;
- produce no more than twenty deterministic candidates per semantic line;
- validate and load schema-version-1 `.sigil/anchors.json` files;
- reconcile accepted anchors as resolved, changed, ambiguous, or missing;
- validate approved proposal bundles before producing an updated anchor index;
- expose pure serialization output so the CLI can perform an atomic write.

## 3. Out Of Scope

The first implementation must not:

- invoke models or contain prompts;
- accept anchors without a validated approved proposal;
- modify `.sigil` or implementation source;
- silently choose between ambiguous targets;
- use embeddings or an external vector database;
- run a background index service;
- index languages other than TypeScript and TSX;
- claim that an anchor proves behavioral compliance.

## 4. Public Contracts

The initial public data model is:

```ts
type AnchorRelationship = "implements" | "verifies" | "supports"
type AnchorResolution = "resolved" | "changed" | "ambiguous" | "missing"
type AnchorProposalOutcome = "proposed" | "ambiguous" | "no-match"

interface SemanticLineLocator {
  filePath: string
  ownerKind: "component" | "expand"
  ownerName: string
  sectionName: string
  textHash: string
  contextHash: string
  lastKnownRange: SourceRange
}

interface SourceTargetLocator {
  language: "typescript"
  filePath: string
  targetKind: "symbol" | "test"
  nodeKind: string
  qualifiedName: string
  signatureHash: string
  bodyHash?: string
  lastKnownRange: SourceRange
}

interface AnchorProvenance {
  host: string
  model?: string
  proposedAt: string
}

interface AnchorRecord {
  id: string
  sigil: SemanticLineLocator
  target: SourceTargetLocator
  relationship: AnchorRelationship
  evidence: string[]
  provenance: AnchorProvenance
  acceptedAt: string
}

interface AnchorAlternative {
  target: SourceTargetLocator
  evidence: string[]
}

interface AnchorProposal {
  proposalId: string
  anchorId?: string
  sigil: SemanticLineLocator
  target?: SourceTargetLocator
  relationship?: AnchorRelationship
  evidence: string[]
  alternatives: AnchorAlternative[]
  outcome: AnchorProposalOutcome
  provenance: AnchorProvenance
}

interface AnchorProposalBundle {
  schemaVersion: 1
  workspaceRoot: string
  proposals: AnchorProposal[]
}

interface AnchorIndex {
  schemaVersion: 1
  anchors: AnchorRecord[]
}
```

All timestamps are UTC RFC 3339 strings. IDs are lowercase UUIDs produced by
`crypto.randomUUID()`. `anchorId` is present only when a proposal replaces the
locator snapshot of an existing accepted relationship.

A `proposed` outcome requires one target, one relationship, and non-empty
evidence. `ambiguous` requires at least two alternatives and does not accept a
target. `no-match` accepts neither a target nor alternatives. Only `proposed`
items may be applied.

Applying a new proposal generates a new anchor UUID and sets `acceptedAt` to
the apply operation's current UTC time. Applying an approved remapping requires
`anchorId`, preserves that relationship UUID, replaces its locator snapshots,
relationship, evidence, and provenance, and resets `acceptedAt` to the current
approval time.

The parser rejects unknown fields. A duplicate relationship is one with the
same resolved Sigil line, resolved source target, and relationship value,
regardless of proposal or anchor UUID. Duplicate relationships are rejected
rather than merged implicitly.

Public operations provide capabilities equivalent to:

```text
buildTypeScriptSourceIndex(files) returns SourceIndexResult
buildAnchorCandidates(workspace, sourceIndex, componentName) returns CandidateBundle
checkAnchorIndex(workspace, sourceIndex, anchorIndex) returns AnchorCheckResult
applyApprovedProposals(workspace, sourceIndex, anchorIndex, proposalBundle) returns AnchorApplyResult
parseAnchorIndex(source) returns AnchorIndexParseResult
serializeAnchorIndex(index) returns canonical JSON
```

## 5. Fingerprints And Names

Sigil text normalization applies Unicode NFC, trims leading and trailing
whitespace, and replaces each internal whitespace run with one ASCII space. It
preserves case and punctuation. `textHash` is the lowercase hexadecimal SHA-256
of the normalized UTF-8 text.

`contextHash` is the SHA-256 of canonical JSON containing the previous and next
semantic-line text hashes within the same owner and section. A missing neighbor
uses an empty string.

A TypeScript qualified name starts with the workspace-relative file path,
followed by `::`, followed by named namespaces, classes, and declarations joined
with `.`. Function-valued variables use the variable name. Tests use `test`
plus the literal test-name chain, including enclosing literal `describe` names
when present. Duplicate names remain separate source targets and require ranges
or fingerprints to disambiguate.

`signatureHash` is the SHA-256 of a canonical structural signature containing
AST node kind, modifiers, type parameters, parameters, and declared return or
value type. It excludes file path, source range, comments, formatting, function
body, and the declaration's own name so a pure rename can be reconciled.

`bodyHash`, when available, is the SHA-256 of the AST body token sequence after
removing trivia and source positions. It preserves identifiers and literals so
a body edit produces a changed fingerprint while a file move does not.

## 6. Deterministic Ordering

Candidate ordering uses normalized token overlap, component/file proximity,
source imports, call relationships when available, target kind, and nearby test
references. Results include the signals that affected ordering and use stable
tie-breaking by workspace-relative path, range, node kind, and qualified name.

Candidates sort lexicographically by this tuple:

1. exact component-name token in the qualified name, descending;
2. same directory or descendant directory as the Sigil component, descending;
3. count of normalized semantic-line tokens present in the qualified name and signature, descending;
4. count of indexed import or call edges to other candidates with nonzero token overlap, descending;
5. test target first for `cases`, otherwise source symbol first;
6. workspace-relative file path, start line, start column, node kind, and qualified name, ascending.

Tokenization splits Unicode letter and number runs plus camelCase and snake_case
boundaries, lowercases tokens, and discards one-character tokens. Candidate
signals report the values used by this tuple.

## 7. Diagnostics

Stable diagnostic families cover:

- invalid anchor and proposal schema;
- unsupported schema version;
- paths outside the workspace;
- missing or ambiguous Sigil lines;
- missing or ambiguous source targets;
- stale Sigil or source fingerprints;
- duplicate anchor IDs or duplicate accepted relationships;
- partial TypeScript module resolution;
- invalid proposal outcomes and relationships.

Source-index incompleteness should return partial data plus warnings when local
targets remain usable. Invalid persistence input and unresolved accepted anchors
are errors.

## 8. Acceptance Scenarios

The package is acceptable when tests demonstrate:

- representative TypeScript declarations and common tests are indexed;
- candidate ordering is deterministic and capped at twenty;
- one semantic line can map to implementation and test targets;
- one target can support multiple semantic lines;
- formatting preserves resolution;
- a unique relocation can be recovered;
- structural change is reported as changed;
- deletion is missing and duplicate recovery is ambiguous;
- stale or invalid proposals never produce an updated index;
- path containment and schema validation reject unsafe input;
- canonical serialization is stable.
