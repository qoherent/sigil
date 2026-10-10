# Computed design evaluation

The current skill is [sigil-compute-design](../../integrations/skills/sigil-compute-design/SKILL.md).
It runs the one-source and full-design loops with `sigilc` 0.3.0. The rename
preserves source selection, private stores, fresh children, re-asks, report
identity checks and conditional write-back.

The [evaluation fixture](../../integrations/skills/sigil-compute-design/evals/computed-evaluation-fixture.md)
covers the routing, reading, refusal, failure, isolation and write-back cases.
Offline validation checks the renamed catalog, dependencies and local links.
Live benchmark results are recorded separately; a rename is no new behavioral
observation.

The [2026-09-23 observations](evidence/sigil-compute/observations.md) retain the
skill name, tool versions and limits actually observed then. Their evidence
paths and bytes are unchanged.
