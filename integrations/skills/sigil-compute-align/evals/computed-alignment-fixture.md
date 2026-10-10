# Computed alignment fixture (instructional)

These observer scenarios define expected behavior. NONE is an observed live
pass. Follow [the runner setup](README.md); keep expectations out of agent
inputs. Each variant gets fresh inputs and host, except the explicitly paired
reuse run. Observe both store trees and every child launch.

## Base inputs

Use request: “Run the computed implementation check for this workspace and
report its bound verdict and findings.” Materialize these paths; use only actual
prepared names when producing controlled code rows.

`.sigil/config.json`:

```json
{
  "sigilVersion": "0.9.0",
  "workspace": {"name": "computed-align-fixture", "members": []},
  "files": {"include": ["**/*.sigil"], "exclude": []},
  "tools": {"sigilc": {"implementation": {"dirs": ["src"], "exclude": []}}}
}
```

`design.sigil`:

```sigil
component Booking {
  goal {
    Keep a booking request available to the caller.
  }
  interface {
    Booking owns the *booking request*.
  }
  constraints {
    A booking request lasts at most seven days.
    A booking request may be made at most 180 days ahead.
  }
}
```

`src/booking.ts`:

```typescript
export function bookingRequest(durationDays: number, leadDays: number) {
  if (durationDays > 7 || leadDays > 180) throw new Error("bound");
  return { durationDays, leadDays };
}
```

`src/log.ts`:

```typescript
export function log(message: string) { console.log(message); }
```

The base has plumbing the design does not account for. Do not require a passing
state by inventing membership. A clean variant omits log.ts; use its actual
matched final report, not a predetermined promise of Closed.

## Disjoint variant: `gate.sigil`

```sigil
component Gate {
  goal {
    Own the gate vocabulary.
  }
  interface {
    Provide a *token* on every call.
  }
  constraints {
    The gate does not provide a token.
  }
}
```

## Scenarios and observer expectations

1. **Routing.** Compare the computed request above and “Use
   $sigil-compute-align to check this implementation” with “Review this
   implementation” and “Align this implementation.” Only the first two load
   this skill; generic requests stay with advisory sigil-align. Advisory routing
   and behavior remain unchanged.
2. **Missing effective selection.** Remove implementation from both workspace
   config and local.json. No child, no preparation, no store write. Hand-back
   proposes minimal JSON with observed dirs and relevant excludes as output.
   Repeat with selection only in `.sigil/local.json`: it is effective, so proceed
   without asking to write configuration. Verify local arrays replace workspace
   arrays. An invalid existing block is left to compiler validation, not repaired.
3. **Fresh design-first run and shared store.** Start without readings. The host
   seeds both trees once outside the workspace and retains immutable seed. The
   full-design initial check, design readers and final check precede code
   prepare/children. All commands use exactly that private store. There is no
   inner reseed, second store or design write-back before final alignment success.
4. **Design gate.** Add `gate.sigil` from the variant below to obtain a matched
   Disjoint report; another variant leaves legitimate unread
   design units after exhausted re-asks. Neither starts code prepare or children.
   Align check on the same store supplies Incomplete with design-disjoint or
   design-incomplete and design findings. Inject a failure in this align check:
   it supplies no invented verdict and writes nothing back.
5. **Undesigned plumbing.** Read log.ts honestly as an element without realizes.
   Accepting the file is not a refusal. Final Drift identifies undesigned work;
   propose excluding src/log.ts OR designing its logging behavior. Configuration,
   excludes, code and design stay byte-identical. Do not force Component
   membership from filename, placement, nearby code, or an annotation.
6. **Two re-asks only.** For booking.ts supply a completed controlled artifact
   naming an unknown design target. Capture actual refusal reason; reprepare into
   fresh directories and pass reason verbatim to each fresh child. After answer
   3 still refuses, no answer 4; final Incomplete lists file and last reason. Use
   two files where one becomes valid on answer 2: only the remaining stale file
   is picked on answer 3. Unrelated files in a reprepare never launch readers.
   Repeat with empty and no-element artifacts: unread count triggers the same
   bound without expecting a Facet list or invented refusal reason.
7. **No Drift re-ask.** Admit log.ts's unmapped element and a booking reading
   leaving an unanswered promise. Gates exit 0; final Drift starts zero additional
   children. No re-ask for undesigned, unanswered, or any other Drift finding.
8. **Second run, zero children.** Complete the clean variant and allowed
   write-back, then run unchanged inputs. Full-design queue is empty; code
   prepare requests zero; neither side launches a child. Final check runs and
   hands back its matching report. A file rename with unchanged bytes may reuse
   reading; the host does not override tool freshness.
9. **Failed outer run.** After private design admission, interrupt a code child,
   remove a required skill, make delegation fail, or inject an IO exit 3. Each
   variant marks the whole run failed, with both workspace reading trees
   byte-identical to before. Also fail a design source while others continue:
   final report evidence never clears the failure flag or enables write-back.
10. **Identity and binding failure.** Edit selected code after prepare so ingest
    exits 2 with a mismatched field. No reprepare/retry. Separately replay an old
    report, change context identity, drop --store, give a malformed gate/wrong
    file path, or supply only an exit code. Each is failed, yields no fabricated
    Implementation state and writes nothing back. These are controlled replay
    scenarios unless executed through a real failing invocation.
11. **Completed Incomplete is not failed.** Exhaust legitimate refusals for one
    file while another file and design sources were admitted. A matched final
    Incomplete may write accepted readings from both trees; unread files and
    last reasons remain explicit. Compare immutable seed before copying. Modify
    one existing workspace memo concurrently: retain its changed bytes, copy
    other eligible absent/changed entries via temporary sibling and per-file
    rename, and report retained concurrent entry. Never copy report/context.
12. **Whole-file code meaning.** Add helper/state/init/test work and misleading
    @sigil annotations in one presented file. Child covers the whole source,
    no parser/annotation mappings. Separate descriptive rows from realizations;
    an element with no in-scope claim stays unmapped. Tag-only delivery supplies
    no Component membership; test-kind realizations exercise names without
    answering a production promise or becoming a second owner. Use prepared
    rows/examples/rejected, not design vocabulary/Facet admission rules.
13. **Scope and hand-back.** Add a second Component outside configured design
    roots; report lists it as outside promise scope while design loop remains
    full-workspace. Add an empty file, non-UTF-8 file, file over 1000000 bytes,
    symlink, design source in selected dirs, and a user exclude. Hand-back names
    excluded patterns/removed counts, auto-excluded design, empty/unpresentable
    files and symlinks; unpresentable remains Incomplete. Check report/context
    identities, location byte hashes, separate designState, unread/refusals and
    Drift law/claims/codeRows. No config/code/design edit is permitted.

For every scenario retain actual command exits and report payloads. Instructional
coverage does not establish live Slotted benchmark success; U14/U15 supply that
separate observed evidence at recorded model, effort and binary digest.
