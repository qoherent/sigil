# Eqval audit and migration map

Date: 2026-09-09.

## Status and scope

The [README](README.md), [architecture](ARCHITECTURE.md),
[behavior algebra](behavior_algebra.md), and [example](example.md) describe one
current refactor target. The earlier proposal issues have been incorporated
into that design. They are not outstanding requests to repair this folder's
README, nor an alternate design retained here for implementation to choose from.

The remaining gap is between that target and the existing implementation:
`packages/sigilc/`, the structural frontend in `packages/core/`, their governing
contracts, and the semantic calculation boundary. The compiler protocol cleanup
is complete; no eqval Rust library is implemented in this folder yet.

This audit is based on the source inspection that motivated the refactor,
including executable code in `repos/egglog/`, `repos/snapdir/`, and Sigil's
Snapdir integration. It is a static assessment, not a compiler run,
benchmark, proof execution, or independent semantic reconstruction. Acceptance
criteria below are future implementation checks, not reported passing tests.

[language.md](../../language.md) is canonical. Older language specifications and
current parser/catalog limitations do not overrule the author's language
clarifications. Future implementation changes must update the corresponding
findings rather than treating this baseline as permanent truth.

## The adopted design

The core container is Component; contracts contain Facets. Concepts are
encouraged to group and connect the several concerns commonly present in real
components. Smaller components may not need them. Ungrouped and grouped Facets
may freely mix, and no synthetic wrapper is required for comparison. Ordinary Facets end at an
empty line; Embedded Facets retain their introducing prose and fenced content.
Identifiers defined in `interface` are public vocabulary even without Concept grouping.
Imports and module assembly preserve ownership and do not imply runtime calls.

The algebra gives that language a shared calculation surface: values,
expressions, conditions, state descriptions, observable actions, outcomes,
steps, and relationships. Several units may describe one Facet; several Facets
or Concepts may jointly describe one operation. Equality is calculated over a
fixed boundary and complete joint observations, not inferred from name matches
or a model's coarse capability assertion.

The audit's recommendation is therefore implementation of the current documents,
not another round of ontology invention:

| Decision now settled | Controlling definition |
| --- | --- |
| Preserve Component ownership, native Facets, and optional Concept grouping | [Language foundations](behavior_algebra.md#start-with-the-language-we-have) |
| Interpret seven contract roles through the same smaller units | [Contract contributions](behavior_algebra.md#how-each-contract-contributes-to-the-calculation) |
| Declare the domain and observable boundary before comparing | [Equality](behavior_algebra.md#what-equality-means-here) |
| Preserve correlated actions, outcomes, values, and next state | [Joint observations](behavior_algebra.md#compare-related-observations-together) |
| Keep identity/provenance separate from term equality | [Egglog calculation](behavior_algebra.md#how-egglog-should-carry-the-calculation) |
| Keep source reconstructions and target meanings independent | [Independent reconstruction](behavior_algebra.md#keep-the-two-reconstructions-independent) |
| Distinguish Equal, Different, and Unresolved with full support | [Results](behavior_algebra.md#complete-calculations-honest-results) |
| Deliver finite decisions, then finite guarded operations | [First implementation](behavior_algebra.md#the-first-useful-implementation) |

The old capability-tuple composition is not a behavioral compatibility path.
There is no requirement to preserve it as a fallback when a real comparison
fails or remains unresolved.

## Remaining implementation gaps

### P1. Existing facts do not represent enough behavior to calculate equality

Current sources: [kernel.egg](../sigilc/src/kernel.egg),
[design.egg](../sigilc/src/design.egg), [turtle.rs](../sigilc/src/turtle.rs), and
[comparison.egg](../sigilc/src/comparison.egg).

The current seed largely computes relational closure over string identities,
structured propositions, dependencies, ownership, and numerical summaries.
Those are useful foundations, but they do not reconstruct typed guarded
operations with ordered actions, payloads, outcomes, and next state. A semantic
claim that code provides a capability already delegates the relevant behavioral
judgment to interpretation.

**Required change:** accept local typed observations, validate their graph,
and lower the supported units into independent behavior descriptions. Fixed
laws must derive the higher-level behavior. Start with pure finite decisions
and acyclic guarded operations, not unrestricted protocols. Use relational
rules where the claim is relational and term equality where substitutable
meaning is actually established.

This is the main capability change, not the library extraction or replacement
of Turtle. See [small units](behavior_algebra.md#the-small-units-underneath-the-contracts)
and [composition laws](behavior_algebra.md#composition-laws).

### P1. Current coverage is not the target equality calculation

Current sources: [comparison.rs](../sigilc/src/comparison.rs),
[comparison.egg](../sigilc/src/comparison.egg), and
[comparison tests](../sigilc/tests/comparison.rs).

The current comparator matches required facts and applies fixed contradiction
rules. Extra positive behavior is generally ignored unless a contradiction law
covers it. That cannot establish equal possible observations at an arbitrary
public operation boundary.

There is also no current rule that proves a negative prohibition satisfied.
Refusing to infer safety from absent facts is correct; leaving every prohibition
unresolved is not the desired endpoint. Loss of a positive fact likewise does
not by itself prove that the corresponding behavior was removed.

**Required change:** compare complete finite behavior tables or prove supported
symbolic equality under the same stated assumptions. Compare joint results,
not independent margins: `(Ready, value)/(Failed, error)` differs from
`(Ready, error)/(Failed, value)` even when the field-value sets match.

Use exhaustive supported behavior or a checked invariant over a closed model
for negative properties. Missing meaning and unsuccessful equality search stay
Unresolved. Different requires a valid witness or another supported refutation.
An explicit local violation may be reported despite unrelated unresolved gaps.
Expose vacuity, resource limits, and calculation completeness separately from
faithfulness of source reconstruction.

The result names whether it proves a property, capability, refinement, or
behavior equality. Aggregate `Closed` cannot upgrade a weaker mode. See
[partial requirements](behavior_algebra.md#do-not-ask-a-partial-statement-to-specify-a-whole-program)
and [honest results](behavior_algebra.md#complete-calculations-honest-results).

### P1. Exact localization needs occurrences and complete support

Current sources: [turtle.rs, `Assertion::id`](../sigilc/src/turtle.rs),
[kernel.egg, `because`](../sigilc/src/kernel.egg), and
[report.rs](../sigilc/src/report.rs).

Fact IDs hash normalized triples. Assembly associates those IDs with source
files. Implementation reporting currently has file-only locations. `because`
retains an asserted fact or intermediary, not a complete premise set for every
derivation; reports select bounded immediate rows rather than reconstructing
full proof support. Some contradiction rules retain only one contributing ID.

**Required change:** separate normalized fact identity, binding-qualified source
occurrences, and derivations with all premises. Check byte ranges and excerpt
digests against captured source. Retain native Facet and Embedded Facet ranges,
with supported finer locations where available. Several occurrences may support
one fact; several proofs may support one equality.

A failed report needs the Design contribution, current differing code behavior,
and distinguishing input/state/trace. It must not mark every Facet under the
same Concept as wrong. Deleted code has historical locations only. Unknown
meaning is an explicit diagnostic, not a fabricated current line or witness.
Bound display independently of proof computation.

Full file cache bindings can remain initially. Native Facet precision comes
from attribution, not Facet-sized cache keys. See
[required support](behavior_algebra.md#what-the-result-must-retain).

### P1. Independent targets and source roles must survive assembly

Current sources: [implementation.rs](../sigilc/src/implementation.rs),
[scope.rs](../sigilc/src/scope.rs), and
[comparison.rs](../sigilc/src/comparison.rs).

A shared Concept or obligation key does not identify which backend must satisfy
it. Broad assembly must not let Rust supply missing Deno behavior or pool
fragments from alternative implementations into one fictional target. Likewise,
production behavior, test expectations, mocks, and Design examples cannot be
interchangeable facts merely because all selected files mention the same name.

**Required change:** carry explicit target membership and source role through
observations, closure, and results. A target can contain cooperating files;
separate required backends each receive a result. Keep any aggregate `each` or
`any` selection policy explicit. Compare Case/test expectations separately from
production behavior and test execution.

Cross-file calls need current callee observations, explicit links, argument and
state mappings, compatible assumptions, and target membership. An unknown
helper remains unresolved. Stable typed descriptors permit reusable caller
reconstructions while current callee meaning is composed later; a consumed
behavior summary would instead be a binding dependency.

See [component composition](behavior_algebra.md#component-and-module-composition),
[sequential behavior](behavior_algebra.md#sequential-behavior), and
[Cases and tests](behavior_algebra.md#cases-and-tests-use-the-same-smaller-units).

### P1. Content identity, captured input, and currentness are different guarantees

Actual primitive: [hash_file.rs](../../repos/snapdir/crates/snapdir-core/src/hash_file.rs),
[walk.rs](../../repos/snapdir/crates/snapdir-core/src/walk.rs), and
[merkle.rs](../../repos/snapdir/crates/snapdir-core/src/merkle.rs).
Integration: [sources.rs](../sigilc/src/sources.rs),
[inputs.rs](../sigilc/src/inputs.rs), and [store.rs](../sigilc/src/store.rs).

Keep Snapdir, with the boundaries its implementation actually provides:

- `directory_checksum` hashes sorted, deduplicated child checksums. It does not
  bind names or multiplicity; rename or duplicate-file removal can leave it
  unchanged. It is not sufficient semantic scope identity.
- `snapshot_id` hashes serialized manifest text with paths. Sigil's existing
  `source_manifest` hashes sorted `(path, file, checksum)` rows, excluding
  irrelevant filesystem metadata. Preserve path-aware membership.
- `walk_inner` enumerates, hashes pending files, and assembles a manifest. It
  does not freeze the tree. `hash_pending` checks recorded size and handles
  disappearance/mmap faults without establishing an atomic multi-file view.
- `blake3_hash_file` returns a length taken from metadata before hashing, not
  an independently counted read length. Same-size edits need more than a size
  comparison.
- `CopyGuard` is stat-based optimization, not proof of content identity.
  Linked-object digest recovery relies on an object-store trust model. Current
  Sigil uses `NoFollow` and empty object-store hints; retain that boundary
  unless verified immutable snapshot objects become an explicit input mode.

Current `sources::capture` retains bytes, hashes them, then rehashes the path.
Explicit-file discovery also compares metadata and CopyGuard; directory
discovery delegates to Snapdir walk. These are useful defenses, not an atomic
source snapshot. The projection-store lock does not lock an editor out of
source files.

**Required change:** make every theorem name its captured immutable semantic
inputs. Recheck required source and membership before publication and before
labeling a report current; detected change or unavailable validation prevents
an unqualified current result. Describe currentness at validation, not a
permanent guarantee. An atomic point-in-time tree view requires a quiescent
source or filesystem snapshot mode. Keep atomic cache publication distinct
from atomic source capture.

### P2. Frontend and catalog do not carry the full native language surface

Current sources: [design-input.ts](../core/src/design-input.ts),
[frontend.rs](../sigilc/src/frontend.rs), and
[catalog.rs](../sigilc/src/catalog.rs).

The frontend already inventories physical Facets and emits Component
and locally owned Concept entities. `Unit.concept` is text rather than a
resolved Concept reference per contribution. Entity types do not include Tags
introduced in `interface` that are not Concepts, and the
transport lacks explicit Embedded Facet representation metadata. The core
source model now names Facet, EmbeddedFacet, and its fenced EmbeddedContent;
the narrower structural Design transport still needs that representation.
The parser's obsolete ungrouped-Interface warning has been removed. The current
Implementation catalog also restricts observation subjects in ways that do not
support the target's independent source-local anchors.

**Required change:** preserve native per-Facet identity, optional resolved
Concept, contextual owner, contract, and range; carry Embedded Facet structure;
extend accepted Design/public descriptors for source-supported Interface
definitions; and admit appropriately typed local observation subjects. Do not
force every operation, branch, or public term into a Concept.

Structural identity and arbitrary prose interpretation remain separate owners.
Use core resolution for scope and originating identities. Accepted Design
interpretation may establish public definitions inside prose, validated against
Interface ownership and accessibility; ambiguity remains a gap. Exporting
names must not copy private Facets or re-own imported vocabulary.

The existing authoring already demonstrates the intended organization:

| Source | What the refactor must preserve |
| --- | --- |
| [Parser](../core/src/parser.sigil) | Optional mixed grouping; repeated EmbeddedFacet and ParseResult contributions; native Facet boundaries and embedded content. |
| [Workspace pipeline](../core/src/pipeline.sigil) | Explicit ordering/assembly ownership; related but differently named Interface and operational Concepts. |
| [Core model module](../core/src/model/_module.sigil) | Assembly of public model domains without owning their shapes. |
| [Core package module](../core/_module.sigil) | Nested public assembly without absorbing imported behavior. |
| [Design conversation](../../integrations/skills/sigil/design-conversation.sigil) | Several Concepts, with DesignConversation spanning contract roles in a workflow design. |
| [Skill module](../../integrations/skills/sigil/_module.sigil) | Public workflow assembly, not a single merged responsibility. |

This is migration toward the canonical language, not a proposed language change.
See [native foundations](behavior_algebra.md#start-with-the-language-we-have)
and [explicit Concept connections](behavior_algebra.md#concepts-connect-explicit-relationships-finish-the-connection).

### P2. Run identity and historical impact need a stronger API boundary

Current sources: [inputs.rs](../sigilc/src/inputs.rs),
[store.rs](../sigilc/src/store.rs), [eqval.rs](../sigilc/src/eqval.rs), and
[implementation.rs](../sigilc/src/implementation.rs).

Keep three identities separate:

| Identity | Contents and consequence |
| --- | --- |
| Projection binding | Source, side/role, schema/ontology, frontend/context and complete consumed descriptors; determines reconstruction reuse. |
| Accepted projection | Binding plus accepted normalized observations and occurrences; a different reconstruction under unchanged bytes changes dependent proofs. |
| Semantic run | Membership, targets, boundaries, domains, assumptions, projection identities, laws/runtime; determines derived-result reuse. |

A law-only change need not force source reinterpretation. A type, ownership,
visibility, or descriptor-content change can matter despite unchanged labels.
Provider authority/freshness must be checked separately from descriptor hashes.
A changed callee invalidates proofs that used it even when a caller's consumed
identity descriptors stay unchanged.

`implementation::assemble_manifest` currently computes `all_fresh` over present
manifest files before appending deleted-source diagnostics. Explicit missing
paths instead fail discovery. The refactor must make required membership
explicit: a disappeared required target cannot become vacuous coverage, and
unselected cache history cannot create requirements.

The store retains distinct accepted bindings but not every reconstruction
generation under one binding. There is no complete last-known impact-selection
API. Add checksum-validated historical inspection with result types that cannot
enter current-world assembly. Historical paths must join compatible accepted
bindings/generations, not arbitrary edges from separate moments. Label candidate
impact when that support is unavailable; promise only history the cache retains.

See [result retention](behavior_algebra.md#what-the-result-must-retain) and
[architecture freshness](ARCHITECTURE.md#capture-binding-and-freshness).

## Egglog build and proof support

The actual engine supports the chosen direction. The missing capability is
primarily Sigil's representation, laws, comparison, and support, not a need to
replace Egglog.

| Inspected source | Mechanism and implication |
| --- | --- |
| `repos/egglog/src/lib.rs`, `EGraph::step_rules` | Explicit ruleset execution and update reports support phase scheduling. |
| `repos/egglog/egglog-bridge/src/lib.rs`, `run_rules`, `rebuild`, `UnionAction::union` | Staged unions and canonicalization change later matching, rather than merely adding transitive string links. |
| `repos/egglog/core-relations/src/table/rebuild.rs`, `do_rebuild` | Rebuild maintains relations over canonicalized values, enabling matching modulo discovered equality. |
| `repos/egglog/tests/web-demo/matrix.egg` | Typed/dimension-guarded expression laws demonstrate recognition of larger compositions. |
| `repos/egglog/tests/web-demo/rw-analysis.egg` | Control-flow facts and abstract-value analysis demonstrate inference from local observations. |
| `repos/egglog/src/proofs/proof_encoding.md` and proof implementation | Equality tracking, premises, congruence, and extraction can support derivation artifacts. |
| `repos/egglog/tests/proofs/eqsat-basic-proof.egg` | Concrete `prove` query for algebraically equivalent expressions. |
| `repos/egglog/tests/api_proofs.rs` | Proof mode rejects APIs that bypass instrumentation; arbitrary Rust callbacks/updates are not automatically provable. |

The engine recovers latent structure when observations preserve the relevant
distinctions and fixed laws express the composition. It does not infer arbitrary
sound domain laws from unstructured triples. That is consistent with the
[Egglog paper](https://arxiv.org/abs/2304.04332) and the
[official equality tutorial](https://egraphs-good.github.io/egglog-tutorial/01-basics.html).

The inspected checkout exposes `EGraph::new_with_proofs`, `prove`, and a
`ProofStore`. Proof checking establishes valid applications of the supplied
program's laws and supported primitive conditions; it does not certify that
those laws model Rust or that a source observation is faithful. Proof support
has a restricted subset, including unsupported-primitive cases recorded in
`tests/snapshots/files__proof_unsupported_files.snap`. Exercise the actual chosen
fragment during implementation. Preserve a complete relational support DAG
where it is needed alongside native expression proofs.

[sigilc's Cargo.toml](../sigilc/Cargo.toml) pins Egglog to
`90635860397ce710f8c0a4eeb04154a8ebc3ac05`; the inspected local Egglog manifest
declares version `3.0.0`. The inspection did not establish checkout/pin equality.
Sigil's Snapdir dependency is built from the `qoherent/snapdir` fork at
revision `b5e578009bed224b9c3b1dceb4ed1e929c4402f7`. That fork carries the
small portability changes previously held in the deleted vendored copy; the
inspected relevant hash/walk mechanisms otherwise match upstream. Record actual
build sources and law/runtime identity; do not promise an API because a
neighboring checkout exposes it.

Finite vocabulary does not imply finite term generation. Use bounded acyclic
initial models and a small sound rule set; avoid unrestricted expansion when
canonical finite evaluation suffices. Egglog's
[scheduling guide](https://egraphs-good.github.io/egglog-tutorial/04-scheduling.html)
explains the growth risk. The existing host checks limits between iterations,
not as hard per-iteration memory or wall-clock enforcement. Exhaustion must
remain an incomplete result.

## Outside this folder

These are implementation change surfaces, not files changed by this design
revision. Update their governing Sigil contracts alongside the corresponding
code. Canonical language clarifications govern over narrower old specifications.

| Surface | Required refactor |
| --- | --- |
| [core design export](../core/src/design-input.ts) and its [contract](../core/src/design-input.sigil) | Resolved Concept per contribution, native Facet/Embedded Facet transport, and the structural side of public identity/visibility. |
| `packages/core` parser, model, resolver, glossary, and module contracts | Reconcile any narrower restrictions with canonical Facets and Interface definitions; preserve scoped identities, collective expands, multiple Concepts, and explicit module assembly. Keep semantic prose interpretation outside deterministic parsing. |
| [sigilc frontend](../sigilc/src/frontend.rs) and [catalog](../sigilc/src/catalog.rs) | Consume richer native structure, separate accepted semantic public definitions, supply frozen identity/type descriptors, and allow typed local observations. |
| [Turtle](../sigilc/src/turtle.rs) and [projection encoding](../sigilc/src/assertions.rs) | Fixed eight-unit vocabulary, source occurrences, source roles, strict data-only validation, and typed lowering inputs. |
| [eqval host](../sigilc/src/eqval.rs), [shared laws](../sigilc/src/kernel.egg), [Design laws](../sigilc/src/design.egg), [comparison laws](../sigilc/src/comparison.egg), [comparison host](../sigilc/src/comparison.rs) | Extract reusable machinery to the new library; replace capability coverage with explicit supported comparison; retain independent graphs and valid structural invariants. |
| [sources](../sigilc/src/sources.rs), [inputs](../sigilc/src/inputs.rs), [store](../sigilc/src/store.rs) | Exact capture/binding, path-aware membership, accepted-content/run identities, preserved generation/CAS safeguards, and typed last-known inspection. |
| [Design assembly](../sigilc/src/design.rs), [Implementation assembly](../sigilc/src/implementation.rs), [scope](../sigilc/src/scope.rs) | Target/role isolation, public-input authority, disappearing required membership, and exclusion of stale/history inputs from current computation. |
| [reports](../sigilc/src/report.rs) and comparison/report tests | Boundary-qualified results, joint witnesses, two-sided source support, explicit gaps, historical locations, and separately bounded presentation. |
| [sigilc CLI](../sigilc/src/cli.rs), [store](../sigilc/src/store.rs), and reports | Completed: compiler-owned requests, attempts, receipts, artifact evidence, and `--evidence` are removed; `PreparedBinding` preserves publication correctness. |
| [sigilc README](../sigilc/README.md), governing `packages/sigilc/*.sigil`, [repository Sigil skill](../../integrations/skills/sigil/SKILL.md), its references and evals | Completed: command and authoring guidance use the binding handoff, with external reconstruction independent and scope semantic rather than scheduled work. |
| [Older language reference](../../spec/sigil-language.md), [language contract](../../spec/language.sigil), and relevant decisions | Reconcile narrower claims with [canonical language](../../language.md), including arbitrary Concepts per Component, native Facets, and public terms defined within Interface Facets. |
| [sigilc dependencies](../sigilc/Cargo.toml), actual Egglog build source, and the pinned `qoherent/snapdir` fork | Select compatible proof APIs, record actual runtime/build identities, and preserve the documented hashing/capture limits. No engine fork is presumed necessary. |

## Implementation sequence

Each stage must add a reviewable capability. The documentation design is already
aligned; the sequence below is remaining implementation, not a request to write
another proposal first.

1. **Carry the native language correctly.** Update core/frontend/catalog and
   governing contracts for multiple Concepts, resolved per-Facet identity,
   Embedded content, public definitions, and ownership-preserving imports/modules.
   Keep interpretation gaps explicit and freeze the complete consumed descriptor
   surface. Do not combine native identity with source-local observation types.
2. **Create the eqval library and typed input boundary.** Add the new Rust
   package and move reusable Egglog runtime/limit support out of sigilc. Lower
   data-only observations into the algebra's supported types, with occurrences,
   target/source roles, and independent graphs. Do not freeze the obsolete fact
   schema as the library API or restore a successful legacy fallback.
3. **Deliver finite admission equality.** Implement the example's pure Boolean
   calculation with complete finite comparison and supported Egglog explanation.
   Equivalent early exits and positive guards are Equal; removed cancellation
   produces the explicit `m=true,c=true` witness with current source support.
4. **Deliver finite guarded-operation equality.** Compare the joint condition,
   ordered actions, payload, outcome, and next state over a declared finite
   domain. Correct admission with a wrong write or return must be Different.
   Prove only the stated domain; unsupported semantics stays Unresolved.
5. **Complete the currentness and impact path.** Integrate path-aware captured
   manifests, target membership, public-provider authority, accepted-content/run
   invalidation, generation-safe publication, and compatible historical impact.
   Fresh diagnostics must not depend on the existence of an old projection.
6. **Switch the external protocol coherently.** Completed in the current
   implementation: `PreparedBinding/binding.json` replaced Job/job.json;
   process, evidence, and request state were removed from sigilc; CLI,
   contracts, docs, validators, and the repository-owned skill were updated.
   Scope, locking, source validation, restricted ingest, and atomic cache
   publication remain intact.
7. **Extend only with a concrete comparison.** Add supported callee composition,
   Case/test expectation comparison with production roles intact, and then
   broader value/state/protocol theories. PreparedBinding safety requires its
   actual ordering, failure, and concurrency model, not just three guards.

Stages 1-5 are the remaining eqval implementation slice. Protocol cleanup is
complete and cannot substitute for stages 3-4. Retain tests for
source capture, binding freshness, CAS publication, scope, graph separation,
restricted ingest, contradiction precedence, and limits. Replace tests whose
only purpose is preserving the old matcher or process schema.

## Acceptance criteria

These specify future implementation checks, not results obtained in this audit.

| Scenario | Required result |
| --- | --- |
| One Component contains several Concepts, each repeated across contracts/expands | Distinct resolved Concepts with collective, separately attributable Facets; no singleton or last-writer rule. |
| An operation Concept returns a separately defined result Concept | Explicit result relationship; neither Concept is reclassified as a Facet of the other. |
| Wrapped prose, an empty-line separator, and ungrouped/mixed Interface statements | Native Facet boundaries and optional Concept are preserved without grouping warnings or synthetic wrappers. |
| Embedded content contains blank lines and braces | Introducing prose, notation, body, and ranges remain intact; unsupported interpretation is an explicit gap. |
| Interface defines a public term without a Concept | Importable typed identity with defining Facet and originating owner; ordinary prose words are not all exports. |
| Consumer adds Facets about an imported Concept | Consumer obligations retain their context; provider meaning is not rewritten upstream. |
| Nested module exposes selected components | Explicit public surface and ownership, without directory sweeping or invented runtime sequencing. |
| Pure early returns and conjunction describe the same decision | Equal for the complete declared finite domain, with distinct source occurrences and a supported derivation. |
| Cancellation is removed | Fresh `m=true,c=true` witness; operation witness uses differing old/incoming Results and points to current code plus affected native Facets. |
| Admission agrees but the branch writes a wrong payload or returns the wrong alternative | Admission Equal, operation Different; the two boundaries are not conflated. |
| Individual status/payload sets match but their allowed pairs are crossed | Different joint behavior. |
| Ignored branch mutates state, repeats an action, or changes observed order | Different at a boundary observing those distinctions. |
| A Boolean-returning call can fail, mutate, or diverge | No pure-total rewrite; represent supported behavior or return Unresolved. |
| Equal current outputs conceal state affecting a later interaction | No repeated-interaction claim without a sufficient state correspondence and transition proof. |
| A prohibition holds in a complete supported finite model | Complete evaluation or a checked invariant can prove the property; no inference from mere absence. |
| Design allows more alternatives than implementation supplies | Conformance may hold; equality does not follow from subset inclusion. |
| Code adds a guard excluding the failing input | The Design domain is not narrowed to conceal the discrepancy. |
| Only correspondence, role claims, containment, or coarse capabilities are supplied | Behavioral equality remains Unresolved. |
| An external helper or branch is missing | No no-op substitution, mock substitution, or completed equality. |
| Rust is correct and Deno is missing/wrong | Separate target results; no pooled satisfaction. |
| Happy/sad Case exists without a test | Scenario meaning remains a Design obligation at its actual domain. |
| A test asserts the expected result while production is wrong or mocked | Expectation correspondence cannot prove production behavior or test execution. |
| Case quantification or must/may meaning is ambiguous | Explicit gap, not an invented universal requirement. |
| Decision describes a rejected alternative | Rationale retained without an obligation to implement the rejected choice. |
| Same-size edit, rename, duplicate-file removal, or new scope member | Captured path-aware membership changes handled; child digest alone is not the gate. |
| A required target disappears | No vacuous coverage; expectation comes from selected membership, not cache history. |
| Source/input changes or publication generation advances after preparation | Obsolete ingest rejected; stale observations cannot enter current closure. |
| Source changes during comparison | Result stays tied to captured inputs; currentness is qualified or unavailable after validation. |
| Accepted observations change with identical source bytes | Old dependent proofs invalidated by accepted-content identity. |
| Laws change with compatible observation meaning | Recompute affected proofs without compulsory model reconstruction. |
| History connects an edited file to a native Facet or origin | Impact only, with compatible generation-qualified support. |
| Code is deleted | Requirement/current enclosing evidence and explicitly historical location; no fabricated current span. |
| Distinct e-classes or extracted terms remain after symbolic search | Unresolved unless another complete method or supported refutation decides the question. |
| Both models contain unknowns, or a domain is accidentally empty | No covered-operation equality from matching gaps or vacuity. |
| A local current trace violates a prohibition while unrelated meaning is missing | Report the supported local discrepancy and unresolved remainder separately. |
| Presentation or computation hits a bound | Presentation omissions are explicit; incomplete computation never becomes Equal. |
| Cache is deleted | Equivalent accepted reconstructions yield equivalent semantics; historical impact may be unavailable. |

The completion criterion is not that more facts can be matched. It is that the
compiler derives a behavior not directly asserted as a capability, proves its
scoped equality to independent design meaning, and produces a supported
counterexample after a disagreeing edit. The [example](example.md) and
[algebra result contract](behavior_algebra.md#what-the-result-must-retain) define
exactly what that first capability must retain.
