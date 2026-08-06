<!-- @sigil implements integrations/skills/sigil/glossary-workflow.sigil::SigilGlossaryWorkflow::GlossaryWorkflow interface,logic,constraints,cases -->

# Reviewed Glossary Workflow

Use this procedure after every approved `.sigil` write or semantic edit, when
`.sigil/glossary.json` exists, when the user asks to create or maintain project
vocabulary, or when terminology ambiguity materially affects Sigil design or
review.

The glossary is reviewed authority. Deterministic tools inspect accepted entries
and occurrences; the host model must separately extract candidates and identify
semantic conflicts but cannot make inferred language authoritative.

## Session Routing Status

In every Sigil session, explicitly classify and report one glossary status:

- `extraction required`: approved semantic Sigil was written or edited, the
  user requested vocabulary review, or material terminology ambiguity affects
  the selected scope;
- `extraction deferred`: extraction is triggered but semantic readiness is
  `unassessed` or `correction required`;
- `deterministic inspection only`: the session is read-only or changes only
  implementation and has no vocabulary-review or material-ambiguity trigger.

When GlossaryFile exists, perform deterministic glossary inspection even when
model-assisted extraction is not triggered. After an approved semantic Sigil
write or edit, inspect deterministic state even when GlossaryFile is absent.
Never silently omit the status. For a deferred status, name the blocking review
state. For inspection only, explain that no semantic Sigil lines entered
candidate extraction.

## 1. Inspect Deterministic State

When GlossaryFile exists or after writing approved Sigil, run:

```bash
sigil glossary . --format json --pretty
sigil check . --format json --pretty
```

Inspect:

- whether GlossaryFile is absent, valid, or invalid;
- workspace terms and bounded-context terms;
- file-path glob resolution;
- accepted aliases;
- resolved source occurrences;
- context overlap and spelling-collision diagnostics.

When GlossaryFile is invalid, accepted definitions are inactive. Propose an
exact repair before relying on its entries.

An absent GlossaryFile is valid deterministic state. Continue with candidate
extraction from the changed semantic units only after semantic readiness
appears aligned rather than skipping this workflow.

Completing `sigil glossary` completes only deterministic inspection. The
command does not extract unknown vocabulary, propose definitions, identify all
semantic conflicts, or decide whether GlossaryFile needs a change. Zero
diagnostics establish only that the deterministic glossary projection is valid.
They do not establish semantic readiness or authorize candidate extraction.
Never report that no glossary changes are needed from CLI output alone.

## 2. Preserve Authority

An approved normative Sigil contract governs when its wording conflicts with a
glossary definition. Report the affected contract lines and glossary entry and
propose correcting GlossaryFile.

Do not:

- infer approval from repeated usage;
- automatically create or rewrite entries;
- treat an extracted candidate as accepted vocabulary;
- turn an unknown word into a deterministic missing-term diagnostic;
- equate glossary terms with Sigil concept identifiers;
- use glossary definitions to override component or concept resolution.

## 3. Extract Candidates

Candidate extraction is a mandatory model-assisted stage for every approved
Sigil write or semantic edit, explicit vocabulary-review request, or material
terminology ambiguity in the selected scope, but it begins only after:

1. deterministic workspace validation completes without error diagnostics;
2. the post-write semantic-readiness review appears aligned;
3. any required concept grouping is proposed, approved, and applied;
4. deterministic validation and final semantic-readiness review after grouping
   both complete successfully.

When concept grouping is unnecessary, the post-write semantic-readiness review
directly controls extraction eligibility. When semantic readiness is
`unassessed` or
`correction required`, do not inspect prose for glossary candidates. Investigate
suspected findings while readiness remains unassessed; enter DesignConversation
in correction mode only for a confirmed material problem.

Deterministic glossary inspection may occur before semantic review, but it
remains separate from extraction. Diagnostic count and GlossaryFile presence do
not remove the semantic-readiness prerequisite. Do not merge deterministic
inspection, semantic review, and model-assisted extraction or treat success in
one stage as completion of another.

Initial extraction examines free-form prose in loaded `.sigil` documents only.
Exclude structural syntax, concept identifiers, imports, code fences, inline
code, and URLs.

After an approved semantic mutation, extraction starts from the changed semantic
lines. For an explicit vocabulary review or material terminology ambiguity
without changed Sigil, extract from the selected loaded Sigil scope. Do not
expand either form into an unrelated workspace-wide scan.

Prefer candidates that are:

- domain-specific or project-specific;
- repeated across components or expands;
- used with materially different possible meanings;
- abbreviated, aliased, or easily confused;
- important to a public contract, state, policy, lifecycle, or acceptance case.

Do not propose ordinary English or language syntax merely because it occurs
frequently.

Inspect enough surrounding component, expand, and glossary occurrences to
determine whether each candidate meaning is coherent.

For every candidate collect:

- exact spelling and relevant variants;
- source file, component or expand, section, line, and occurrence text;
- the meaning supported by each occurrence;
- whether occurrences agree, conflict, or remain ambiguous;
- existing accepted entries that may already cover the idea.

When occurrences support incompatible definitions, present a focused review
question. Do not synthesize one definition that hides the conflict.

Block Sigil review and implementation only when an undefined, conflicting, or
incorrectly scoped term could materially alter behavior, ownership, state, APIs,
or implementation.

Always report the extraction result:

- When a material candidate exists, collect its evidence and follow the exact
  proposal workflow below.
- When no material candidate exists, record an evidence-based result naming the
  changed semantic units or selected loaded scope and the relevant surrounding
  component, expand, glossary, and variant occurrences inspected. A diagnostic
  count is not evidence for this conclusion.

Only then prepare the next applicable ReviewGate action.

## 4. Select Scope

Recommend workspace scope when one reviewed meaning applies throughout the
workspace.

Recommend a bounded context when the meaning is intentionally limited to a
coherent path-owned domain and may differ elsewhere.

For a bounded context:

- propose a stable context identifier;
- propose workspace-relative include and exclude globs;
- check every loaded source for overlap with existing contexts;
- explain why the path boundary matches semantic ownership;
- avoid broad globs that create accidental precedence.

A context entry may intentionally replace a workspace spelling only inside that
context. State that consequence explicitly in the proposal.

## 5. Present The Exact Proposal

For each proposed addition, replacement, alias change, scope move, or removal,
show:

- canonical term;
- concise reviewed definition;
- optional aliases;
- workspace or bounded-context scope;
- supporting source occurrences;
- conflicts or uncertainty;
- rejected spellings, definitions, or scopes;
- the exact JSON change.

Classify the proposal as:

- `new candidate`;
- `definition clarification`;
- `alias change`;
- `scope change`;
- `normative conflict repair`;
- `removal`.

Submit the exact JSON, scope, and evidence to
`ReviewGate(action: glossary-change)`. Ask the user to approve, reject, or
revise it. Leave repository files unchanged until ReviewGate returns ready.

## 6. Apply And Review

After `ReviewGate(action: glossary-change)` returns ready:

1. write only the accepted JSON change;
2. preserve strict schema version 1 structure;
3. run `sigil glossary . --format json --pretty`;
4. run `sigil check . --format json --pretty`;
5. inspect changed context resolution and occurrences;
6. report the validated glossary and continue to the next applicable ReviewGate
   action without creating a separate glossary-review gate.

Do not continue into unrelated Sigil or implementation changes merely because
the glossary validates.

## 7. Prepare Coding Context

Before implementation, run `sigil context` for the selected component or file.
Make its `glossaryContext` available to the coding agent together with the
approved Sigil contract.

The scoped projection contains accepted definitions recognized in the selected
component or file and its related expansion sources. Preserve canonical terms,
definitions, aliases, resolved bounded contexts, and occurrences. Do not replace
Sigil behavior with glossary prose.

Compare material vocabulary in the implementation request with accepted
spellings reported by `sigil glossary`. If a request term is accepted but does
not occur in the selected Sigil sources, add only that matching entry to the
handoff. Do not inject the complete unrelated workspace glossary.

## 8. Deferred Scope

Markdown and other document adapters are deferred from the initial workflow. Do
not claim their terms were scanned or kept coherent until deterministic document
support is introduced and reviewed.
