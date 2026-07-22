# Sigil Codex skill

Version 0.4.0 of the standalone pre-production Sigil workflow for Codex.

The skill provides one general workflow with two focused paths: conversational
Greenfield design and initialization-first Brownfield adoption. Both discover
coherent product, programming, internal API, state-machine, and UI components,
report implementation coverage, produce exact proposed Sigil, and stop for
semantic review before implementation.

Greenfield and Brownfield clarification share a guided design-conversation
protocol. It prioritizes one primary decision per turn, acknowledges each
answer, tracks confirmed, provisionally assumed, intentionally deferred, and
unresolved decisions, surfaces conflicts before advancing, and synthesizes
Sigil only after material blockers are resolved.

Install it by asking Codex:

```text
Use $skill-installer to install the skill from
https://github.com/qoherent/sigil/tree/main/integrations/skills/sigil
```

The installer downloads the repository path into `$CODEX_HOME/skills` and the
skill becomes available on the next turn. For development, install from the
desired branch or commit instead of the release tag.

The skill requires compatible Sigil CLI and core 0.4.x packages and Sigil
0.4.0. It uses proposal-only subagent analysis for missing interface concept
identifiers when subagents are available. See
[compatibility.json](compatibility.json).

Plugin packaging and marketplace distribution are deferred beyond version 0.4.
