## Agent-Native Architecture Review

### Summary

This change adds a host-neutral, CLI-distributed agent-skill catalog for Sigil 0.8 design work: understanding, read-only evaluation, and writing with an independently dispatched evaluator. There is no end-user application UI or embedded LLM/tool runtime in scope; the agent-facing surface is the installed skill catalog. The three capabilities are separately addressable through their skill entrypoints, their required sibling context travels in the same installed catalog, and the writing workflow explicitly captures runtime context before independent review. Overall, the changed surface maintains agent parity for the capabilities it introduces.

### Capability Map

| UI Action | Location | Agent Tool | In Prompt? | Priority | Status |
|-----------|----------|------------|------------|----------|--------|
| Explain a Sigil 0.8 design | `README.md:738`; `integrations/skills/sigil-understand/SKILL.md:1` | `$sigil-understand` | Yes (`agents/openai.yaml:4`) | Must have | Accessible |
| Review a Sigil 0.8 design read-only | `README.md:739`; `integrations/skills/sigil-evaluate/SKILL.md:1` | `$sigil-evaluate` | Yes (`agents/openai.yaml:4`) | Must have | Accessible |
| Write or revise a Sigil 0.8 design | `README.md:740`; `integrations/skills/sigil-write/SKILL.md:1` | `$sigil-write` | Yes (`agents/openai.yaml:4`) | Must have | Accessible |
| Install the shared catalog | `packages/cli/src/installer.ts:83` | `sigil skill install` | N/A (CLI action) | Should have | Accessible; installs all skills together |

### Findings

#### Critical (Must Fix)

None.

#### Warnings (Should Fix)

None.

#### Observations

None.

### What's Working Well

- The capabilities are separate skill entrypoints with explicit host prompts, so an agent can discover and invoke understanding, evaluation, and writing without routing through the legacy 0.7 workflow.
- `sigil-write` captures the draft, intent, provider/linked context, source root, and language-pack identity before dispatching a fresh evaluator; this provides runtime context rather than relying on static instructions or inherited conversation (`writing-loop.md:29-45`).
- Writer and evaluator use the same source inputs and sibling language authority. The review contract requires the evaluator to report the bytes it actually assessed and makes changed context stale (`review-contract.md:73-80`, `109-124`).
- The CLI discovers catalog entries rather than hardcoding the new skills, and installation copies or links the complete catalog into the agent's normal skill location (`installer.ts:83-159`). The release test validates all four shipped skills and validates the installed catalog (`test-cli-release.ts:81-89`).
- `deno task test:skill` passed, confirming the three-skill metadata, dependency closure, documentary links, and reproducible offline language authority.

### Score

- **3/3 high-priority capabilities are agent-accessible**
- **Verdict:** PASS
