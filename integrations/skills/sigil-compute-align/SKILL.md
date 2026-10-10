---
name: sigil-compute-align
description: Run a computed Sigil 0.9 implementation check with sigilc, first reading the full design, then whole code files, and hand back Closed, Converged, Drift, or Incomplete with bound findings and proposed excludes. Use for explicit computed implementation checks, sigilc align, or this skill; plain implementation review or alignment stays with sigil-align.
---

# Computed implementation alignment

Own the design-first `sigilc` alignment loop for an existing Sigil 0.9
workspace. Read the [orchestration contract](references/computed-alignment.md)
before running it; it owns selection, the shared private store, delegation,
bounded re-asks, identity checks, write-back and hand-back.

First require effective `tools.sigilc.implementation` in workspace/local config.
If absent, launch no child and return a proposed selection block as output only.
Seed one private store outside the workspace with design and implementation
readings. Run the full-design action of
[sigil-compute-design](../sigil-compute-design/SKILL.md) on that already seeded
store. In this composition only, this outer loop defers the inner action's
write-back until the whole run succeeds. Standalone design behavior is unchanged.
A final Disjoint or Incomplete design permits no code reader: run the deterministic
alignment check on the same store and hand back its matching Incomplete report
with design findings.

Otherwise prepare the code once and delegate one fresh isolated child per
presented whole file. Each child loads
[sigil-understand](../sigil-understand/SKILL.md) for design meaning and
[sigil-egglog](../sigil-egglog/SKILL.md)'s code profile for row language; compiled
preparation guidance is authoritative. Ingest answers serially. Re-ask only
refused or unread files, at most twice after their first answer. Drift,
undesigned elements and unanswered promises never trigger a re-ask.

Return the exact Implementation state and matched report, its identities and
scope, findings, unread files, excludes and their counts, and components outside
promise scope. Plumbing findings may lead to proposed excludes or a proposal to
design that behavior. Never write configuration, excludes, code or design, and
never assign the design state Coherent to implementation. The native binary
reads no skill and launches no model. Any operational, delegation or identity
failure makes this run failed and writes nothing to the workspace store.
