# Evaluate the computed evaluation skill

Package validation and observed agent behavior answer different questions. Run
both before claiming the claims loop works through a skill. These instructions
use ordinary host agents and temporary files; the bundle contains no model
runner, and the claims binary never launches one.

## Package checks

From the source checkout:

```sh
deno task test:skill
deno test --allow-read --allow-write scripts/skill-foundation_test.ts
deno test --allow-env --allow-read --allow-write --allow-run --filter 'skill ' packages/cli/tests/cli_test.ts
```

The first command needs no binaries, network, write or subprocess permission.
The tests mutate disposable copies to check source/output drift, missing
siblings, reference failures, and relocation. The native claims tests that
establish the protocol itself are separate; this skill adds no compiler
change, and a discrepancy is reported rather than silently patched.

## Prepare an observed run

1. Copy the installed skill directories together to a temporary catalog
   outside repository source discovery: `sigil-compute` with its required
   `sigil-understand` and `sigil-egglog`, plus the installed `sigil-evaluate`
   and `sigil-write` so the routing cases have real destinations. Include
   every reference and metadata file.
2. Materialize the fixture's fenced inputs under a separate temporary
   workspace at their named paths. Preserve bytes and relative layout. Keep
   the fixture's observer notes out of the tested agents' accessible inputs.
3. Give a fresh host agent the fixture request, the exact installed
   `sigil-compute` entrypoint, the selected source location, and the actual
   availability of the `sigil` and `sigil-claims` binaries. Keep variants
   independent. The interpreter child must itself be a fresh agent receiving
   only the prepared handoff — the installed understanding and egglog
   entrypoints, the preparation directory, and its files — never the host's
   conversation or a defense of earlier steps.
4. Record the host and exposed model identities, agent handles, skill and
   reference hashes, workspace input hashes, actual requests and responses,
   every tool command with its exit code, and the run directory's retained
   contents: the seeded store, the preparation
   directory, the child's captured artifact bytes, and the report ingest
   wrote. Hash the workspace's `.sigil/claims/interpretations/` before and
   after each run; either action may write there only through its write-back,
   and a failed run writes nothing.
5. Compare the observed result with the fixture's observer notes. Preserve
   failed attempts and reruns. A final clean handback does not prove the loop
   ran, the child was fresh, or the state came from a matched report; check
   the recorded trace.

Use this fixture:

- [Computed evaluation](computed-evaluation-fixture.md): routing, actual
  Coherent, flow-only Loose, and contradiction Disjoint deliveries, source
  resolution, tool-owned dependency context, memo reuse against interruption, a live
  edit that makes ingest refuse the binding, and the failure cases — refused artifacts
  beside a valid Disjoint, missing prerequisites, non-conforming children
  never repaired and re-asked at most twice, input and payload mismatches, a post-report
  operational failure, and per-run private-store isolation. Scenario 15 covers
  the re-ask: two refused units, one fixed by the first re-ask, the other still
  refused after the second, handed back Incomplete with no third re-ask and no
  row written by the host. Scenario 14 covers
  the full-design action: a second run with no edits launching no reader, a
  failed reader leaving an `incomplete` handback that names its source, a
  refused dependent reading re-read once and not again, and the one-source loop
  running no linked check while writing back what it read.

## Fault injection and limits

When the host cannot intercept a live child, controlled report replay can
exercise consumer behavior — a stale report, a malformed payload, a bare exit
code — but label that evidence **controlled replay**, never real delegation,
and retain the original captures and the injected change. An interruption
produced by instruction is recorded as instruction, not as a missing child or
missing tool. Do not claim unobserved states, untested hosts, or coverage the
captured preparation does not have. An unavailable `sigil-claims`
binary is a recorded limitation, never a Coherent, Loose, or Disjoint.

Repository observations live at `docs/skill-evaluation/sigil-compute.md`.
Update that report only from executed runs, with enough source identity,
request detail, and retained artifacts for another host to reproduce the case.
