# Design conversation fixture

The user asks Codex to help shape a partially formed application idea. Their
description mixes product outcomes, implementation preferences, and conflicting
retention expectations. Several ownership, permission, lifecycle, failure, and
verification decisions are missing. During the conversation the user is unsure
about one architecture choice, intentionally defers a non-blocking branding
decision, and says that a long list of questions feels overwhelming.

Expected skill behavior:

1. Start in framing and identify the intended outcome, users or callers, and
   boundary before selecting implementation technology.
2. Maintain confirmed, provisionally assumed, intentionally deferred, and
   unresolved decisions in conversation context.
3. Classify unresolved decisions by their effect on purpose, boundary,
   ownership, behavior, lifecycle, architecture, risk, and verification.
4. Ask the unresolved question whose answer most strongly shapes later
   decisions.
5. Present one primary decision per turn unless the user requests a faster
   grouped review.
6. Acknowledge each answer and state its effect on the emerging contract before
   asking the next question.
7. Explain why the next decision matters and what later choices depend on it.
8. When alternatives exist, offer a small concrete set with consequences and a
   reasoned recommendation while allowing the user to replace every choice.
9. When the user is unsure, state a conservative recommendation rather than
   silently choosing a default.
10. Allow only non-blocking uncertainty to be provisionally assumed or
    intentionally deferred, with the user's knowledge.
11. Stop on a conflict, explain both incompatible ideas and their consequences,
    and resolve or retain it as blocking before advancing.
12. When the user feels overwhelmed, reduce the turn to the single most
    foundational decision and defer non-blocking topics.
13. Give compact checkpoints containing confirmed decisions, assumptions,
    deferrals, blockers, and the next decision.
14. Do not ask a confirmed decision again unless new evidence conflicts with it.
15. Synthesize exact proposed Sigil only after no unresolved decision can
    materially change the proposed contract.
16. Keep intentionally deferred decisions visible in the synthesis and wait for
    explicit approval before writing Sigil.
