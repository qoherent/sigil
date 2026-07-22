---
name: sigil
description: Work with Sigil, a lightweight rationale-oriented modeling language for software systems, and its CLI for AI-assisted development. Use when Codex needs to read, write, improve, reconcile, validate, query, render, or use `.sigil` files; introduce Sigil into an existing or partially documented brownfield codebase; assess semantic readiness, applicable standards, best practices, pitfalls, coherence, or modularity; create or update component/expand specs; describe product modules, programming abstractions, APIs, state machines, or architecture decisions; align code with Sigil; resolve ambiguity before code generation; or build from a Sigil-driven workflow. Prefer `sigil-cli` for mechanical parsing, checks, graph, context, and render operations. Stop for human review after creating or semantically changing Sigil, and do not write implementation code until the user explicitly approves the agreed Sigil.
---

# Sigil

Sigil is a lightweight, rationale-oriented modeling language for software
systems. It records what a system is, why it exists, how it behaves, and how its
implementation should be understood and changed over time.

Sigil is designed for humans and coding agents working together. Its purpose is
to keep system knowledge coherent by breaking a system into components and
preserving both the public contract and the reasoning behind implementation
decisions.

A Sigil component can be a product module, service boundary, domain concept,
library abstraction, API object, state machine, screen, view, reusable UI
surface, or other coherent unit. Do not assume the domain is only
business/product software.

Read `references/sigil-format.md` when you need syntax, section meanings, or
examples.

Read `references/standards-review.md` completely whenever creating, reviewing,
or preparing Sigil for implementation. It defines the semantic-readiness,
standards, conflict, evidence, and modularity procedure.

Read `references/implementation-design.md` completely whenever preparing to
write or change implementation or deciding whether existing Sigil covers the
implementation boundary. It defines implementation component discovery, the
component/expand/omit decision, UI component coverage, and the required
implementation coverage map.

Read `references/design-conversation.md` completely whenever material
clarification is needed before proposing Sigil or implementation. It defines
conversation phases, decision states, one-decision turns, prioritization,
checkpoints, deferral, conflict handling, and the synthesis exit condition.

Read `references/greenfield-design.md` completely when the selected behavior or
component has no existing implementation that constrains its intended contract.
It applies the shared design conversation to Greenfield intent, component
boundaries, synthesis, and approval. Do not reduce Greenfield work to one-shot
clarification.

Read `references/brownfield-adoption.md` completely when implementation already
exists but the relevant Sigil is absent or incomplete. Do not load it for a
greenfield design or a component with established Sigil unless the user asks for
brownfield reconciliation.

## Tooling

Prefer a `sigil` CLI command when it is available on `PATH`.

Use the CLI to parse, check, resolve graph data, collect context, or render
review Markdown instead of manually reimplementing those operations in the
agent.

An installed Codex skill does not include this repository's `packages/`
directory. Treat `packages/cli/src/main.ts` as available only when the current
workspace is the Sigil platform repository or another checkout that contains
that path.

CLI discovery order:

1. If `sigil` is available on `PATH`, use `sigil`.
2. Else, if the current workspace contains `packages/cli/src/main.ts`, invoke it
   with Deno from the workspace root.
3. Else, stop and ask the user to install a compatible Sigil CLI. Version 0.4
   does not silently reinterpret a configured workspace without its required
   parser and resolver.

Installed or global CLI command shape:

```bash
sigil check . --format json --pretty
```

Repository-local CLI command shape:

```bash
deno run --allow-read packages/cli/src/main.ts check . --format json --pretty
```

For a configured workspace, run before semantic work:

```bash
sigil version . --format json --pretty
sigil check . --format json --pretty
```

This skill version requires CLI and core `^0.4.0` and Sigil `0.4.0`. In a
Brownfield repository without `.sigil/config.json`, use the initialization
sequence in `references/brownfield-adoption.md` before this preflight. Otherwise
stop with a compatibility report when the CLI is missing, `.sigil/config.json`
is missing or invalid, or any resolved version is unsupported. Do not fall back
to the old project-root-only `#module.sigil` behavior.

Common invocations:

```bash
sigil parse path/to/file.sigil --format json --pretty
sigil check path-or-workspace --format json --pretty
sigil graph path-or-workspace --format json --pretty
sigil context path-or-workspace --component Name --format json --pretty
sigil context path-or-workspace --file path/to/file.sigil --format json --pretty
sigil render path-or-workspace
```

Interpret CLI exit codes as:

- `0`: command completed with no error diagnostics;
- `1`: command completed with error diagnostics; inspect JSON diagnostics and
  continue with partial models when useful;
- `2`: usage error; fix the command arguments;
- `3`: host/runtime failure; fall back only if the CLI cannot read the requested
  input.

If the CLI fails for host reasons, report the failure and stop before relying on
workspace semantics.

Do not use CLI output as approval to implement code. The review gate still
applies after creating or semantically changing Sigil files.

## Core Workflow

Select the workflow before detailed semantic work:

- For Greenfield behavior, follow `references/greenfield-design.md` and use
  `references/design-conversation.md` even when the first request appears clear.
  Resolve material decisions sequentially before synthesizing exact proposed
  Sigil for confirmation.
- For Brownfield behavior, follow `references/brownfield-adoption.md`. When the
  repository has no config, run `sigil init` first. Establish and review
  meaningful ordinary summary components for the workspace root and every
  declared member, then focus on the requested task boundary.
- For established Sigil coverage, use the shared workflow below unless the user
  requests Brownfield reconciliation or repository evidence suggests drift.

1. Discover relevant context.
   - When a `sigil` command or repo-local CLI is available, start with `check`
     on the target workspace or file to discover diagnostics.
   - Use `context --component Name` or `context --file path/to/file.sigil` when
     the user asks about a specific component or file.
   - Use `graph` when import relationships or expansion relationships matter.
   - Read relevant `.sigil` files after the CLI identifies them, especially
     before editing.
   - Follow `@path import { Name }` clauses manually when the CLI is unavailable
     or when source-level review needs exact wording.
   - Also read nearby code, docs, tests, package metadata, or architecture notes
     when the user asks to align Sigil with an existing repo.
   - For UI components, inspect referenced repository images and accessible
     external designs when their contents affect the requested contract. Report
     references that cannot be accessed instead of guessing their contents.
   - Treat the nearest eligible ancestor `.sigil/config.json` as the workspace
     root contract; a nearer independent workspace must be excluded by every
     configured parent.
   - Treat the directory containing `.sigil/config.json` as the workspace root
     and root-project location.
   - Treat `#module.sigil` as the explicit directory-import index allowed in any
     included directory. It must declare at least one local component. Its local
     components and directly imported names form the directory-import surface.
   - Treat every component as public through its explicit `.sigil` path even
     when a module index does not name it.
   - Use the workspace root and paths explicitly declared by
     `workspace.members` as Brownfield summary boundaries; never infer an
     additional summary boundary from directory structure or package manifests.
   - Treat an excluded subtree with its own `.sigil/config.json` as an
     independent workspace, not as a member of its parent.
   - Prefer descriptive `.sigil` filenames for component contracts and
     implementation rationale. Use `#module.sigil` when a directory needs
     intentional import shorthand.

2. Build the component picture.
   - Use CLI JSON diagnostics and context output when available to identify
     import dependencies, unresolved imported names, public contracts, collected
     expands, and related files.
   - Identify concept blocks, collective occurrences, public interface concepts,
     private concepts, and contextual imported-concept reuse.
   - Identify public `component` contracts: both `goal` and `interface` are
     public to dependents.
   - Identify matching `expand` blocks for operational detail.
   - Treat natural-language UI descriptions, ASCII wireframes, image references,
     and design links inside `interface` as free-form public-contract content.
     Do not invent keywords or authority fields for visual references.
   - Treat `component` as the reusable public contract and all matching
     `expand Name` blocks as the collected operational description.
   - Treat an interface as the operations, data, events, results, errors, and
     observable promises publicly available to the component's dependents even
     when the component is internal to the implementation.
   - Treat imports as dependency declarations. Do not repeat imported-component
     dependencies in `interface`.
   - Treat imported component dependencies as exposing public `goal` and
     `interface` content only. Inspect the provider explicitly when its private
     expands are relevant to review or implementation.
   - Consider coherent programming abstractions, internal APIs, state machines,
     screens, views, and reusable UI surfaces as possible components.
   - Note unresolved imports, missing components, collected-expand
     contradictions, vague lines, and code/spec drift.

3. Run the semantic-readiness and standards review.
   - Follow `references/standards-review.md`.
   - Make each goal specific, bounded, and unambiguous.
   - Check interfaces for required inputs, outputs, errors, permissions,
     lifecycle promises, and applicable standards or best practices.
   - Check that interface content is grouped under concise concept identifiers
     and that identifiers reused across sections describe one coherent concept.
   - For UI components, check visible regions, actions, navigation, feedback,
     loading, empty, error, and disabled behavior when those details materially
     affect the contract.
   - Derive externally observable edge cases and test points from state, logic,
     and constraints.
   - Check imported components, collected expands, and module summaries for
     contradictions, ownership overlap, and inconsistent contracts.
   - Assess cohesion, interface size, coupling, dependency direction, state
     ownership, and reasons to change without assigning a numeric score.
   - Assess standards applicability on every review, but research only when the
     domain, stack, risk, or public contract makes external guidance relevant.
   - Classify each researched finding as compatible guidance, potential
     conflict, definite conflict, unverifiable guidance, or non-applicable.

4. Propose externally informed changes before editing.
   - For compatible guidance, show the exact proposed semantic lines and target
     sections, cite the sources in the review summary, and wait for approval
     before editing Sigil.
   - For potential or definite conflicts, preserve Sigil, warn the user,
     identify the affected lines and guidance, explain the impact, and offer
     alternatives.
   - For unavailable or paywalled authoritative material, block high-risk or
     compliance-critical implementation; otherwise warn, record uncertainty, and
     require explicit user acceptance.
   - Keep source details in the review summary, not in Sigil. Write approved
     additions as project decisions rather than claims that a standard mandates
     them.
   - Use only provisional assessment language: `appears aligned`, `partially
     assessed`, `gap identified`, `conflict identified`, or `not assessable`.
     Never claim certification or definitive compliance.

5. Improve Sigil before generating code.
   - Before adding or modifying implementation, verify that the affected
     behavior has clear Sigil coverage. If it does not, stop and collaborate
     with the user to define, review, and approve the affected Sigil before
     changing code.
   - If the user is asking for implementation and the Sigil is incomplete,
     repair or propose the Sigil first.
   - Follow `references/implementation-design.md` and report the implementation
     coverage map before writing code.
   - Do not treat high-level project, service, or feature coverage as sufficient
     when material implementation components or decisions remain unspecified.
   - Choose a component for a coherent responsibility with a stable contract
     relied upon by dependents, an expand for operational rationale owned by an
     existing component, and no separate Sigil for trivial mechanics.
   - When material clarification is needed, use
     `references/design-conversation.md` to prioritize one primary decision per
     turn, maintain decision states, and resolve blockers before synthesis.
   - Apply that shared protocol to Greenfield design, Brownfield boundary
     summaries and task discovery, established-Sigil ambiguity, and
     implementation decisions.
   - After the user approves externally informed additions, place each semantic
     line in the appropriate `state`, `logic`, `constraints`, or `cases`
     section.

6. Keep sections disciplined.
   - A UI `interface` may describe visible structure and interactions with
     natural language, brace-safe ASCII, repository image references, or design
     links such as Figma URLs.
   - Put binding decisions in `constraints`, including stack choices and
     architecture rules.
   - Put behavior, flows, transitions, algorithms, transformations, and decision
     paths in `logic`.
   - Put meaningful runtime/domain configurations in `state`.
   - Put rules, policies, invariants, architecture, ownership, dependencies,
     module boundaries, and binding technology decisions in `constraints`.
   - Put examples, acceptance criteria, and edge cases in `cases`.

7. Manage concept identifiers.
   - Use `ConceptIdentifier { ... }` blocks to group one or more related
     semantic lines under a reusable identity.
   - Treat ungrouped `interface` content reported by
     `SIGIL_MISSING_CONCEPT_IDENTIFIER` as an authoring gap to repair before
     semantic review. Other sections use concept blocks only when reuse is
     valuable.
   - Allow one concept block to contain a single heavily reused concept or
     several related semantic lines.
   - Resolve repeated blocks collectively across the component and all matching
     expands without overriding their section-specific content.
   - Treat a concept as public when it occurs in `interface`; otherwise keep it
     private to the component and matching expands.
   - Reuse imported public concepts as bare identifiers. Preserve the provider's
     identity and keep consumer lines contextual to the consumer. Do not use
     dotted notation, aliases, shadowing, or nested concept blocks.
   - When subagents are available, delegate concept grouping and identifier
     generation to one dedicated subagent after collecting the relevant
     component, all matching expands, and accessible imported public concepts.
     Tell the subagent to return a proposal only and not edit files.
   - Require the subagent proposal to identify each affected region, whether it
     represents one concept or several, whether each identifier is new or
     reused, and the proposed concise names.
   - Validate proposed names in the primary agent against
     `[A-Za-z][A-Za-z0-9_-]*`, case-insensitive namespace uniqueness, public and
     private visibility, and transitive import ambiguity before editing.
   - Prefer PascalCase without hyphens or underscores. Treat an unusually long
     name as a reason to reconsider the concept grouping or component boundary,
     not as a deterministic length error.
   - When subagents are unavailable, perform the same proposal and validation
     steps in the primary agent and state that delegation was unavailable.
   - Keep anchoring outside concept-identifier work. Do not invoke or modify
     anchor persistence, proposal, or reconciliation behavior.

8. Preserve semantic lines.
   - Keep each non-empty line as one distinct idea.
   - Separate distinct prose-level ideas with blank lines in every section.
   - Blank lines do not create semantic units.
   - Keep lines in one compact free-form construct adjacent when separating them
     would reduce readability.
   - Prefer concise, reviewable lines over paragraphs inside sections.
   - Free-form Markdown, pseudocode, API signatures, bullets, tables, and prose
     are allowed inside sections when they remain coherent.
   - Preserve the author's natural wording for visual references. Do not
     introduce a vocabulary that Sigil does not define.

9. Stop at the Sigil review gate.
   - After creating or semantically changing Sigil files, summarize the changes
     and ask the user to review them.
   - Do not write implementation code in the same pass unless the user has
     already explicitly approved the current Sigil and explicitly asked for
     code.
   - A request like "use Sigil", "improve Sigil", "prepare Sigil", or "check the
     spec before coding" is not approval to code.

10. Colocate approved Sigil with its implementation.
   - Before writing implementation code, determine the module or source
     directory that will own the implementation.
   - Treat a Sigil file created elsewhere while the implementation location was
     unknown as temporary; move it beside the owning module or source files once
     that location is known.
   - Keep a shared public `component` at its contract or module-summary location
     when multiple implementations depend on it, and place
     implementation-specific `expand Name` blocks beside the code they explain.
   - When one Sigil file describes components owned by different implementation
     directories, split it so each component or implementation-specific expand
     lives near its owner. Do not duplicate a public component declaration.
   - Do not move a configured-boundary `#module.sigil` merely to colocate code;
     its ordinary summary component remains at the workspace root or declared
     member boundary. Internal module indexes may move with their owning
     directories.
   - Update every affected `@path import { Name }` after moving or splitting a
     Sigil file.
   - Run `sigil check` after relocation, and use `sigil graph` or
     `sigil context` to verify imports, collected expands, and related file
     paths when relevant.

11. Implement only after approval.
   - Do not add or modify implementation without clear, user-approved Sigil
     coverage for the affected behavior.
   - Use the approved Sigil as the durable rationale and source of constraints.
   - Keep generated code aligned with component boundaries and public
     interfaces.
   - Include Sigil relocation in the implementation work; do not leave an
     approved component in a temporary planning directory when its owning code
     now has a clear home.
   - If implementation reveals a missing decision, stop and update or propose
     Sigil first, then ask for review again.

## Review Gate

Externally informed compatible guidance and brownfield reconstruction have a
proposal gate before any edit. Present exact additions and wait for approval.
After approval, edit Sigil and stop again at the semantic review gate so the
user can review the complete file.

The review gate is mandatory when Sigil is created or semantically changed.
After approval, a placement-only move or split that preserves the approved
semantic lines may proceed with implementation without another review gate.
Import-path updates required by that relocation are also placement-only. Any
changed, added, or removed semantic line still requires review.

At the gate, respond with:

- changed Sigil files;
- the main decisions or assumptions captured;
- unresolved questions, if any;
- a direct request for the user to review and approve before implementation.

Do not continue from the review gate into implementation just because the
original user request included code generation. The point of Sigil is to make
the human check the durable rationale before code exists.

## Review Heuristics

When reviewing or improving Sigil, check:

- Is every goal specific about responsibility, boundary, and intended outcome?
- Does every `#module.sigil` declare at least one local component?
- Does every interface make relevant inputs, outputs, errors, permissions,
  lifecycle promises, and other observable behavior explicit?
- Is every interface region grouped under one or more concise concept
  identifiers, with CLI warnings repaired before review?
- Do repeated identifiers refer to one coherent concept across the component
  and its expands?
- Are private concepts absent from imported dependency projections?
- Are imported public concepts reused contextually without dotted notation,
  aliasing, shadowing, or case-insensitive ambiguity?
- Do imports declare component dependencies without repeating them in
  interfaces?
- Does each `expand Name` have a matching `component Name`?
- Does each imported name resolve to a matching component in the imported Sigil
  source?
- Are details such as `state`, `logic`, `constraints`, and `cases` kept in
  `expand` rather than inside `component`?
- Are architecture and stack decisions expressed as constraints?
- Are implementation-hiding rules and forbidden internal access in constraints
  unless they define an externally observable promise?
- Are roles, states, permissions, and lifecycle transitions explicit enough to
  test?
- For abstractions and APIs, are constructor/functions, return values,
  settlement/lifecycle behavior, and error behavior explicit?
- For UI components, are visible structure, interactions, navigation, feedback,
  and applicable loading, empty, error, disabled, responsive, keyboard, and
  accessibility behavior clear enough to implement and observe?
- If an image, screenshot, or design link is referenced, is its intended role
  clear enough to avoid conflicting interpretations, and is required material
  accessible?
- Are examples in `cases` externally observable?
- Do state, logic, and constraints imply missing edge cases or test points?
- If there are multiple expands for the same component, did you collect all
  matching expands and flag any contradictions between them?
- Do related Sigil files agree on naming, ownership, dependency direction,
  states, policies, and public expectations?
- Is each component cohesive, appropriately sized, and coupled through explicit
  contracts rather than another component's private details?
- Did implementation coverage consider programming abstractions, internal APIs,
  state machines, screens, views, and reusable UI surfaces rather than only
  high-level product or service boundaries?
- Does each material implementation concern have an intentional component,
  expand, or omit decision with a clear owner and location?
- Did you assess whether applicable standards, formal guidance, or official
  platform practices reveal gaps, conflicts, or pitfalls?

## Working With Users

Sigil is collaborative. Do not silently invent major product, architecture, or
domain decisions. When clarification is material, follow
`references/design-conversation.md`: ask one primary decision per turn unless
the user requests a faster grouped review, acknowledge each answer, maintain the
decision states, surface conflicts before advancing, and synthesize only after
blocking decisions are resolved.

Greenfield and Brownfield workflows decide what evidence and contract questions
matter. `references/design-conversation.md` decides how those questions are
sequenced, discussed, recorded, and completed.

Ask targeted questions when:

- a component boundary is unclear;
- a public interface would change depending on the answer;
- multiple modules could own the same responsibility;
- a lifecycle or state transition has unclear behavior;
- an API-shaped interface has unclear return, error, chaining, or async
  behavior;
- a UI description and its visual references support materially different
  implementations, or a required visual reference is inaccessible;
- stack, persistence, auth, deployment, or testing choices are binding but
  unstated;
- code generation would lock in a domain rule that is not captured.

Prefer editing the Sigil directly when:

- the issue is wording, typos, section placement, or consistency;
- the decision already appears elsewhere in the repo;
- a line can be made clearer without changing meaning.

Do not directly edit Sigil from external guidance until the user approves the
proposed semantic lines. Do not resolve a conflict by silently prioritizing a
standard, repository behavior, or user preference.

In brownfield work, treat code as evidence of current behavior, not proof of
desired behavior or rationale. Do not create or change Sigil until the user
approves the pilot boundary and exact semantic lines.

When creating a Brownfield summary component for the workspace root or a
declared member, repository evidence may support a provisional boundary picture
but cannot establish its intended goal or interface. Ask the user to confirm or
correct both before showing the exact boundary-module proposal.

## Output Style

For a standards-aware semantic review, use these headings and write `none` when
a section has no findings:

- Scope and risk
- Sources consulted
- Compatible suggestions
- Conflicts and pitfalls
- Cross-Sigil coherence and modularity
- Unverifiable guidance
- Proposed Sigil edits
- Approval request

For each source, report its issuer, title, identifier or version when available,
publication or update date when available, access date, direct link, and any
scope limitation. Do not copy the source details into Sigil.

At a semantic review gate, summarize:

- which files changed;
- which ambiguities were resolved;
- which open questions remain;
- that implementation is waiting for user approval of the Sigil.

After an approved placement-only relocation during implementation, summarize:

- the old and new Sigil paths;
- any imports updated;
- the validation command and result.

When a user asks only for understanding or review, do not edit files unless they
ask for updates.
