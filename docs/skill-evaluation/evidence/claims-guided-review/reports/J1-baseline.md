## Report

**protocol:** `sigil-design-review/v1`  
**status:** `complete`  
**scope:** Whole Slotted design: all seven `.sigil` sources, workspace configuration, and supplied intent. Design-only review.  
**source_root:** `/Users/farhoud/Workspace/sigil/analyze-demo/slotted-runs/benchmarks/claims-guided-review-20261012/runs/A1-cold/pass/root`

### assessed_inputs

The captured byte hashes match the request manifest. Paths below identify the original input and its captured copy.

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

### authority

- Evaluator: staged `sigil-evaluate` 0.1.0; entrypoint SHA-256 `d4d5be45c4e6802ab923ae19e298bf2464984ea9bb420b906f2778ed86439892`.
- Language pack: staged `sigil-understand` 0.1.0; entrypoint SHA-256 `e5b53d4287308b2ab6fe5d3fca286948a839a455c71a3beb282edee09fdce2ea`.
- Sigil 0.9.0 language manifest: `skills/sigil-understand/references/language/manifest.json`, SHA-256 `2d9dd4384bc8f2f23d0792783b618f43ca2b027c9c993d5fd63a94ff9073616e`. Read the staged design-review, review-contract, mechanical-validation, understanding, language-reference, grammar, and relevant language/configuration guidance.

### findings

#### F1 — Archived-room state has conflicting owners

- **location:** `rooms.sigil` lines 16–17, 40–44; `booking.sigil` lines 129–131.
- **evidence:** Rooms says, “Rooms owns the archived room mark.” Booking says, “Booking owns the archived room mark, and Booking is the only one that may set or clear it.” Rooms also exposes archive and unarchive mutations through its transactional entry, while Booking describes workflows that call those mutations.
- **consequence:** The designs assign ownership of the same persistent room state to two components. This leaves the final owner of the archived mark and its lifecycle responsibility unclear.
- **priority:** `high`
- **suggestion:** Decide whether Rooms owns the room’s archived state while Booking owns the archive workflows, or whether Booking owns the state; align both ownership statements and the mutation contract with that decision.
- **disposition:** `design_choice`
- **authorizing_commitment:** `null`

#### F2 — Pending-request range change is both offered and prohibited

- **location:** `booking.sigil` lines 138–139, 164–171, 254–255.
- **evidence:** The constraint says Booking “must not provide a range change of a pending request”; the interface says it “provides a range change of their own pending request.” The command constraint also says commands on an existing request “take only its id,” while changing the range necessarily supplies a new range.
- **consequence:** A reader cannot determine whether a renter can change a pending request’s range, or which command inputs and state transition that capability requires.
- **priority:** `medium`
- **suggestion:** Decide whether pending requests are immutable after submission. Then remove the range-change interface promise or revise the prohibitions and specify the corresponding command contract.
- **disposition:** `design_choice`
- **authorizing_commitment:** `null`

#### F3 — Calendar requires renter display names without an allowed provider contract

- **location:** `calendar.sigil` lines 62–64; `identity.sigil` lines 7–20, 46–55; `slotted.sigil` lines 30–37.
- **evidence:** Calendar requires “the renter display name of each renter from Identity.” Identity defines accounts with email and password credentials and exposes session/sign-in operations, but no display-name field or lookup. Calendar has no Identity import. Slotted’s exact allowed module dependencies give Calendar dependencies on Booking, Availability, and Rooms, and omit Identity.
- **consequence:** The design promises owner-facing renter names without specifying a provider operation or field that supplies them. Adding the apparent provider directly would also conflict with Slotted’s stated dependency graph.
- **priority:** `medium`
- **suggestion:** Decide where renter display names come from and how Calendar obtains them. If Identity is the source, define its data and read contract and update the allowed dependency graph; otherwise specify a source available through the existing graph or revise the display-name promise.
- **disposition:** `design_choice`
- **authorizing_commitment:** `null`

### coverage

Reviewed all seven components, workspace configuration, and supplied intent. Assessed component responsibilities, ownership, interfaces, behavior, constraints, cases, imported Tag providers and their interfaces, and the stated dependency graph. Root-relative imports were interpreted against the request’s original `source_root`; the captured workspace mirrors the source layout. No linked documents were referenced by the captured design.

### limitations

- Mechanical validation is unavailable: the request states that the `sigil` CLI is not available and directs that it not be searched for. No `check` or `fmt --check` command was run; there are no mechanical diagnostics or validation results for this revision.
- This was a design-only review; implementation behavior and conformance were not assessed.
- Read-only restriction: the request prohibits edits and file-writing commands; the host sandbox is read-only, with the pass directory as the allowed read root.