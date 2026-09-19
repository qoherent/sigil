<!--
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::FacetDisciplineGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::FacetDiscipline constraints
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::DecisionRationaleWorkflow interface,logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ImportSemanticsGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ImportSemantics logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ModuleIndexFileGuidance interface
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ModuleIndexFile logic,constraints,cases
@sigil implements integrations/skills/sigil/authoring-workflow.sigil::SigilAuthoringWorkflow::ConceptWorkflow interface,logic,constraints
-->

# Sigil Authoring Conventions

Use these conventions whenever proposing, creating, or semantically editing
Sigil. Read `sigil-format.md` when syntax details or examples are needed.

After DesignIntake establishes a mechanical route or DesignConversation resolves
material intent, write the exact scoped Sigil draft directly in the selected file.
Then use compiler evidence to revise and validate that written draft; do not
require compiler evidence before creating it.

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

## Architectural Modularity And Summaries

Write Sigil at the architectural boundaries that implementation should preserve.
When a responsibility owns an independently relied-upon contract, mutable state,
lifecycle, policy, or durable reason to change, give it its own component. Do
not place several independently changing responsibilities beneath one
high-level component merely because they share a package or product boundary.

Before proposing local components or Concepts, inspect every accessible imported
Tag. Reuse every imported Tag whose meaning matches. Create a local identity only
for a materially distinct responsibility or meaning. Do not create aliases,
dotted names, local synonyms, or duplicate provider contracts. Never force reuse
when similar words represent different concerns.

Keep each summary source small by responsibility, not by an arbitrary line
count. It contains one concise local summary component for its directory or
configured boundary and retains only boundary-wide architecture constraints and
durable design decisions. Move material operational logic, mutable state,
detailed lifecycle behavior, and independently changing policy into narrower
components beside their owners. A summary may retain state or orchestration only
when it genuinely governs the whole boundary and cannot coherently belong to a
narrower owner.

Before approval, verify that the proposed component decomposition can guide code
generation into cohesive implementation modules. The corresponding
implementation entrypoint or index assembles the approved surface; it does not
become the default owner of unrelated behavior or state.

## Decision Rationale

Before presenting any semantic proposal, inventory every new or changed selected
choice expressed across `goal`, `interface`, `state`, `logic`, `constraints`,
and `cases`. A choice is material when future review, maintenance, or
implementation cannot safely reconstruct why it was selected or which
alternatives it excludes.

Map every material selected choice to one concise PascalCase Concept in
`decisions`. Record `Decision` and `Scope`; `Context` is not part of the current
convention.

Use `Scope` to state the governed boundary and important exclusions without
attempting to enumerate every current dependent.

Record `Assumptions`, `Trade-offs`, `Design issues addressed`, `Discarded
alternatives`, `Consequences`, and `Revisit when` when materially applicable.
Omit inapplicable labels instead of adding filler.

Include a compact decision-rationale coverage map with every semantic proposal:

| Material choice | Decision Concept | Coverage |
| --- | --- | --- |
| Exact selected choice | Matching Concept | `covered`, `missing`, or `justified omission` |

Use `justified omission` only for a trivial, mechanically derived, or safely
reconstructable choice, and state the evidence. When the binding outcome is
confirmed but its rationale record is missing, include the exact decision
Facets in the proposal. When the governing rationale is unresolved or conflicts
with evidence, return to DesignConversation in the applicable mode before
proposing it.

The absence of a `decisions` section remains structurally valid Sigil, but
semantic readiness cannot appear aligned while a material selected choice lacks
durable rationale. Successful CLI validation does not establish
decision-rationale coverage.

Reuse an accessible Tag when decisions concern the same semantic idea. Scope
remains local to the contextual occurrence; reuse never makes a decision
transitively binding.

An import selects a provider's Tag identity but does not expose its decision
rationale. Automatically projected direct-dependency decisions provide scoped
agent rationale without becoming part of the language-level contract. Inspect
the provider explicitly when transitive decisions or other operational detail
matters.

Summarize durable rationale rather than prompts, raw session transcripts, or
hidden reasoning. Responsibility, accountability, approver, and handoff metadata
remain outside the convention.

After writing scoped Sigil, repeat the coverage audit against the exact written
Facets. A missing material decision blocks implementation readiness until the
written Sigil is corrected and revalidated.

## Facets, Width, And Literals

Treat each blank-line-delimited prose paragraph as one Facet. Physical wrapping
inside that paragraph is presentation only. Keep distinct ideas separated by
blank lines and keep ordinary prose within 79 content characters; leading
indentation does not count.

Use a directly attached typed fenced content when code, JSON, configuration,
data, or a diagram needs multiple physical lines. Put no blank line between the
introducing prose and opening fence. Literal bodies are preserved and do not
provide import, Tag, glossary, or ownership evidence.

Every resolved imported Tag needs a qualifying exact-case bare reference in
`goal`, `interface`, `state`, `logic`, `constraints`, `decisions`, or `cases`.
Headings, fenced content, and complete Inline Links are documentary for
import-use purposes.

Use `sigil fmt <selected-path> --check` after scoped edits. Apply `sigil fmt`
only when formatting that selected scope is approved; never infer permission
for a repository-wide formatting pass.

## Concepts

Facets can appear directly under every contract, including `interface`, and may
mix freely with Concept-grouped Facets. Ungrouped content is not a defect.
Actively identify the Concepts in a component and reuse their Tags to connect
Facets across contracts. Real components commonly contain several ideas that
benefit from that grouping. Smaller components may need no Concept; preserve
useful ungrouped and mixed authoring rather than adding wrappers mechanically.
Native Design evidence can inform that choice; missing reconstruction does not
prohibit authoring.

Start with the concerns, not a list of names. Ask which Interface promises,
State descriptions, Logic steps, Constraints, Decisions, and Cases describe the
same idea. Prefer a Concept when a reader benefits from following that idea
across those contributions. Do not wait for the author to request grouping when
several recurring concerns are already apparent.

| Situation | Authoring move |
| --- | --- |
| Request eligibility and result publication each recur across contracts | Use distinct `Admission` and `Publication` Concepts; reuse each Tag where its Facets belong. |
| An accessible imported Tag already names the same concern | Reuse that identity instead of creating a local synonym. |
| A concern needs a stable identity for consumers even before it recurs locally | A Concept can be useful; recurrence is a signal, not a minimum block count. |
| One small lookup operation already has a clear component identity | Keep its Facets direct unless a separate Concept adds useful identity. |
| A guarantee applies to the whole operation or spans several concerns | Leave it ungrouped when clearer, alongside the Concepts. |
| Each paragraph, function, or contract would receive its own wrapper | Keep Facets direct or regroup by meaning; those boundaries do not define Concepts. |
| A responsibility has independent ownership and reasons to change | Consider a separate Component, not a Concept used to conceal an oversized owner. |

Reuse a Concept only in contracts with something material to say about it. Do
not fill all seven contracts, duplicate a shared Facet into every group, or
invent a catch-all Concept for remaining prose. Grouped and ungrouped Cases both
describe scenarios, including happy and sad paths, whether tests exist or not.
A shared Concept preserves attribution; it is not a behavioral equality proof
or an all-or-nothing diagnostic bucket.

Before proposing a Concept:

1. inspect the remainder of the same section and every other section of the
   component for the same semantic idea;
2. inspect existing local Concepts and accessible imported Tags;
3. use `sigil retrieve --purpose architecture` to inspect direct importers for
   relevant use cases and established terminology;
4. traverse transitive importers only when a Concept is re-exposed or name
   ambiguity must be assessed;
5. classify each affected region as remaining ungrouped, local reuse, imported
   reuse, or a justified new identity.

Consumer terminology is naming evidence, not reusable identity unless valid
imports make it accessible. Reuse imported Tags as bare names. Do not invent
dotted notation, aliases, shadowing, or nested Concepts.

When subagents are available, delegate Concept grouping and name generation to
one dedicated subagent only after completing reuse discovery. Give it affected
regions, the component, local occurrences, accessible imported Tags, relevant
direct-consumer use cases, and graph paths. Require it to return a proposal only
and not edit files. The proposal must identify each affected region, whether it
is one Concept or several, whether each name is new or reused, supporting
occurrences, relevant graph paths, rejected alternatives, and proposed concise
names.

Validate proposals in the primary agent for exact name spelling, accessible
Tag-name uniqueness, importable identity, collective coherence, and transitive
import ambiguity. Subagent completion is not user approval and grants no edit
authority to the primary agent.

Report the changed Concepts and evidence in the written-file review. Prefer
PascalCase without hyphens or underscores. Treat an unusually long name as a
possible grouping or component-boundary problem.

When subagents are unavailable, perform the same discovery, proposal, and
validation in the primary agent. Keep grouping and naming work separate from
unrelated edits.

After applying a grouping or name change:

1. run `sigil check`;
2. use `sigil retrieve --purpose architecture` when identity relationships
   changed; use `context` or `graph` only for missing detail;
3. refresh native Design capture and affected reconstruction for semantic review;
4. investigate any suspected material ambiguity and return to DesignConversation
   in correction mode only when the ambiguity confirms a material problem;
5. inspect relevant glossary changes when requested or materially necessary.

## Facets

- Keep each blank-line-delimited Facet focused on one distinct idea.
- Separate distinct prose-level ideas with blank lines in every section.
- Blank lines do not create Facets.
- Keep lines in one compact free-form construct adjacent when separation would
  reduce readability.
- Prefer concise reviewable lines over prose paragraphs.
- Preserve exact approved meaning while moving, splitting, or formatting.

## Colocation

Before implementation, determine the module or source directory that owns each
component.

Keep a shared public component at its contract or module-summary location when
multiple implementations depend on it. Put implementation-specific Facets beside
the code they explain. Split files that describe owners in different directories
without duplicating a component declaration.

Do not move a configured-boundary summary source; its summary remains at the
workspace root or declared-member boundary. Internal sources may move with their
owning directories.

Update affected imports after a placement-only move, run `sigil check`, and use
`graph` or `context` when relationships matter. Any Facet change requires
written-file validation and design compilation.

A boundary can outgrow itself as coverage is added. Propose splitting one when
its contracts serve areas that change for independent reasons, when a reader
must load the whole boundary to review one area, or when compiling the smallest
covering boundary routinely pulls in unrelated work. Treat that as the module
structure decision in `references/greenfield-design.md`, applied to an existing
boundary: propose the areas, their directories, and their declared-member
status, and confirm the split before moving anything.
