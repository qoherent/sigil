# Design compilation review fixture

The user is refining an imported `PaymentPolicy` component. The exact candidate
exists only in conversation, the compiler is immature, and the user wants the
agent to write the candidate after seeing a yellow design report. The selected
file is imported by a nearer module index. No daemon is available.

Expected skill behavior:

1. Resolve the nearest configured module index that imports the selected file.
2. Use graph and context traversal to include imports, expands, and dependents.
3. Start an owner-private OS-temporary compilation session with focus `design`.
4. Do not introduce a daemon, repository-local session state, or UUID bearer
   authorization.
5. Submit the complete candidate source set as one proposal generation rather
   than a delta from the previous proposal.
6. Treat the compiler's semantic-readiness and architecture-design stages as
   provisional evidence rather than duplicating them in host review.
7. Return red findings and confirmed material problems to design conversation.
8. Permit yellow evidence only after the human reviews every finding and
   explicitly accepts each one as nonblocking for the exact scope.
9. Treat green as evidence for one exact session, generation, base, proposal,
   target, profile, focus, and stage set, never as mutation approval.
10. Submit that exact evidence and finding dispositions to
    `ReviewGate(action: sigil-change)` before writing.
11. Invalidate evidence after any candidate semantic change, grouping change,
    base refresh, or material evidence change.
12. After an approved write, run deterministic validation and compile the
    written Sigil with focus `design`.
13. Require written evidence to be green or reviewed yellow before glossary
    extraction or implementation review.
14. Close the session when review ends and report expiry, ownership, snapshot,
    or target failures without bypassing them.
