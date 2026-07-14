# Sigil Codex skill

Version 1.0.0 of the standalone Sigil workflow for Codex.

The skill provides one general workflow with two focused paths: conversational
Greenfield design and initialization-first Brownfield adoption. Both produce
exact proposed Sigil and stop for semantic review before implementation.

Install it by asking Codex:

```text
Use $skill-installer to install the skill from
https://github.com/farhoud/qode/tree/skill-v1.0.0/integrations/codex/sigil-skill
```

The installer downloads the repository path into `$CODEX_HOME/skills` and the
skill becomes available on the next turn. For development, install from the
desired branch or commit instead of the release tag.

The skill requires compatible Sigil CLI and core 1.x packages, config schema
1.0.0, and Sigil Language 1.0.0. See [compatibility.json](compatibility.json).

Plugin packaging and marketplace distribution are deferred beyond v1.
