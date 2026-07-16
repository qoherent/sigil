# ADR-009: Sigil Readiness And Model Boundary

**Status:** Superseded by ADR-011

**Owner:** _TBD_

**Reviewers:** _TBD_

**Last updated:** 2026-07-10

> This exploratory record is preserved for history. Its readiness boundary,
> alternatives, and experiments are consolidated into
> [ADR-011: Generated Rationale, Evidence, And Review Records](adr-011-generated-rationale-evidence-and-review-records.md).

## 1. Purpose

This document explores two connected architecture questions:

1. When does a Sigil specification contain enough information to permit
   implementation?
2. Which layer should gather missing information from users, repositories,
   models, and web research?

No option is selected in this document. The goal is to give reviewers a shared
definition of the problem, make the tradeoffs explicit, and identify the
evidence needed before the decision becomes proposed or accepted.

## 2. Context

Sigil currently distinguishes public component contracts from their operational
detail and requires human review before implementation. `sigil-core` can parse
and resolve the language, preserve semantic lines, build graph data, and produce
structural diagnostics. Host integrations can inspect code, interact with a
user, and use model or research capabilities.

Structural validity alone does not establish that a component is ready to
implement. A component can contain the required `goal` and `interface` sections
while leaving important behavior, permissions, errors, ownership, or lifecycle
rules ambiguous.

The current workflow relies on the host agent to recognize those gaps. This
creates a second question: whether semantic gap detection and information
gathering should become responsibilities of `sigil-core`, remain host-specific,
or be split across deterministic core capabilities and optional orchestration.

## 3. Candidate Sufficiency Rule

The following rule is a discussion proposal, not an accepted language rule:

> Sigil contains enough information to permit implementation when every
> remaining unknown can be decided locally during implementation without
> changing observable behavior, public contracts, ownership, security,
> persistent data, lifecycle rules, or acceptance criteria.

This rule focuses on the consequence of an unknown rather than the amount of
text in a Sigil file. A private helper name may remain unspecified. A permission
rule, destructive-data policy, public error, or externally visible state
transition may not.

### Three Different Gates

The workflow should keep three concepts separate:

- **Structural validity:** the source parses, required sections exist, imports
  resolve, and declarations are structurally consistent.
- **Semantic readiness:** no known unresolved question can materially change
  the implementation dimensions named in the sufficiency rule.
- **Human approval:** a person explicitly accepts the current Sigil as the basis
  for implementation.

Passing one gate does not imply passing the others. In particular, a model or
deterministic check cannot grant human approval.

## 4. Candidate Readiness Model

A readiness result should prefer explicit blockers and warnings over a
percentage score. A score can reward additional prose without proving that the
important decisions are present.

The following JSON is non-normative and does not define a committed API:

```json
{
  "status": "blocked",
  "riskProfile": "standard",
  "blockingGaps": [
    {
      "component": "Booking",
      "dimension": "policy",
      "question": "Who may cancel a confirmed booking?",
      "resolutionSource": "user"
    },
    {
      "component": "Auth",
      "dimension": "evidence",
      "question": "Which current security guidance constrains token storage?",
      "resolutionSource": "research"
    }
  ],
  "warnings": []
}
```

Candidate resolution sources are:

- `user`: product intent, policy, priorities, and consequential tradeoffs;
- `repository`: existing architecture, code behavior, dependencies, and local
  conventions;
- `research`: standards, regulations, compatibility facts, and current vendor
  behavior;
- `agent`: a low-risk implementation assumption that is made explicit and can
  be reviewed.

Research can establish facts, constraints, alternatives, and current external
behavior. It must not silently choose product policy or resolve a consequential
tradeoff on the user's behalf.

### Candidate Risk Profiles

Risk profiles could vary the readiness questions without changing the Sigil
language immediately:

- `low`: internal refactors, isolated utilities, and reversible changes;
- `standard`: application features, modules, APIs, and persistent workflows;
- `high`: authentication, authorization, payments, migrations, destructive
  operations, and regulated or sensitive data.

For example, a high-risk review may require explicit failure behavior,
rollback, security boundaries, observability, and researched evidence. A
low-risk review should not require those details when they do not apply.

These profile names and requirements are discussion material. They are not
public CLI options or core types yet.

## 5. Alternatives

### Option A: Give `sigil-core` Direct Model Access

`sigil-core` would configure or receive a model provider and use the model to
identify semantic gaps, ask questions, perform or request research, and propose
Sigil updates.

Potential benefits:

- one implementation could provide consistent elicitation across hosts;
- standalone CLI users could receive model-assisted guidance without depending
  on a separate host integration;
- semantic analysis could be exposed through a single package API;
- the core could coordinate repeated readiness passes directly.

Potential costs and risks:

- installation and configuration would include credentials, provider choice,
  network behavior, retries, cost, and model lifecycle;
- core operations could become nondeterministic and harder to reproduce in CI;
- offline parsing and validation would need a clearly separated execution path;
- source and specification privacy would become a core responsibility;
- model-provider behavior could influence a package intended to provide shared
  language semantics;
- users of model-capable hosts might need a second API key or pay for duplicate
  model access.

### Option B: Keep Core Deterministic And Put Elicitation In Hosts

`sigil-core` would continue to expose structural models and diagnostics. Codex,
editor agents, and other host integrations would independently inspect the
repository, ask users, search external sources, and decide whether Sigil is
ready.

Potential benefits:

- core remains offline-capable, deterministic, and simple to embed;
- each host can reuse its existing model, credentials, permissions, research
  tools, and interaction model;
- privacy and consent remain under the host that already owns user interaction;
- model-provider changes do not affect the language package.

Potential costs and risks:

- readiness behavior may drift between hosts;
- every integration may reimplement gap categories, risk policy, and workflow;
- standalone CLI users receive only structural feedback;
- semantic findings may be difficult to compare or test across hosts;
- the quality of the gate depends heavily on host instructions.

### Option C: Deterministic Core, Host Orchestration, Optional `sigil-agent`

`sigil-core` would own deterministic readiness primitives, policy inputs, and
structured gap results without invoking a model. Host integrations would use
those results to gather information. A separate optional `sigil-agent` package
could later provide standalone model orchestration through pluggable providers.

Potential benefits:

- gap vocabulary and readiness results could remain consistent across hosts;
- core parsing, structural checks, and deterministic readiness rules could run
  offline and in CI;
- model-capable hosts could reuse their existing models and tools;
- standalone users could opt into model assistance and provider configuration;
- credential, privacy, and model lifecycle concerns would remain outside the
  shared language core.

Potential costs and risks:

- the boundary between deterministic gaps and model judgment may be difficult
  to define;
- core, host integrations, and an optional agent package create more surfaces
  to design and maintain;
- hosts may still disagree when interpreting free-form semantic lines;
- standalone model assistance would arrive later than with a model-enabled
  core;
- readiness policy could over-formalize Sigil if deterministic rules expand too
  aggressively.

### Comparison

| Driver | Option A: model in core | Option B: host-only elicitation | Option C: split with optional agent |
| --- | --- | --- | --- |
| Configuration | Centralized but required by core workflows | Reuses each host's configuration | Core stays simple; optional agent adds configuration |
| API keys | Often required for core-assisted use | Reuses host credentials | Required only for standalone model assistance |
| Offline and CI use | Requires a separate non-model path | Strong for structural core checks | Strong for core checks and deterministic readiness rules |
| Determinism | Model-assisted results vary | Core is deterministic; host results vary | Core results can be deterministic; orchestration varies |
| Privacy boundary | Core handles source transmission policy | Existing host controls access and consent | Host or optional agent controls access and consent |
| Vendor coupling | Mitigated by provider abstraction, but present | Determined independently by each host | Isolated behind host or optional-agent providers |
| Standalone usability | Strongest model-assisted CLI path | Structural feedback only | Optional model-assisted path with more packaging work |
| Cross-host consistency | Potentially high | Lowest unless instructions are synchronized | Shared gap model, variable orchestration |
| Implementation complexity | Concentrated in core | Distributed across integrations | Highest number of explicit boundaries |

## 6. Candidate Workflow

The following loop could apply regardless of which option owns each step:

1. Inspect the relevant Sigil, imports, repository code, tests, and existing
   documentation.
2. Check structural validity and identify semantic readiness gaps.
3. Classify each gap by the source most appropriate to resolve it.
4. Read repository evidence before asking the user about discoverable facts.
5. Search external sources only for externally verifiable or time-sensitive
   facts.
6. Ask the user focused questions for unresolved intent, policy, ownership, or
   consequential tradeoffs.
7. Reflect answers, researched constraints, explicit assumptions, and cases
   into Sigil.
8. Reevaluate structural validity and semantic readiness.
9. Stop for explicit human review and approval.
10. Begin implementation only after approval.
11. Return to the Sigil gate if implementation reveals a material unknown.

## 7. External Precedents

These systems do not decide Sigil's architecture. They provide useful parallels
for evaluating the boundaries above.

### Model Context Protocol

The [MCP architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
assigns AI/LLM coordination, authorization, consent, and context aggregation to
the host while servers expose focused capabilities. The possible inference for
Sigil is that a host can own model orchestration while a reusable lower layer
stays focused. MCP also permits server-requested sampling, so it does not prove
that all model interaction must exist exclusively in a host.

### Language Server Protocol

The [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
separates reusable language-specific intelligence from editor-specific APIs and
communicates through a standard protocol. The possible inference for Sigil is
that shared language semantics can serve many hosts without absorbing their UI
and interaction responsibilities. LSP does not address model reasoning or
semantic readiness, so the analogy is limited.

### OpenAI Agents SDK

The [OpenAI Agents SDK model documentation](https://openai.github.io/openai-agents-js/guides/models/)
abstracts model access behind `Model` and `ModelProvider` interfaces and allows a
provider to be supplied to an agent runner. The possible inference is that
provider abstraction can keep model selection replaceable at an orchestration
boundary. It also demonstrates that provider abstraction does not remove API
key, networking, lifecycle, and model-specific configuration concerns.

## 8. Unresolved Questions

- How should a human approval be recorded and invalidated after semantic edits?
- Should readiness operate entirely through host policy, or should core expose a
  stable gap and policy model?
- Which readiness dimensions can be detected deterministically when section
  bodies remain free-form?
- How should researched evidence record its source, verification date, and
  freshness expectations?
- Should unresolved questions and evidence remain conventions inside existing
  sections or become first-class `questions` and `evidence` sections?
- How should contradictory findings from the user, repository, and external
  research be represented and resolved?
- Should risk profiles be repository configuration, command options, host
  policy, or inferred suggestions?
- What information may be sent to an external model or search provider, and who
  grants that consent?
- Can hosts produce comparable readiness results without sharing the same model
  or prompts?

## 9. Experiments

Before changing this ADR to Proposed, evaluate the alternatives through small,
reversible experiments:

1. Define a temporary gap vocabulary and apply it manually to the Promise and
   Slotted examples.
2. Test whether two host agents identify materially similar blockers from the
   same Sigil and repository context.
3. Prototype deterministic checks for a narrow set of observable gaps without
   changing the language grammar.
4. Test a host workflow that classifies gaps as user, repository, research, or
   agent-resolvable and reflects the answers into Sigil.
5. Sketch a provider-neutral standalone agent boundary and document its minimum
   credential, privacy, failure, and lifecycle configuration.
6. Compare question count, unresolved implementation decisions, reproducibility,
   and user configuration burden across the alternatives.

## 10. Exit Criteria

The ADR can advance to **Proposed** when reviewers have:

- agreed on the distinction between structural validity, semantic readiness,
  and human approval;
- accepted or replaced the candidate sufficiency rule;
- evaluated the three options against the comparison drivers;
- reviewed experiment results for at least one programming abstraction and one
  product module;
- identified the owner of model credentials, privacy consent, and research
  provenance for each viable option;
- reduced the open questions enough to state one preferred boundary and its
  consequences.

The ADR can advance to **Accepted** only after a preferred option, its package
boundary, and any public readiness contracts are explicitly approved. Until
then, this document does not authorize runtime, CLI, language, or workflow
changes.
