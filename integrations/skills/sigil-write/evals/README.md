# Evaluate the Sigil 0.8 design skills

Package validation and observed agent behavior answer different questions. Run
both before claiming the foundation works. These instructions use ordinary host
agents and temporary files; the bundle contains no model runner.

## Package checks

From the source checkout:

```sh
deno task test:skill
deno test --allow-read --allow-write scripts/skill-foundation_test.ts
deno test --allow-env --allow-read --allow-write --allow-run --filter 'skill ' packages/cli/tests/cli_test.ts
```

The first command needs no binaries, network, write or subprocess permission.
The tests mutate disposable copies to check source/output drift, missing siblings,
reference failures, and relocation. The separate `test:skill:native` task requires
the existing CLI and sigilc builds and exercises the legacy 0.7 protocol.

## Prepare an observed run

1. Copy all three foundation skill directories together to a temporary catalog
   outside repository source discovery. Include every reference and metadata file.
2. Materialize a fixture's fenced input blocks under a separate temporary workspace
   at their named paths. Preserve bytes and relative layout. Keep the fixture's
   observer notes out of the tested agent's accessible inputs.
3. Give a fresh agent the fixture request, exact installed skill entrypoint, selected
   source locations, and actual tool restrictions. Keep cases independent. The
   writer's evaluator must also be a fresh agent receiving its explicit capture
   request, rather than inheriting a defense of the draft.
4. Record the host and exposed model identity, agent handles, skill/reference
   hashes, input hashes, actual requests and responses, source changes, and exit
   outcome. Hash direct-review sources before and after; evaluators must not edit.
   A separate recorder can save returned reports after evaluation has finished.
5. Compare the observed result with the fixture's observer notes. Preserve failed
   attempts and reruns. A final correct file does not prove that a diagnostic drove
   the correction or that a fresh independent review occurred.

Use these fixtures:

- [Understanding](../../sigil-understand/evals/understanding-fixture.md): ownership,
  selected multiword Tags, compactness, and interpretation boundaries.
- [Design evaluation](../../sigil-evaluate/evals/design-review-fixture.md): sufficient
  compact design, contradiction, ownership conflict, simplification and missing policy.
- [Writing loop](writing-loop-fixture.md): corrections, unresolved choices, evidence
  retrieval, freshness, progress, and handoff.
- [Mechanical validation](mechanical-validation-fixture.md): compatible CLI use,
  scoped formatting, read-only evaluation, unavailable tooling, and exact-revision
  evidence. Run these with their own CLI availability; older offline cases remain
  explicitly offline.

For a diagnostic-driven loop, an ordinary writer may fix the defect while drafting,
before its first review. Record that honestly. To exercise the correction path,
continue the writing task from an actual completed evaluator report against its
unchanged original inputs; retain that report and verify the writer's subsequent
edit and fresh delegated assessment.

For compactness, compare the verbose design with the simplified output, then give
another fresh evaluator only that output and ordinary context. Check that every
independent promise survives and the evaluator accepts the compact result.

## Fault injection and limits

Use controlled report replay for stale inputs, reworded findings, oscillation,
and malformed/interrupted responses when the host cannot intercept a live report.
Retain the original captures, injected change, and report, and distinguish these
consumer observations from real independent evaluation. A replayed clean report
never establishes independent review. When simulating absent delegation through
instructions, say it was disabled by instruction; do not claim the host lacked tools.

Record whether read-only was sandbox-enforced or merely instructed. Do not claim
unobserved mechanical validation, code alignment, saturated coherence, or behavior
on untested hosts. Unavailable evidence or delegation is a valid incomplete
outcome when the skill reports it accurately.

Repository observations live at `docs/skill-evaluation/sigil-0.8-foundation.md`.
Update that report only from executed runs, with enough source identity and
request detail for another host to reproduce the case.

Record new CLI-enabled observations separately in
`docs/skill-evaluation/sigil-mechanical-validation.md`; preserve the historical
offline report's original limitations.
