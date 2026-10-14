## Review report

**protocol:** `sigil-design-review/v1`  
**status:** `complete`  
**scope:** The whole Slotted design: all seven sources under the requested source root. Read-only advisory design review against the supplied intent; design-only.  
**source_root:** `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root`

**assessed_inputs:** Captured hashes were checked against `request.json`; all matched. These are the exact inputs assessed:

| Role | Original path | Captured path | SHA-256 |
|---|---|---|---|
| context | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/.sigil/config.json` | `capture/root/.sigil/config.json` | `4c15018dd9de41cb7017920342b20b2d5ddd8ee428804c8dda1d519237d320b5` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/availability.sigil` | `capture/root/availability.sigil` | `3833c3b8d364763d8fa86bb3637da4d5534fe9593d28c9a9b3814b3bfa629158` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/booking.sigil` | `capture/root/booking.sigil` | `71013e1118c7a72e335080e5d7f201a123cf8a2d365e04149fac24becd886b18` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/calendar.sigil` | `capture/root/calendar.sigil` | `03cf7040ff52f356be9b44700fc930493aeb4f81030af5c426ced05c0a662fa5` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/identity.sigil` | `capture/root/identity.sigil` | `8cce3df6aecf395bc6f42a98ceece4d707dd895d8c9847ae0b353933b9aa3862` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/rooms.sigil` | `capture/root/rooms.sigil` | `c230a63ce7fcede4cf4c52b6534ac617e42537e430b8c39ab02bb189acf0df25` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/shared.sigil` | `capture/root/shared.sigil` | `0c3d6c5891a96e931ee928f92b34e170a0c77ca104e5f1d94f17aa43503dc98e` |
| draft | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root/slotted.sigil` | `capture/root/slotted.sigil` | `da892e9a74766c547b369aa754d170f1d78e46cd7cf4cbced858c11574b5439e` |
| intent | `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/inputs/slotted-intent.md` | `capture/intent.md` | `e5d8ed074dcf0cbf53dac2e46265e6d9be16f57db2ef733c7623751e4f3855b9` |

**authority:** Staged evaluator skill `0.1.0`, SHA-256 `d4d5be45c4e6802ab923ae19e298bf2464984ea9bb420b906f2778ed86439892`; staged understanding pack `0.1.0`, SHA-256 `e5b53d4287308b2ab6fe5d3fca286948a839a455c71a3beb282edee09fdce2ea`. Language pack manifest SHA-256 `2d9dd4384bc8f2f23d0792783b618f43ca2b027c9c993d5fd63a94ff9073616e`; normative reference SHA-256 `10d92b10b7aed7e687c59a78e86170e627d0880b7e593fbc7d26442bead0b257`; grammar SHA-256 `17562a5440c5034e0259d9820b0fc7294df89fbccfbd35c718f2760e81ce58a9`. I also read the staged understanding guidance, Sigil language guide, configuration guidance, and review-contract references.

**findings:**

1. **ID:** `SLT-1`  
   **Location:** `booking.sigil`, constraints lines 138–139 and interface lines 254–255.  
   **Evidence:** The constraint says “Booking must not provide a range change of a pending request”; the interface says “Booking provides a renter a *range change* of their own pending request, and the request stays Pending with its new range.”  
   **Consequence:** The design promises and forbids the same operation, leaving the renter’s ability to amend a pending request unresolved.  
   **Priority:** `medium`  
   **Suggestion:** Decide whether pending requests are immutable or may be amended, then align the interface and constraint with that choice.  
   **Disposition:** `design_choice`  
   **Authorizing commitment:** `null`

2. **ID:** `SLT-2`  
   **Location:** `rooms.sigil`, state line 16 and constraints lines 40–44; `booking.sigil`, constraints lines 129–131.  
   **Evidence:** Rooms says “Rooms owns the archived room mark” and exposes archive/unarchive mutations through its transactional entry. Booking says “Booking owns the archived room mark, and Booking is the only one that may set or clear it.”  
   **Consequence:** Rooms and Booking both claim ownership of the archived-room state, while the design assigns its mutations through different module boundaries.  
   **Priority:** `high`  
   **Suggestion:** Decide which module owns the archived-room mark and its mutations, then make the state and transactional-entry commitments consistent.  
   **Disposition:** `design_choice`  
   **Authorizing commitment:** `null`

3. **ID:** `SLT-3`  
   **Location:** `calendar.sigil`, imports lines 1–15 and constraints lines 62–64; `identity.sigil`, state lines 7–12 and interface lines 46–56.  
   **Evidence:** Calendar requires “the *renter display name* of each renter from Identity” for owner views, but it imports no Tag from Identity. Identity’s shown state and interface describe accounts, sessions, and signed-in-user resolution; they do not promise a renter display name.  
   **Consequence:** The owner-view name label lacks a defined Identity-provided value and provider interface. The Tag rules require an imported provider Tag to be evidenced by the provider’s Interface.  
   **Priority:** `medium`  
   **Suggestion:** Decide what renter label the owner view uses. If it is a display name from Identity, define and expose that Identity-owned value in Identity’s Interface and import it in Calendar.  
   **Disposition:** `design_choice`  
   **Authorizing commitment:** `null`

**coverage:** Reviewed all seven requested components, the workspace configuration, and supplied intent. Assessed ownership and transactional boundaries; booking submission, approval, cancellation, availability edits, and archive workflows; shared time and range rules; Calendar projections and visibility; and the app’s stated module dependencies. Tag and import meaning was assessed using the staged Sigil 0.9.0 references. No implementation sources were in scope.

**limitations:**

- Mechanical validation is unavailable as instructed: the `sigil` CLI was not probed or run. No `check` or `fmt --check` command, exit status, or diagnostics are available for this captured revision.
- The review was read-only. The host sandbox restricted filesystem access to this run’s pass directory, and no files were written.