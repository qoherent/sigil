<!-- @sigil implements integrations/skills/sigil/design-compilation-review.sigil::SigilDesignCompilationReview::DesignCompilationReview interface,state,logic,constraints,cases -->

# Compiler-Driven Design Review

Use this procedure after design intent and applicable external guidance are
sufficiently resolved. It consumes compiler-owned semantic-readiness and
architecture-design evaluation as provisional evidence. It never approves a
Sigil mutation or implementation.

## Select The Scope

Select the nearest configured workspace that imports the affected Sigil file.
Use `sigil retrieve --purpose architecture` as the preferred source for imports,
expands, and consumers. Correct retrieval diagnostics before proceeding. Use
`sigil graph` or `sigil context` only for a required relationship or detail
absent from a successful retrieval.

Name the scope that changed and let the compiler resolve the boundary.

The compiler owns compilation-boundary selection. Every selector is an
affected-scope seed rather than a final target: `--component <name>`,
`--file <path>`, `--file <path> --position <line:column>`, and
`--directory <path>` all identify affected evidence, and the compiler selects
the boundary whose closure covers it.

Pass the scope you actually changed:

| What changed | Selector |
| --- | --- |
| One component's contract | `--component <exact-case name>` |
| One Sigil file | `--file <path>` |
| A specific form in a file | `--file <path> --position <line:column>` |
| Several files in one folder | `--directory <path>` |
| Work spanning unrelated areas | no selector; compile the workspace |

Read the boundary the compiler chose from the report rather than deriving it
yourself. `requestedScope` is what you asked for, `target` is what was
compiled, and `selection` records the strategy, the affected and covered
semantic units, any uncovered evidence, and the deciding tie-break. Report both
when they differ, and treat a `workspace-fallback` strategy and its reason as
the compiler telling you no narrower boundary covered the work.

Do not reimplement selection with graph or retrieval commands, and do not treat
a selected component as the final target. Use `--exact-target` only for a
deliberately narrow run, where preserving the exact selector matters more than
covering the affected boundary.

An unresolvable selector fails the invocation with a stable diagnostic instead
of silently compiling the workspace; correct the name or path rather than
retrying a wider target.

## Compile-And-Resolve Loop

Accept the exact scoped change already written to the target workspace. The target
file is the review artifact; do not reproduce complete proposed source in chat and do
not start a compiler session for ordinary authoring or review. Run this loop
after every semantic write:

```bash
sigil check <workspace-root> --format json --pretty
sigil compile <workspace-root> --agent --focus design <target-selector> --format markdown --output <fresh-report-path>
```

Follow `references/compilation-execution.md` with `focus: design`. Its fresh-output,
process-exit, report-validation, and one-retry rules apply before interpreting the
report. If the first run ends without usable completed-report evidence, rerun the
identical frozen target once with a new attempt output path and interpret only a
valid completed Markdown report. Preserve operational evidence from both attempts.
Completed green, yellow, and red reports proceed to design review interpretation
without automatic retry.

1. Return a deterministic, structural, or coherence correction requirement to the
   authoring workflow when the report and established intent determine one safe
   correction; that workflow writes it and invokes this review again.
2. Enter `references/design-conversation.md` when a finding exposes an
   unresolved material decision, conflicting intent, or future-facing pitfall.
3. Write the resulting scoped correction and compile again.

Repeat until the report is green or every yellow finding is explicitly reviewed
and accepted as nonblocking. Do not synthesize follow-on Sigil, extract glossary
candidates, or begin implementation from red, unresolved-yellow, unavailable,
or incomplete design evidence. If progress requires user judgment, keep the
affected scope in DesignConversation rather than guessing.

Compilation itself is a mandatory gate. No written-file review, concept grouping,
glossary extraction, implementation ReviewGate, or implementation may proceed
until the required compiler process exits with a readable completed Markdown
report. A running, unavailable, incomplete, failed, or cancelled compile cannot
be waived by the user or treated as a skipped check; use the one-retry rule and
then remain blocked.

## Interpret The Final Report

- Red is not reviewable for implementation.
- Yellow requires explicit human acceptance of every finding as nonblocking for
  the exact scope.
- Green is evidence for user review and implementation approval, not approval.

Do not duplicate the compiler's semantic-readiness or architecture-design
judgment in a second host-generated status. The host still owns external-
guidance applicability, finding disposition, design decisions, concept grouping,
glossary extraction, and ReviewGate.

Evidence for written-file review identifies the selected workspace root, changed
paths, semantic units, target, profile, focus, report status, and every yellow
disposition. Submit this evidence with the validated written Sigil to
`ReviewGate(action: implementation)` only when implementation is requested.

Written evidence must be green or explicitly reviewed yellow before concept
grouping, glossary extraction, or implementation review. Any semantic edit or
grouping change restarts the compile-and-resolve loop.

An unavailable, incomplete, failed, cancelled, or red compiler result blocks
implementation review. An unresolved yellow finding also blocks it. Report target
ambiguity or other compilation failure explicitly; never bypass it with an
untracked source copy or an omitted compilation.
