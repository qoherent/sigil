# Problem Statement: AI-Assisted Development Adoption

**Status:** Draft
**Owner:** _TBD_
**Last updated:** 2026-07-06

---

## 1. Context

Our organization has adopted AI coding assistants (Claude Code, Codex, Copilot, etc.) across development teams. These tools have effectively solved the "writing code" bottleneck — developers can generate working code faster than before.

However, this shift has introduced a new set of systemic problems that are offsetting or outweighing the expected productivity gains. This document defines those problems so we can prioritize and act on them deliberately, rather than reactively.

We operate primarily in a **brownfield codebase**: existing architecture, legacy patterns, and technical debt constrain both what AI tools can produce appropriately and how easily humans can evaluate that output against the existing system.

---

## 2. Core Problem

AI-assisted development is generating more code, faster, than our organization can afford, review, or maintain — and current usage patterns are amplifying this rather than mitigating it.

---

## 3. Sub-Problems

### 3.1 Cost / Economics
Subscription and usage spend on AI coding tools is high relative to the value being extracted. There is limited visibility into who is using these tools, how, and with what return.

### 3.2 Review Bottleneck
AI-generated code arrives in larger volumes and diff sizes than existing human review processes were designed to handle. Code review — previously a fast stage in the pipeline — has become the slowest.

### 3.3 Quality Degradation
Shipped code is often functional but lower quality: harder to read, maintain, or extend, and not always aligned with existing architectural patterns.

### 3.4 Shallow Input / Prompting Discipline
Developers frequently provide minimal context or shallow prompts to AI tools, producing correspondingly shallow, messy, or contextually inappropriate output. This may be a **root cause** of 3.3, rather than an independent problem.

### 3.5 Brownfield Constraint
Legacy code, inconsistent patterns, and technical debt make it harder for AI tools to generate contextually correct code, and harder for reviewers to judge whether AI output fits the existing system — not just whether it's "good code" in isolation.

---

## 4. Open Questions

These need answers before this problem statement can drive a concrete initiative:

1. **What is the primary goal?** Reduce cost, improve quality, increase throughput, or reduce review burden? These can conflict, and no priority is currently set.
2. **Is shallow prompting a skill gap, a motivation gap, or a missing process?** No shared standard currently exists for what "good input" to these tools looks like.
3. **What data do we have?** Current spend, review turnaround time before/after AI adoption, defect rates, PR size trends — is this qualitative impression or measured fact?
4. **Where does this problem primarily live?** Engineering process, tooling/guardrails, or incentives/culture?
5. **What is the scope?** All teams/developers, or specific ones? Is this brownfield-specific, or also present in greenfield projects?

---

## 5. Non-Goals

_(To be defined once priorities are set — e.g. this document does not yet propose banning specific tools, mandating specific prompting formats, or setting hard budget caps.)_

---

## 6. Success Metrics

_(To be defined — candidates: cost per merged PR, median review time, defect/rollback rate post-AI-adoption, developer-reported context/prompt quality.)_

---

## 7. Next Steps

- [ ] Assign an owner
- [ ] Gather baseline data (spend, review times, defect rates)
- [ ] Answer open questions in Section 4
- [ ] Convert this into an RFC/ADR once scope and priority are agreed
