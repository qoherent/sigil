<!--
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::SemanticUnitDisciplineGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::SemanticUnitDiscipline constraints
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::DecisionRationaleWorkflow interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ImportSemanticsGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ImportSemantics logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ModuleIndexFileGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ModuleIndexFile logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ConceptIdentifierWorkflow interface,logic,constraints
-->

# Sigil Authoring Conventions

Use these conventions whenever proposing, creating, or semantically editing
Sigil. Read `sigil-format.md` when syntax details or examples are needed.

## Section Discipline

- Put the component's responsibility and intended outcome in `goal`.
- Put dependent-facing operations, data, events, results, errors, UI behavior,
  and observable promises in `interface`.
- Put meaningful runtime or domain configurations in `state`.
- Put flows, transitions, algorithms, transformations, and decision paths in
  `logic`.
- Put policies, invariants, architecture, ownership, dependencies, module
  boundaries, and binding technology decisions in `constraints`.
- Put durable rationale for material selected choices in `decisions`; retain
  the binding outcome in `constraints`.
- Put examples, acceptance criteria, edge cases, and externally observable test
  points in `cases`.

UI interface content may use natural language, brace-safe ASCII, repository
image references, or design links. Preserve the author's natural wording and do
not invent visual-authority keywords.

## Architectural Modularity And Module Indexes

Write Sigil at the architectural boundaries that implementation should preserve.
When a responsibility owns an independently relied-upon contract, mutable state,
lifecycle, policy, or durable reason to change, give it its own component. Put
implementation-specific operational detail in an expand beside its owner. Do
not place several independently changing responsibilities beneath one
high-level component merely because they share a package or product boundary.

Before proposing local components or concept identifiers, inspect the complete
accessible imported public namespace. Reuse every imported component and public
concept whose meaning matches. Create a local identity only for a materially
distinct responsibility or meaning. Do not create aliases, dotted names, local
synonyms, or duplicate provider contracts. Never force reuse when similar words
represent different concepts.

Keep each `ModuleIndexFile` small by responsibility, not by an arbitrary line
count. It contains one concise local summary component for its directory or
configured boundary and imports the cohesive components intended for directory
shorthand. Its matching expand retains only boundary-wide architecture
constraints and durable design decisions.

Move material operational logic, mutable state, detailed lifecycle behavior,
and independently changing policy into components or expands beside their
owners. A module index may retain state or orchestration only when it genuinely
governs the whole indexed boundary and cannot coherently belong to a narrower
owner.

Before approval, verify that the proposed component and expand decomposition can
guide code generation into cohesive implementation modules. The corresponding
implementation entrypoint or index assembles the approved public namespace; it
does not become the default owner of unrelated behavior or state.

## Decision Rationale

Before presenting any semantic proposal, inventory every new or changed selected
choice expressed across `goal`, `interface`, `state`, `logic`, `constraints`,
and `cases`. A choice is material when future review, maintenance, or
implementation cannot safely reconstruct why it was selected or which
alternatives it excludes.

Map every material selected choice to one concise PascalCase concept block in
`decisions`. Record `Decision` and `Scope`; `Context` is not part of the current
convention.

Use `Scope` to state the governed boundary and important exclusions without
attempting to enumerate every current dependent.

Record `Assumptions`, `Trade-offs`, `Design issues addressed`, `Discarded
alternatives`, `Consequences`, and `Revisit when` when materially applicable.
Omit inapplicable labels instead of adding filler.

Include a compact decision-rationale coverage map with every semantic proposal:

| Material choice | Decision concept | Coverage |
| --- | --- | --- |
| Exact selected choice | Matching concept identifier | `covered`, `missing`, or `justified omission` |

Use `justified omission` only for a trivial, mechanically derived, or safely
reconstructable choice, and state the evidence. When the binding outcome is
confirmed but its rationale record is missing, include the exact decision block
in the proposal. When the governing rationale is unresolved or conflicts with
evidence, return to DesignConversation in the applicable mode before proposing
it.

The absence of a `decisions` section remains structurally valid Sigil, but
semantic readiness cannot appear aligned while a material selected choice lacks
durable rationale. Successful CLI validation does not establish
decision-rationale coverage.

Reuse an accessible concept identifier when decisions concern the same semantic
idea. Scope remains local to the contextual occurrence; reuse never makes a
decision transitively binding.

An import exposes a provider's public concept identity but not its private
decision rationale. Automatically projected direct-dependency decisions provide
scoped agent rationale without becoming part of the language-level contract.
Inspect the provider explicitly when transitive decisions or other private
operational detail matters.

Summarize durable rationale rather than prompts, raw session transcripts, or
hidden reasoning. Responsibility, accountability, approver, and handoff metadata
remain outside the convention.

After writing approved Sigil, repeat the coverage audit against the exact
written semantic units. A missing material decision returns to
`ReviewGate(action: sigil-change)` and blocks implementation readiness.

## Semantic Units, Width, And Literals

Treat each blank-line-delimited prose paragraph as one semantic unit. Physical
wrapping inside that paragraph is presentation only. Keep distinct ideas
separated by blank lines and keep ordinary prose within 79 content characters;
leading indentation does not count.

Use a directly attached typed literal block when code, JSON, configuration,
data, or a diagram needs multiple physical lines. Put no blank line between the
introducing prose and opening fence. Literal bodies are preserved and do not
provide import, concept, glossary, or ownership evidence.

Every resolved imported name needs a qualifying exact-case use in `interface`,
`state`, `logic`, `constraints`, or `cases`, or a structural use through a
matching local `expand` or `_module.sigil` surface. `goal`, `decisions`, and
literal blocks are documentary for import-use purposes.

Use `sigil fmt <selected-path> --check` after approved edits. Apply `sigil fmt`
only when formatting that selected scope is approved; never infer permission
for a repository-wide formatting pass.

## Concept Identifiers

Treat ungrouped `interface` content reported by
`SIGIL_MISSING_CONCEPT_IDENTIFIER` as a deferred authoring gap. First complete
the pre-grouping semantic-readiness review from `standards-review.md` against
the exact ungrouped prose. Do not begin concept reuse discovery, grouping,
identifier generation, or warning repair while semantic readiness is
`unassessed` or `correction required`.

After semantic readiness appears aligned for the selected scope,
concept-identifier creation, reuse, regrouping, renaming, and warning repair use
`ReviewGate(action: sigil-change)` for the exact proposal before any repository
mutation.

Before proposing an identifier:

1. inspect the remainder of the same section, every other section of the
   component, and every matching expand for the same semantic idea;
2. inspect existing local concepts and accessible imported public concepts;
3. use `sigil graph` to inspect direct importers for relevant use cases and
   established terminology;
4. traverse transitive importers only when a concept is re-exposed or namespace
   ambiguity must be assessed;
5. classify each affected interface region as local reuse, imported public
   reuse, or a new identity.

Consumer terminology is naming evidence, not reusable identity unless valid
imports make it accessible. Reuse imported public concepts as bare identifiers.
Do not invent dotted notation, aliases, shadowing, or nested concept blocks.

When subagents are available, delegate concept grouping and identifier
generation to one dedicated subagent only after completing reuse discovery.
Give it affected regions, the component and matching expands, local occurrences,
accessible imported concepts, relevant direct-consumer use cases, and graph
paths. Require it to return a proposal only and not edit files.

The proposal must identify each affected region, whether it is one concept or
several, whether each identifier is new or reused, supporting occurrences,
relevant graph paths, rejected alternatives, and proposed concise names.

Validate proposals in the primary agent against
`[A-Za-z][A-Za-z0-9_-]*`, case-insensitive namespace uniqueness, public and
private visibility, collective coherence, and transitive import ambiguity.
Subagent completion is not user approval and grants no edit authority to the
primary agent.

Present the complete exact proposal to ReviewGate, enter awaiting approval, and
leave files unchanged until `sigil-change` is ready. Prefer PascalCase without
hyphens or underscores. Treat an unusually long name as a possible grouping or
component-boundary problem.

When subagents are unavailable, perform the same discovery, proposal, and
validation in the primary agent. Keep anchoring outside concept-identifier work.

After applying an approved grouping or identifier change:

1. run `sigil check`;
2. use `sigil context` or `sigil graph` when identity relationships changed;
3. repeat the semantic-readiness review on the grouped Sigil;
4. investigate any suspected material ambiguity and return to DesignConversation
   in correction mode only when the ambiguity confirms a material problem;
5. begin glossary candidate extraction only when the final review appears
   aligned.

## Semantic Units

- Keep each blank-line-delimited semantic unit focused on one distinct idea.
- Separate distinct prose-level ideas with blank lines in every section.
- Blank lines do not create semantic units.
- Keep lines in one compact free-form construct adjacent when separation would
  reduce readability.
- Prefer concise reviewable lines over prose paragraphs.
- Preserve exact approved meaning while moving, splitting, or formatting.

## Colocation

Before implementation, determine the module or source directory that owns each
component or implementation-specific expand.

Keep a shared public component at its contract or module-summary location when
multiple implementations depend on it. Put implementation-specific expands
beside the code they explain. Split files that describe owners in different
directories without duplicating a public component declaration.

Do not move a configured-boundary `_module.sigil`; its ordinary summary remains
at the workspace root or declared-member boundary. Internal module indexes may
move with their owning directories.

Update affected imports after an approved placement-only move, run
`sigil check`, and use `graph` or `context` when relationships matter. Any
semantic-unit change requires `ReviewGate(action: sigil-change)`.
