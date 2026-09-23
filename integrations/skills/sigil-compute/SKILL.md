---
name: sigil-compute
description: Run the claims loop on an existing Sigil 0.8 design and hand back the ingest state — Coherent, Loose, or Disjoint — with the computed findings report. Use only when the request names claims, `sigil-claims`, computed findings or checks, or this skill; a generic request to review or evaluate a design stays on `sigil-evaluate`.
---

# Computed design evaluation

Own the `sigil-claims` loop end to end: prepare the interpretation request,
delegate the reading to one fresh child, ingest the returned rows, and hand
back the ingest state plus the findings report. A generic "review this design"
request does not load this skill: advisory evaluation by `sigil-evaluate` keeps
that job, and `sigil-write` still delegates its review there.

Read the [orchestration contract](references/computed-evaluation.md) before
running the loop. It owns source selection, the captured input snapshot, the
child handoff, recognizing a completed ingest, the failure path, and the
result handoff.

The loop's interpretation is one fresh child with no inherited conversation,
loaded with the installed [understanding](../sigil-understand/SKILL.md) and
[egglog](../sigil-egglog/SKILL.md) entrypoints. `sigil-understand` is the
design-language authority, `sigil-egglog` is dialect background, and the
prepared request's guidance is binding for row shapes and accepted names. The
claims binary never reads skills and never launches a model; the child only
interprets, and this skill runs the tool.

The input is an existing Sigil 0.8 design that the tool can prepare — never a
0.7 contract, never a greenfield design to be written first. This skill does
not author, revise, or delete design files. When any step cannot finish, stop
and name the break: never name Coherent, Loose, or Disjoint without a report
that a completed ingest wrote.
