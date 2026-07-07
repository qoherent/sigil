# Problem Statement: AI-Assisted Development Adoption

**Status:** Draft
**Owner:** _TBD_
**Last updated:** 2026-07-07

---

## 1. Context

Our organization has adopted AI coding assistants (Claude Code, Codex, Copilot, etc.) across development teams. These tools have effectively solved the "writing code" bottleneck — developers can generate working code faster than before.

However, this shift has introduced a new set of systemic problems that are offsetting or outweighing the expected productivity gains. This document defines those problems — distinguishing **root causes** from their **downstream effects** — so we can act on the actual source of the pain rather than its symptoms.

We operate primarily in a **brownfield codebase**: existing architecture, legacy patterns, and technical debt shape how severely these problems manifest.

---

## 2. Core Problem

Long, agent-driven coding sessions produce large volumes of working code while losing the human understanding and accountability that used to travel with it. What's lost doesn't reappear later — it compounds, in code that keeps growing and in review queues that keep backing up.

---

## 3. Root Causes

### 3.1 Loss of Rationale in Long Agentic Sessions
During long coding sessions with agent tools, the *why* and *how* behind each decision gets buried and lost inside the model's long context as the session progresses. That reasoning is never captured anywhere durable — not in a document, not in a conversation too long to revisit later.

Critically, this rationale also **cannot be reconstructed afterward from the code itself** — the resulting output is too large for a human to read through and reverse-engineer the original intent from. Once a session ends, the "why" behind a large share of the codebase effectively ceases to exist anywhere accessible.

### 3.2 Erosion of Ownership & Accountability
Before LLM-assisted coding, developers typically knew their code line-by-line and felt a sense of ownership over it, often for months at a time. Now, when problems arise, responsibility is deflected onto the model rather than accepted by the developer — code is treated as disposable rather than something someone stands behind.

This is compounded by a recurring but unrealized intention: developers believe that because the current code is "worthless" or hastily produced, they will soon revisit it and rewrite it properly with better quality. In practice, this moment rarely arrives, because technical debt ("slop") accumulates exponentially — each new AI-generated addition makes the eventual cleanup larger and less tractable, so the promised rewrite keeps receding rather than happening.

These two root causes reinforce each other: if no one retains the rationale for a piece of code (3.1), it's harder for anyone to feel ownership over it (3.2) — and if no one feels accountable for it (3.2), no one is motivated to capture or preserve the rationale in the first place (3.1).

---

## 4. Downstream Effects

### 4.1 Quality Degradation
Shipped code is often functional but lower quality: harder to read, maintain, or extend, and not always aligned with existing architectural patterns. This follows directly from 3.1 and 3.2 — code produced without retained rationale or a clear owner tends to drift from intent over time, with no one positioned to catch or correct it.

### 4.2 Review Bottleneck
AI-generated code arrives in larger volumes and diff sizes than existing human review processes were designed to handle. Code review — previously a fast stage in the pipeline — has become the slowest, in part *because* reviewers have no access to the rationale (3.1) and no clearly accountable author to consult (3.2), forcing them to reconstruct context from scratch for every review.

### 4.3 Loss of System Comprehension
A measurable symptom of both root causes together: developers increasingly cannot look at a given part of the system and fully explain *why it exists*, or what its inputs and outputs are. Comprehension of the system is degrading even as the volume of code grows.

---

## 5. Amplifying Constraint: Brownfield Codebase

Legacy code, inconsistent patterns, and pre-existing technical debt make all of the above worse:
- AI tools have less reliable context to generate *contextually correct* code against.
- Reviewers must judge new output not just on its own merits but on fit with an already-inconsistent system — with less rationale available for the old code, let alone the new.
- The "exponential slop" described in 3.2 compounds on top of debt that already existed before AI tools were introduced.

This is not a new sub-problem in itself, but a multiplier on Sections 3 and 4.

---

## 6. Open Questions

These need answers before this problem statement can drive a concrete initiative:

1. **What is the primary goal?** Improve quality, increase throughput, reduce review burden, or restore ownership/accountability? These can conflict, and no priority is currently set.
2. **Is loss of rationale a tooling gap or a process gap?** Should sessions capture the "why" as they go (e.g. structured summaries, decision logs), or is the fix about keeping sessions/PRs smaller so context doesn't outgrow what a human can review?
3. **How should ownership/accountability be re-established?** Should someone be named as accountable for a given module or PR regardless of how much of it was AI-generated? Is this a process/policy question or a cultural one?
4. **What data do we have?** Review turnaround time before/after AI adoption, defect rates, PR size trends, rate of "promised rewrites" that never happen — is this qualitative impression or measured fact?
5. **Where does this problem primarily live?** Engineering process, tooling/guardrails, or incentives/culture?
6. **What is the scope?** All teams/developers, or specific ones? Is this brownfield-specific, or also present in greenfield projects?

---

## 7. Non-Goals

_(To be defined once priorities are set — e.g. this document does not yet propose banning specific tools, mandating specific prompting formats, or setting hard budget caps.)_

---

## 8. Success Metrics

_(To be defined — candidates: median review time, defect/rollback rate post-AI-adoption, % of PRs/sessions with captured rationale (why/how), % of modules with a clearly identifiable owner, rate of "we'll rewrite this later" commitments actually followed through.)_

---

## 9. Next Steps

- [ ] Assign an owner
- [ ] Gather baseline data (review times, defect rates, module ownership coverage)
- [ ] Answer open questions in Section 6
- [ ] Convert this into an RFC/ADR once scope and priority are agreed