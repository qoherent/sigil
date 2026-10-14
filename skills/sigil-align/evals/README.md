# Evaluate the implementation alignment skill

Package checks validate distribution. Observed runs establish whether an agent
follows the skill. The bundle has no model runner; use ordinary host agents and
disposable workspaces. A fixture's presence is not an observed pass.

## Package checks

From the source checkout, run:

```sh
deno task test:skill
deno test --allow-read --allow-write scripts/skill-foundation_test.ts
deno task test:cli
deno task package:cli
```

Record commands, exit codes, and release artifact identity. These checks cover
catalog validity, dependencies, installation, and packaging. They do not prove
agent repair, restraint, independent evaluation, or user-decision behavior.

## Prepare and record an observed run

1. Install the complete valid skill catalog outside the checkout, including
   `sigil-align` and its `sigil-understand`, `sigil-evaluate`, and `sigil-write`
   siblings. In the tested installed copy, remove every skill's `evals/`
   directory before starting an agent; keep the fixture and observer notes in a
   runner-only location outside the catalog's parent directory. Verify and
   record that no `evals/` directory remains in the tested catalog. Record the
   installation command, location, validation result, and hashes of the
   installed skill and reference files. Give each agent the installed
   entrypoint.
2. For each case in [the alignment fixture](alignment-fixture.md), create a
   fresh disposable workspace outside the catalog's parent directory.
   Materialize only that case's named input fences at their paths, preserving
   bytes and layout. The `Request` is the agent prompt, not a file. Keep
   observer notes and host events outside the tested agent's inputs. Record
   pre-event and post-event hashes.
3. Start a fresh alignment agent for each case without inherited conversation.
   Supply the exact request, selected source, installed skill entrypoint,
   workspace location, and actual available tools. Keep workspaces and histories
   separate. Record host, exposed model identity, agent handle, tool limits, and
   the actual file access boundary, how it was enforced or checked, and any
   paths the agent could still read, including the source checkout and
   runner-only fixture. If access is only restricted by an instruction, label
   the run instruction-only. When delegation is available, retain the
   independent evaluator's request, diagnostics, and post-repair reassessment.
4. Capture the agent request and response, tool commands and exit codes, input
   digests, code and test edits, checks actually run, findings, user-decision
   handoff, and final report. Retain failures and reruns as separate attempts.
   Do not infer a repair or test pass from a final file or prose alone.
5. Compare the trace with the hidden observer notes after the run. Fix guidance
   or fixtures exposed as wrong by observation, then rerun the affected case
   with a new attempt identity.

## Cases and evidence to inspect

- **A:** The read-only evaluator anchors the stale search response defect to the
  accepted commitment. The alignment agent repairs it without a user decision,
  adds a focused regression test, runs the relevant test, and reassesses the
  changed path.
- **B:** Valid caching and cancellation mechanics remain implementation choices.
  Record any edits and their reason; there should be no false drift finding or
  request to expand Sigil.
- **C:** Unauthorized-download drift is repaired and checked before the
  unresolved retention duration is handed to the user. Capture the narrow
  choice, trade-offs, source identities, completed work, and checks. After the
  observer's policy-file change and old “seven days” answer, the agent must
  reread current sources, detect the adopted thirty-day policy, and avoid a
  stale Sigil revision. Use `sigil-write` and independent design review only for
  an authorized contract change.
- **D:** The agent follows behavior into the helper despite the ownership
  annotation, repairs stale publication, and tests the changed path.
- **G:** Without a compatible Sigil CLI, the agent still reads the accepted
  contract and code, runs the relevant test, and reports the evidence limit.
  Verify and record the agent's executable search path and resolution of
  compatible CLI commands. If CLI absence is only stated in the request, label
  that condition instruction-only; do not claim the tool was unavailable.

When the host cannot intercept a live child, a controlled replay may test how an
agent consumes a captured report. Label it **controlled replay**, not an
independent interpretation. Record instruction-only limits as such.

Write observed results to `docs/skill-evaluation/sigil-align.md` only after
executed runs. Include enough catalog, source, request, digest, trace, edit,
test, failure, and rerun detail for another host to assess each claim. State the
actual catalog and workspace separation, file access and CLI isolation limits,
and coverage limits. Do not promote a passing test, annotation, or package check
into proof of full implementation alignment.
