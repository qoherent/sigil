# Sigil design review

**Assessment:** Partial advisory review. I reviewed the whole Slotted design against the supplied intent. The review is revision-bound to the captures listed below.

## Assessed inputs

The seven `.sigil` sources and `.sigil/config.json` under `capture/root/` match the SHA-256 digests in `request.json`. `capture/intent.md` and all four captured computed artifacts also match their listed digests. The computed context file was inspected, but I did not use it as the review basis.

## Computed evidence

The supplied whole-workspace view reports **Disjoint**, with 103 computed findings across 194 units: 163 interpreted, 31 read without commitment, and none unread, uninterpreted, refused, or unresolved-imported. This is reported separately from my advisory findings; it does not by itself establish design coherence.

## Material findings

1. **Determined correction — pending-request range change conflicts with the stated rule.** Booking’s constraints prohibit changing a pending request’s range, and its decisions say the requested range stays as recorded. Its interface nevertheless promises renters a range change. Remove that interface promise to match the existing constraint and decision.  
   **Evidence:** `booking.sigil`, “constraints” and “decisions” versus “interface.”

2. **Determined correction — ownership of the archived-room mark conflicts.** Rooms says it owns the archived-room mark on its room; Booking also says it owns that mark and alone may set or clear it. The design already assigns archive workflows to Booking and exposes the mutation through Rooms’ transactional entry. Keep the mark in Rooms’ ownership and describe Booking as owning the workflow that invokes that entry.  
   **Evidence:** `rooms.sigil`, “state,” “constraints,” and “interface”; `booking.sigil`, “constraints” and “logic.”

3. **Design choice — Calendar promises renter names without a defined source or allowed dependency.** Calendar requires renter display names from Identity, but Identity defines accounts with email and password, exposes no renter display-name interface, and Calendar does not import Identity. Slotted’s allowed dependencies also omit Calendar → Identity. Decide what the owner-facing view should show and provide a matching data path and dependency rule.  
   **Evidence:** `calendar.sigil`, “constraints” and imports; `identity.sigil`, “state” and “interface”; `slotted.sigil`, “constraints.”

## Coverage and limitations

I read all seven source files, the config, supplied intent, and the compact computed view. The captured sources support the findings above. I did not assess implementation conformance.

Mechanical validation is **unavailable**; I did not run or search for the Sigil CLI. The staged evaluator copy is missing its referenced `design-review.md`, `mechanical-validation.md`, and `review-contract.md`; the staged language copy is also missing its referenced normative reference and grammar. I therefore could not verify the exact contract field schema or consult the bundled Sigil 0.9 authority documents, and this report uses the available evaluator-skill fields and source-grounded evidence.