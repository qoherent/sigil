# ADR-011: Generated Rationale, Evidence, And Review Records

**Status:** Proposed

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-16

**Supersedes:** ADR-009 and ADR-010

## 1. Decision

Sigil will keep `.sigil` source lightweight and human-authored while its tools
produce attributed, inspectable records describing how each meaningful semantic
line was interpreted and checked.

These generated records are called **Sigil Receipts**.

A receipt answers:

1. What does the source say?
2. How was it interpreted, and by which producer?
3. What material assumptions or inventions were required?
4. Which checks ran and what did they report?
5. Which evidence supports those checks?

The platform will split responsibility as follows:

- `sigil-core` remains deterministic and owns parsing, semantic-line identity,
  workspace resolution, source fidelity, structural diagnostics, and reusable
  receipt facts;
- a proposed `packages/receipts` package owns the receipt schema, fragment
  validation, status derivation, immutable review runs, freshness comparison,
  and projections;
- host integrations may contribute attributed semantic interpretations,
  inventions, researched findings, and review questions without presenting
  model output as deterministic compiler truth;
- `packages/indexer` owns deterministic source indexing and reviewed anchors
  between Sigil semantic lines and implementation evidence;
- accepted anchors may support receipt checks but never prove that an
  implementation satisfies a Sigil line;
- humans alone approve or reject Sigil as an implementation basis, and a tool or
  model cannot infer approval from a successful check or command invocation;
- CLI, LSP, and editor integrations deliver the same receipt data at command,
  workspace, component, and semantic-line scales.

No receipt syntax is added to `.sigil` files. Authors continue to write ordinary
components and expands.

This ADR selects the boundary previously described as Option C in ADR-009:
deterministic shared packages, host-owned model orchestration, and an optional
future standalone agent rather than model access inside `sigil-core`.

This ADR also incorporates the anchor direction proposed by ADR-010. It replaces
those two open decisions with one architecture while preserving their documents
as historical analysis.

## 2. Goals

Receipts exist to:

- make rationale capture a by-product of normal Sigil work rather than a second
  authoring task;
- expose uncertainty and material invention before implementation;
- make structural and semantic checks inspectable instead of reducing them to a
  score or unexplained color;
- connect checks to repository, standards, test, trace, anchor, and human-review
  evidence when available;
- help developers and reviewers understand why a line matters without requiring
  architecture expertise;
- identify which receipts became stale after source, context, policy, checker,
  or evidence changes;
- support review, maintenance, change impact, and cross-host comparison without
  storing hidden reasoning.

## 3. Non-Goals

Receipts do not:

- add `rationale`, `decision`, `assumption`, or receipt forms to Sigil syntax;
- turn free-form section bodies into a formal rationale ontology;
- allow models to approve Sigil, accept anchors, or silently repair stale data;
- claim that a green assessment proves correctness, compliance, or behavioral
  satisfaction;
- store prompts, hidden chain-of-thought, provider secrets, or unbounded source
  excerpts;
- require every editor keystroke to create a durable audit run;
- make `packages/indexer` or source ASTs prerequisites for useful receipts;
- move host-specific elicitation, research, or product judgment into
  `sigil-core`.

## 4. Users And Language

Receipts are for authors, developers, reviewers, maintainers, and users of any
experience level. The product must not assume that the person writing or
reviewing Sigil is a software architect.

Human-facing findings should explain:

1. what the line appears to mean;
2. what is missing, conflicting, or uncertain;
3. why that matters;
4. which question or action could resolve it;
5. whether the answer belongs to a user, repository, external source, or
   low-risk implementation choice.

Technical identifiers may remain precise in machine-readable output, but editor
and CLI summaries should prefer plain language and actionable explanations.

## 5. Three Independent Dimensions

Structural validity, semantic readiness, and human approval remain separate.
Receipts represent them without collapsing their authority.

Receipt presentation also separates assessment, freshness, and approval:

```text
assessment = green | yellow | red | gray
freshness  = current | stale
approval   = unreviewed | approved | rejected | superseded
```

Assessment meanings:

- `green`: every check required by the selected policy passed and no material
  unresolved invention remains;
- `yellow`: the line is interpretable but warnings, uncertainty, or material
  invention remain;
- `red`: a required check failed, a reference is broken, or a contradiction or
  invalid state is present;
- `gray`: the line was parsed but no applicable semantic review policy was run.

Freshness meanings:

- `current`: the receipt still matches the inputs, policies, producers, and
  evidence recorded by its run;
- `stale`: at least one relevant source, context, dependency, checker, policy,
  or evidence fingerprint changed.

A stale receipt retains its previous assessment. A receipt may therefore be
both red and stale. Approval also remains independent: approval cannot turn a
red receipt green, and green cannot imply approval.

The first Receipts experiment will use `unreviewed` only. Durable approval
records remain outside the initial experiment and require a separate reviewed
delivery stage with an identity, scope, invalidation, and repository policy.

## 6. Receipt Model

Every receipt identifies one target and the review run that produced it.

The initial target is a Sigil semantic line and records:

- workspace-relative file path;
- owner kind, owner name, and section name;
- normalized-text SHA-256 hash;
- context hash derived from adjacent semantic lines;
- last-known source range.

The locator definition is shared with the indexer. The platform must not create
separate, incompatible semantic-line identity schemes for receipts and anchors.

A receipt contains:

- the source text or a bounded source snapshot;
- zero or more attributed interpretations;
- zero or more material inventions, ambiguities, or conflicts;
- the checks that ran, did not run, or failed;
- evidence references used by each check;
- assessment, freshness, and approval dimensions;
- producer and tool provenance;
- the applied review policy and relevant input fingerprints.

Each interpretation, invention, check, and evidence claim identifies its
producer. Producer kinds include:

- `core`: deterministic Sigil parsing or resolution;
- `checker`: a deterministic receipt or indexer check;
- `host`: a model-capable or rule-based host integration;
- `research`: an attributed external source finding;
- `human`: an explicit review or approval action.

Receipts store concise conclusions and evidence references rather than hidden
reasoning. A host may explain that a line leaves payment failure behavior
unspecified; it must not persist private reasoning traces used to reach that
conclusion.

## 7. Checks And Evidence

Checks are evaluation records rather than unstructured log messages. Each check
records:

- a stable check kind and producer;
- `pass`, `warning`, `fail`, or `not_checked` status;
- a plain-language summary and optional actionable question;
- whether the check is required by the selected policy;
- zero or more evidence references;
- the checker and policy versions needed for freshness comparison.

Evidence may refer to:

- resolved Sigil components, imports, expands, and diagnostics;
- repository files, symbols, tests, configuration, or documentation;
- accepted anchors from `.sigil/anchors.json`;
- external standards or official guidance with issuer, version, link, and access
  date;
- a bounded human review or approval attestation.

Evidence supports a claim but does not automatically prove it. In particular,
an anchor identifies relevant implementation evidence and does not establish
behavioral compliance.

## 8. Anchors And Source Indexing

Anchors remain a staged future capability outside Sigil syntax.

Reviewed anchors are stored in the committed workspace sidecar:

```text
.sigil/anchors.json
```

`packages/indexer` owns:

- deterministic source-language AST and symbol adapters;
- inspectable candidate generation;
- anchor proposal validation;
- accepted-anchor persistence;
- source and Sigil locator reconciliation;
- `resolved`, `changed`, `ambiguous`, and `missing` anchor states.

Host integrations may use models to propose natural-language mappings after
deterministic candidate generation. Models never accept, persist, or silently
repair anchors. Humans approve every initial anchor and ambiguous remapping.

Receipts consume accepted anchor IDs and reconciliation states as evidence.
They do not duplicate the anchor index or reinterpret source ASTs independently.

## 9. Review Runs And Persistence

Durable receipts are generated only by explicit review operations. Live editor
feedback may create transient in-memory receipts but does not append a durable
run for every change.

The proposed workspace layout is:

```text
.sigil/runs/<run-id>/manifest.json
.sigil/runs/<run-id>/receipts.jsonl
.sigil/latest.json
```

Each completed run is immutable. Its manifest records:

- schema and run identifiers;
- workspace, source, import-graph, and evidence fingerprints;
- Sigil, core, receipt compiler, checker, indexer, host, and policy versions;
- start and completion times;
- whether the run is deterministic, host-assisted, or mixed;
- receipt counts and the manifest digest.

`.sigil/latest.json` is an atomic cache pointer to the latest completed run and
its manifest digest. It is not the audit record itself.

The initial experiment keeps durable runs local. A later decision must define
whether runs are committed by default, explicitly promoted, retained outside
Git, or governed by workspace policy. That decision must address repository
growth, sensitive evidence, redaction, retention, and shared identity.

## 10. Platform Delivery

The proposed initial CLI surface is:

```text
sigil receipts run [path]
sigil receipts show [path] --component <name>
sigil receipts show [path] --file <file> --line <line>
sigil receipts check [path]
sigil receipts diff <old-run> <new-run>
```

The CLI remains non-interactive and does not invoke a model. A host may provide
attributed semantic fragments to the receipt compiler through a versioned
proposal or API boundary.

Editor and LSP delivery should support multiple scales:

- semantic-line hover: meaning, inventions, checks, and evidence;
- gutter state: assessment plus a distinct stale marker;
- component view: receipt rollup and unresolved questions;
- change view: receipts made stale by the current edit;
- workspace view: structural relationships, readiness findings, and evidence
  coverage without presenting a giant receipt dump by default.

## 11. Privacy, Reproducibility, And Trust

Deterministic packages do not call models or external research services.
The host owns permission to expose repository or Sigil content externally.

Every non-deterministic contribution records available host and model
provenance. Reproducing a deterministic run does not require a model. Reusing a
host interpretation does not convert it into a deterministic result.

Receipt persistence must minimize copied source and external material. Secrets,
credentials, hidden reasoning, prompts, and unnecessary personal information
must not be stored.

Tools derive statuses from validated fragments and selected policy. A model does
not directly assign the authoritative receipt rollup.

## 12. Consequences

Benefits:

- rationale capture remains part of ordinary Sigil authoring;
- readiness findings become inspectable and comparable across hosts;
- users can see what a tool inferred beyond the source;
- anchors, tests, repository facts, and research can support one evidence model;
- stale rationale becomes visible during maintenance and change review;
- core remains deterministic, offline-capable, and reusable;
- editor and CLI surfaces can explain findings at an appropriate scale.

Costs:

- the platform gains a new package, schema, persistence model, and lifecycle;
- free-form language interpretation remains partly nondeterministic;
- status and policy vocabularies require careful versioning;
- durable runs may contain sensitive evidence and create repository growth;
- approval identity and invalidation remain a separate design problem;
- source-language adapters are still required for implementation anchors.

## 13. Alternatives Rejected

### Put Model Access In `sigil-core`

Rejected because it would make core responsible for credentials, networking,
privacy consent, cost, provider lifecycle, and nondeterministic behavior.

### Leave Semantic Findings Entirely Host-Specific

Rejected because hosts would produce incompatible readiness results with no
shared status, provenance, evidence, or freshness model.

### Store Rationale In New Sigil Syntax

Rejected because it creates another authoring burden and pushes Sigil toward a
heavy manual rationale system.

### Make Anchors The Receipt Store

Rejected because receipts are useful before implementation evidence exists and
because anchors own trace relationships rather than semantic review history.

### Persist Every Editor Evaluation

Rejected because keystroke-level audit runs would create noise, storage growth,
and misleading intermediate history.

## 14. Delivery Stages

1. Review and approve this ADR and the colocated Receipt component contracts.
2. Define a temporary versioned receipt schema and policy vocabulary.
3. Generate deterministic gray receipts for the Promise and Slotted examples.
4. Add attributed host interpretations, inventions, and semantic checks.
5. Compare two host runs over the same examples and record material agreement
   and disagreement.
6. Implement immutable local runs, freshness comparison, and receipt diffs.
7. Review and approve the indexer contracts, then implement deterministic anchor
   candidates and persistence.
8. Consume accepted anchors as receipt evidence.
9. Add LSP queries and editor line, component, and change views.
10. Design durable approval attestations and shared run-retention policy as a
    separate reviewed stage.

No stage authorizes implementation until its Sigil coverage is reviewed and
approved.

## 15. Open Questions

- Which deterministic semantic checks are stable enough to become shared
  receipt check kinds?
- How should hosts exchange attributed receipt fragments without sharing one
  model or prompt?
- Which policy selects required checks for low, standard, and high-risk work?
- Which dependency changes make a line receipt stale beyond direct source and
  adjacent-context changes?
- How should contradictory user, repository, research, and host findings be
  displayed and resolved?
- How should runs be promoted, shared, retained, redacted, and garbage-collected?
- How should a human identity be established for durable approval?
- What exact source and context changes invalidate component or workspace-level
  approval?
- Which source-language adapter should follow TypeScript?
- How should non-AST evidence such as migrations, traces, and generated artifacts
  be indexed?
- How should obsolete evidence and superseded receipts remain available without
  obscuring the current view?

## 16. Approval Criteria

This ADR can advance to **Accepted** after reviewers have:

- agreed that core remains deterministic and model orchestration stays in hosts;
- approved the separation of assessment, freshness, and approval;
- approved the Receipt, anchor, and evidence ownership boundaries;
- reviewed the temporary receipt schema on one programming abstraction and one
  product module;
- agreed on privacy and provenance rules for host contributions;
- confirmed that the first experiment excludes durable approval records;
- approved the package boundaries and public contracts needed for the first
  delivery stage.

Until then, this ADR does not authorize runtime, CLI, language, persistence, or
workflow implementation changes.

## 17. Influences

The design follows the rationale-management principle that capture and delivery
must be integrated into ordinary software work rather than maintained as a
separate manual system. It also uses multi-scale presentation, change impact,
maintenance, evaluation, and reuse as design pressures.

Relevant background:

- Janet E. Burge, John M. Carroll, Raymond McCall, and Ivan Mistrík,
  *Rationale-Based Software Engineering*, Springer, 2008,
  <https://doi.org/10.1007/978-3-540-77583-6>;
- Allen H. Dutoit, Raymond McCall, Ivan Mistrík, and Barbara Paech, editors,
  *Rationale Management in Software Engineering*, Springer, 2006,
  <https://doi.org/10.1007/978-3-540-30998-7>.

These sources inform the design but do not define Sigil's public contracts.
