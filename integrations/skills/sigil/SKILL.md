---
name: sigil
description: Author and inspect legacy Sigil 0.7 contracts using native sigilc scope and semantic gates. For Sigil 0.8 design understanding, writing, or advisory evaluation, use the sigil-understand, sigil-write, or sigil-evaluate skills.
---

<!--
@sigil implements integrations/skills/sigil/_module.sigil::SigilSkill::SkillWorkflow interface
@sigil implements integrations/skills/sigil/implementation-workflow.sigil::SigilImplementationWorkflow::ImplementationOwnershipWorkflow interface,logic,constraints,cases
-->

# Sigil — legacy 0.7 native workflow

This skill targets the implemented Sigil 0.7 language and native workflow.
For 0.8 designs, select `sigil-understand`, `sigil-write`, or `sigil-evaluate`.
Their source-based design workflows do not require the bootstrap below.

`sigil` owns language inspection and structural Design export. Use `sigilc`
directly for scope, freshness, preparation, ingestion, catalogs and semantic
gates. The native compiler never starts models or owns the coding loop.

Inspect governing Sigil before every implementation mutation. Read the
component, matching expands, imports and relevant implementation before changing
its contract. Existing user authorization remains effective; a compiler report
is evidence, not a separate permission system.

## Select the work

Use [workspace bootstrap](references/workspace-bootstrap.md) to locate and check
the selected workspace and tools. Inspect authored files with:

```sh
sigil check . --format json
sigil retrieve . --component Name --purpose implementation --format markdown
sigil context . --component Name --format markdown
sigil graph . --format json
sigil glossary . --format json
```

Use [greenfield design](references/greenfield-design.md) for new boundaries and
[brownfield adoption](references/brownfield-adoption.md) for existing behavior.
For unresolved intent, read
[design conversation](references/design-conversation.md) and ask about the
material decision that available evidence cannot resolve. Read
[authoring conventions](references/authoring-conventions.md) and
[language syntax](references/sigil-format.md) when writing contracts. Reuse
accessible identities and keep each responsibility with its owner.

## Make recurring concepts explicit

When authoring or reviewing Sigil, actively look for concerns whose Facets recur
across contracts: request lifecycle, selection, cancellation, publication,
authorization. Prefer Concept IDs when they make those connections explicit;
real components commonly have several. Reuse the same resolved identifier for
the same concern across contracts and matching expands, and reuse accessible
imported identities when their meaning matches.

Keep shared component-wide promises and standalone Facets ungrouped where that
is clearer. Mix them with Concept blocks in the same contract. A small component
with one clear concern may need no Concept wrapper. Do not manufacture one per
function, paragraph, or contract, or require every Concept in all seven
contracts. Grouping identifies related meaning; it does not prescribe code
structure or prove behavior. Use the selection examples in
[authoring conventions](references/authoring-conventions.md#concept-identifiers).

## Use the native flow

Read [compilation execution](references/compilation-execution.md) for the exact
semantic protocol, per-source inputs, and command exits. Capture current
authored input with `sigil export design .`; use that JSON with native
`--frontend`, and refresh it after authored, configuration, or glossary changes.

1. Inspect `sigilc scope` and `sigilc stale` with the intended selection.
   Preserve every fresh projection and prepare only rows reported stale,
   missing, or dependency-invalid. Scope is semantic membership and caller
   priority; it is not task state.
2. Prepare each stale Design source. `prepare` writes copied semantic inputs
   and an immutable `binding.json`. An external caller may give those inputs to
   an isolated interpreter and retain its own attempts and records.
3. Submit the interpreter's Turtle with the matching
   `sigilc ingest --binding binding.json` command. On rejection, the external
   caller may repair its temporary Turtle and retry with the same binding. Never
   mutate source bytes, the binding, or a published projection. Reprepare when
   a bound input changes.
4. Run `sigilc compile design` and inspect the named state and diagnostics.
   `sigilc entities` exports the current identity catalog when available.
5. Prepare and ingest each selected Implementation source. Its interpreter
   receives exactly captured source bytes, fixed ontology, and frozen catalog.
   Keep Design prose and neighboring code out of those inputs.
6. Run `sigilc compile implementation` or `sigilc compare`. Preserve unavailable
   prerequisites and warnings. Reconstruct changed inputs before comparing
   again.

The external host decides how to schedule interpreters, retry them, and retain
workflow records. `sigilc` only validates bindings and publishes accepted
semantic projections. `.sigil/worlds/` containing only its lock, preparation,
fixtures, or hand-authored Turtle does not establish a fresh semantic result.

See [Design review](references/design-compilation-review.md) and
[implementation design](references/implementation-design.md) for interpretation.
These operations derive meaning from independently supplied assertions; passing
fixtures, ownership comments or tests do not establish reconstruction fidelity.
Delivery, tests, removals, and other product decisions remain outside the
compiler and this semantic gate.

Keep `.sigil/worlds/` ignored: it is disposable generated state. Keep
preparation and report files outside selected source scope. Human decisions,
model calls, isolation, scheduling and the convergence loop belong to the
external host. Use existing native functions before inventing temporary
mechanisms. An observed missing capability belongs in authored Design and its
responsible implementation; use it on real work before removing the duplicate
mechanism.

## Conditional references

- [Frontend surface review](references/frontend-surface-review.md): routing,
  client-state ownership, async modes, accessibility and UI contracts.
- [Glossary workflow](references/glossary-workflow.md): reviewed vocabulary.
  State whether extraction is required, deferred or inspection-only when
  relevant; ordinary inspection does not require a glossary rewrite.
- [Design intake](references/design-intake.md): ambiguous task boundaries.
- [External guidance](references/external-guidance-evidence.md) and
  [standards review](references/standards-review.md): evidence needed by the
  task.

Update this repository-owned skill, metadata and evals together. Do not modify
an installed global copy to compensate for obsolete repository guidance.
