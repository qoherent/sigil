# Codex Anchor Proposal Workflow

**Status:** Proposed
**Owner:** _TBD_
**Last updated:** 2026-07-13

This integration will provide the first model-assisted host for ADR-010.

The future skill must use deterministic `sigil anchors candidates` output,
delegate only bounded component-local batches, require structured proposal
outcomes, validate targets, and stop for explicit approval before applying any
anchor.

Subagents are proposal workers. They do not modify Sigil, source code, proposal
artifacts, or `.sigil/anchors.json`. The primary agent reconciles overlapping
results and owns the user review gate.

The proposal schema remains host-neutral so another agent host can produce the
same input for deterministic validation and persistence.

Implementation is blocked until ADR-010 and the colocated Sigil contract are
approved.
