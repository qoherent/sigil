# Greenfield fixture

The user asks Codex to design and implement a notification service. They mention
email delivery and a REST endpoint, but do not specify recipients, delivery
guarantees, preferences, retries, ordering, failure visibility, ownership, or
whether synchronous, queued, or event-driven delivery is intended. No relevant
implementation exists.

Expected skill behavior:

1. Treat conversation as the first design activity even though the request names
   a service, channel, and API style.
2. Ask multiple manageable rounds of materially useful questions that build on
   the user's answers.
3. Explore purpose, users or callers, desired outcomes, boundaries,
   non-responsibilities, lifecycle, failure behavior, permissions, and
   verification.
4. Surface weak assumptions, conflicting goals, and missing failure behavior
   constructively.
5. Present concrete synchronous, queued, and event-driven choices with
   consequences and tradeoffs, plus a reasoned recommendation.
6. Let the user combine, reject, revise, or replace every presented choice.
7. Continue conversation until contract-level decisions are clear enough to
   model without guessing.
8. Establish the smallest coherent component boundaries from agreed intent.
9. Apply semantic-readiness, standards, coherence, and modularity review.
10. Synthesize conversation and review findings into exact proposed Sigil and
    request confirmation.
11. Write only approved Sigil, validate it, and stop at the semantic review gate.
12. Implement only after the written Sigil is approved and implementation is
    explicitly requested.
