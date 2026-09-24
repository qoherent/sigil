# Slotted computed-evaluation demo

Slotted is a small room-booking product model used to demonstrate Sigil's
computed claims loop on a multi-module design. Its interfaces are ordinary
prose, the modules exchange explicit Tags, and the fixture deliberately keeps
several design mistakes so readers can see what computed findings look like.
These problems are intentional demo content; the expected gradient below is a
target, not a guarantee about fresh model interpretations.

## Module map

| Source | Responsibility | Imports |
| --- | --- | --- |
| `auth.sigil` | User identity, sign-in, sessions, and permissions | `UserProfile` from component `Profile` in `profile.sigil` |
| `profile.sigil` | Editable profile fields and public profile summaries | — |
| `booking-calendar-view.sigil` | Calendar view and its ASCII/SVG layout reference | — |
| `resource-management.sigil` | Rooms, metadata, base availability rules, and availability answers | — |
| `scheduling-and-recurrence.sigil` | Recurring patterns, dated series, exceptions, and date preview | — |
| `booking.sigil` | Booking lifecycle, permission and availability checks, cancellation | Resource Management and Scheduling and Recurrence |

`_module.sigil` describes the workspace and is exported as context. It is not a
selected source in the six-source gradient.

`auth.sigil` imports with the exact header
`@profile.sigil from Profile import { UserProfile }`. `Profile` is the
component; `UserProfile` is its Tag. This gives the import an unambiguous
component entity while preserving the public Tag name.

## Deliberate fixture problems

| Source | Deliberate content | Intended finding | A remedy |
| --- | --- | --- | --- |
| `booking.sigil` | Its interface requires a recurring booking series for repeated bookings, while a constraint says Booking must not require that series. | Contradiction | Decide whether repeated booking confirmation needs the series, then make the interface and constraint agree. |
| `booking.sigil` and `scheduling-and-recurrence.sigil` | Booking says it *exclusively owns* the recurring booking series; Scheduling and Recurrence also says it owns that series. | Ownership conflict | Keep series ownership in Scheduling and Recurrence; remove Booking's exclusive-series ownership claim. Booking can own booking requests, confirmed bookings, and cancellation records. |
| `scheduling-and-recurrence.sigil` | Its interface requires `regional time-zone rules`, but no component provides that Tag. | Unmet obligation | Add a provider for the rules or remove the requirement if the module does not need it. |
| `scheduling-and-recurrence.sigil` | A separate logic step writes a `series-date preview`, but no later step consumes that output. | Intended flow warning (`unreached-step`) | Connect the preview to a consuming step or remove the separate output and return the preview through an existing path. |

The ownership evidence is the exclusive-ownership marker in Booking's state,
Booking's declaration that it owns the recurring booking series, and Scheduling
and Recurrence's declaration that it owns the same series. The intended
ownership-conflict finding did **not** appear in either fresh computed pass.

These are demonstrations of different finding classes, not four guaranteed
findings. The actual reports below include interpretation findings as well as
the intended classes, and one intended flow finding was suppressed or absent.

## Run the claims loop

The `sigil-claims` binary does not launch a model. The host captures an export,
prepares one exact source, delegates its prepared request to one fresh
interpretation child, captures the child's data-only rows, and ingests those
same bytes. Keep run files and each private store outside `examples/slotted`.
Use a different empty private root, preparation directory, and fresh child for
each source in each pass. If the workspace already has
`.sigil/claims/interpretations`, seed that store into the private root before
prepare; never write the private results back into the workspace.

The following single-source example selects `profile.sigil`. Run it from the
repository root. This workspace has no stored interpretations, so its private
root starts empty. If a workspace has
`.sigil/claims/interpretations`, seed that store into the corresponding path
under the private root before prepare. Build the binaries first if they are
absent:

```sh
deno task build:cli
deno task build:sigilc

RUN="$(mktemp -d "${TMPDIR:-/tmp}/slotted-profile.XXXXXX")"
mkdir -p "$RUN/private-root"

sigil export design examples/slotted --root examples/slotted --format json \
  > "$RUN/frontend.json"

packages/sigilc/target/debug/sigil-claims prepare \
  --frontend "$RUN/frontend.json" \
  --source profile.sigil \
  --out "$RUN/prepared" \
  --root "$RUN/private-root"
```

Resolve the selected source from the export's `sources[].path`. For the full
gradient the exact six values are `auth.sigil`, `profile.sigil`,
`booking-calendar-view.sigil`, `resource-management.sigil`,
`scheduling-and-recurrence.sigil`, and `booking.sigil`. Do not select
`_module.sigil`.

For each prepared request, start a fresh child with no inherited conversation.
Give it `request.json`, `binding.json`, every prepared guidance file, the
installed `sigil-understand` and `sigil-egglog` skill entrypoints, and one
artifact destination such as `$RUN/child-result.egg`. The child reads the
request and guidance, then returns only the data rows in the required claims
dialect. It does not run `sigil-claims` or edit the design. The host captures
the exact artifact bytes and passes them to ingest:

```sh
packages/sigilc/target/debug/sigil-claims ingest \
  --frontend "$RUN/frontend.json" \
  --binding "$RUN/prepared/binding.json" \
  --claims "$RUN/child-result.egg" \
  --root "$RUN/private-root"
```

Repeat prepare, fresh-child interpretation, and ingest for each selected
source, using the same captured `frontend.json` and a distinct run directory
and private root each time. For a second gradient, repeat all six with new
roots and new children against the same captured export. Ingest exit `0` can
mean Coherent or Loose; exit `1` can mean Disjoint only when ingest also
returns the matching structured result and report. A bare exit code is not a
state.

A result counts only when its source, state, and version match the report; the
report's semantic export digest, guidance fingerprint, and vocabulary
generation match `binding.json`; its interpretation identity is the digest of
the exact captured artifact; and its report and judgment-context paths are
under that run's private root. These checks catch stale reports and accidental
use of the workspace store.

As a U7 command check, this `profile.sigil` example was executed from a fresh
private root with a separate fresh child. Prepare presented 21 facets with no
reused units; the child returned 2 claims and 19 readings; ingest returned
Coherent, exit `0`, and zero findings. The artifact digest and private-root
report identities matched. This single-source rehearsal is separate from the
two six-source passes below.

## Expected gradient and the two fresh runs

The target map is four clean Coherent sources, Scheduling and Recurrence Loose
with its unmet obligation and unreached-step warning, and Booking Disjoint
with the contradiction and ownership-conflict findings. It is the intended
demo shape, not stable model behavior.

The two complete fresh passes used the same captured export
(`815cf3e13bf95d24f895dad8fa668c068f22d2dfd71f4f1a6a3b5775e8d13d36`; raw
frontend SHA-256 `32fa4b1c0113c76ac69579583e2bcc67f3b9c4e52ef741683e295273e2a32428`),
source-byte manifest SHA-256
`eeec092cd614f550c3ee21d62f52abc454b3077421b453fb3718c654ee38b1c2`, separate
initially empty private roots, and a fresh child for every source. The workspace
had no interpretation store to seed.
Every prepare reported zero reused units. The host limits were
instruction-only: each child was told to read only its prepared request,
binding, guidance, and required skill entrypoints, and write only its assigned
artifact. No OS-level read-only sandbox was enforced.

| Selected source | Target state / exit; intended findings | Pass 1: state / exit; actual finding classes | Pass 2: state / exit; actual finding classes | Prepared facets, each pass / reused |
| --- | --- | --- | --- | ---: |
| `auth.sigil` | Coherent / 0; none | Coherent / 0; none | Coherent / 0; none | 43 / 0 |
| `profile.sigil` | Coherent / 0; none | Coherent / 0; none | Coherent / 0; none | 21 / 0 |
| `booking-calendar-view.sigil` | Coherent / 0; none | Coherent / 0; none | Coherent / 0; none | 27 / 0 |
| `resource-management.sigil` | Coherent / 0; none | Coherent / 0; none | Coherent / 0; none | 17 / 0 |
| `scheduling-and-recurrence.sigil` | Loose / 0; one unmet obligation and one unreached step | Loose / 0; 1 unmet-obligation, 2 interpretation, 1 flow (`suppressed-graph`) | Loose / 0; 1 unmet-obligation | 17 / 0 |
| `booking.sigil` | Disjoint / 1; contradiction and ownership conflict | Disjoint / 1; 3 contradiction, 2 unmet-obligation, 4 interpretation | Coherent / 0; none | 56 / 0 |

The renamed `Profile` component and the `UserProfile` Tag import were
unambiguous: Auth completed as Coherent with zero findings in both passes.
Booking's first report included the intended interface-versus-constraint
contradiction, but it did not report the ownership conflict. Its second report
was Coherent with no findings, so neither intended Booking problem appeared.
The first Scheduling report emitted a `flow` / `suppressed-graph` finding
because another row in that logic flow had a defect; it did not emit the
intended `unreached-step`. The second reported only the unmet obligation. The
extra interpretation findings in pass 1 are also part of the observed result;
they were not silently removed from the counts.

The complete run records, including the per-artifact BLAKE3 identities and
matched reports, remain outside the repository under
`/tmp/sigil-u5-slotted-profile-r2/`. The source manifest and ingest identity
checks were verified for every counted result.

### Earlier attempts before the `Profile` rename

Two earlier attempts used the old `UserProfile` component label, before the
import was changed to `Profile` plus its `UserProfile` Tag. They are historical
and are not the paired results above. The first attempt was incomplete:
Auth's artifact was refused because `UserProfile` matched both a component and
a Tag, and the calendar child did not complete. Those failures have no state.
Among its valid results, User-profile and Resource Management were Coherent,
Scheduling was Loose with one unmet-obligation, and Booking was Disjoint with
three contradiction and one unmet-obligation findings. The second attempt
completed all six: Auth, User-profile, calendar, and Resource Management were
Coherent; Scheduling was Loose with one unmet-obligation; Booking was
Coherent. The old Booking Disjoint-to-Coherent difference also showed model
variance, but the pair was not two complete gradients. The distinct component
name fixes the Auth ambiguity in the current runs.

## Remedies and the expected return state

The current files preserve the problems so readers can rerun the demo. To
explore a repaired design, make the corrections in a scratch copy:

1. Reconcile Booking's interface and constraint about requiring a recurring
   series. This removes the contradictory pair.
2. Make Scheduling and Recurrence the sole owner of recurring booking series;
   keep Booking ownership on its booking records. This removes the exclusive
   ownership conflict.
3. Provide `regional time-zone rules` or remove that interface obligation.
   This removes the unmet obligation.
4. Connect the series-date preview to a consumer or remove the dangling step.
   This removes the intended unreached-step condition.

If those are the only defects, the repaired selected sources should return to
Coherent with no findings. The computed model may also surface other
interpretation findings, so verify the repaired snapshot instead of treating
that state as guaranteed. No repaired variant is committed.

## Computed claims and advisory review

Computed evaluation and `sigil-evaluate` answer different questions. The claims
loop returns a source-scoped Coherent, Loose, or Disjoint state, structured
findings, and a gate exit code. A separate whole-design `sigil-evaluate` review
reads the same captured design revision and returns advisory prose: it does not
produce a computed state or gate. Use computed evaluation to check the claims
the prepared rows express and to gate on findings; use advisory review to
assess the design's meaning, consistency, ownership, and simplifications.

The whole-design review was run after the final design edits against captured
Sigil sources whose byte hashes matched the export's source manifest. It also
included the Slotted workspace config, calendar SVG, implementation plan, and
the user's final design direction as review context. The capture contained 11
inputs; its seven Sigil-source hashes, config, and workspace membership matched
the final files. `sigil check` and the six-source `sigil fmt --check` both
passed without diagnostics, and all formatted files were unchanged.

The fresh advisory review returned four design-choice findings:

- **Scheduling and Recurrence — time-zone basis (medium).** The pattern uses a
  local start time and needs regional time-zone rules, but the design does not
  say whose region defines that time or how the rules enter the module. Choose
  the time-zone basis and state its input when resolving this fixture.
- **Scheduling and Recurrence — series-date preview (medium).** Logic builds a
  preview for the booking form, but the interface does not expose it and no
  reviewed consumer receives it. Return it through the public contract and
  consume it, or remove/give the step another consumer when repairing the
  fixture.
- **Booking — repeated-series contradiction (high).** The interface requires a
  series to confirm each repeated booking, while a constraint forbids that
  requirement. Decide whether the series is required and align both statements.
- **Booking / Scheduling and Recurrence — series ownership (high).** Booking
  claims exclusive ownership, Scheduling and Recurrence also claims ownership,
  and Slotted assigns the series to Scheduling and Recurrence. Keep the
  ownership conflict as fixture content; for a product contract, remove
  Booking's exclusive-ownership claim.

All four findings are marked `design_choice`, matching the plan's deliberate
fixtures. The reviewer returned advice, not a computed state or gate. Its
read-only restriction was instruction-only: the host had unrestricted
filesystem access. It wrote only the external report and verified source/config
hashes and membership unchanged. The review was design-only; it ran no claims
loop or tests and did not assess implementation conformance or runtime
behavior. It records the semantic export digest supplied in its request rather
than independently recomputing that digest; the U5 claims results separately
matched their bindings to that digest and matched the captured source bytes.
Per-file authoring reviews are not a substitute for this whole-design
comparison.

## What the runs show

The current two complete passes diverged from the expected gradient and from
each other: Booking changed from Disjoint to Coherent, while Scheduling kept a
Loose state but changed its findings. Four clean sources agreed across both
passes. The earlier pre-rename attempts diverged too, and their first attempt
was incomplete. These results support describing the intended states as
expected behavior only. Fresh model interpretations may change wording,
findings, and states; no future run is guaranteed to reproduce this gradient.
