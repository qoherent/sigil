```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* as search text and return *search results* as matching records.
  }
}
```
```sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }

  constraints {
    Only the active request may publish search results.
  }

  interface {
    Display search results for the current search.
  }
}
```
```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }

  constraints {
    Only the active request may publish results.
    Cancelling a request immediately makes it inactive.
  }

  cases {
    A cancelled request completes after its replacement starts;
    the cancelled request may publish its results.
  }

  interface {
    Publish matching records for the active request.
  }
}
```
```sigil
component AccountService {
  goal {
    Own account-status changes.
  }

  constraints {
    AccountService is the sole final authority for the stored account status.
  }

  interface {
    Set the account's status in the shared account-status store.
  }
}

component AccountConsole {
  goal {
    Let operators manage account status.
  }

  constraints {
    AccountConsole is the sole final authority for the stored account status.
  }

  interface {
    Set the same account's status in the shared account-status store.
  }
}
```
```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }

  constraints {
    Only the active request may publish new results.
    An inactive request must never publish new results.
    A response from a request that is no longer active cannot publish new results.
  }

  interface {
    Display matching records.
    Starting a new request preserves the already displayed results until its replacement is ready.
  }
}
```
```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }

  constraints {
    Delete expired exports according to the adopted [retention policy](../policy/retention.md).
  }

  interface {
    Let an authorized user download a retained export.
  }
}
```

## Computed claims cases

These cases exercise review from computed claims. Materialize the inputs below
under a fresh workspace with a `.sigil/config.json` that includes `**/*.sigil`,
and record that the runner added it. Retain the evaluator skill tree before the
claims-guided change as the baseline for the
[claims review comparison](claims-review-fixture.md).

### Input: `identity.sigil`

```sigil
component Identity {
  goal {
    Know which *signed-in user* makes each request.
  }
  constraints {
    Identity never tells a caller who is acting when no signed-in user exists.
  }
  interface {
    Identity provides the signed-in user of a request, read from its session
    cookie.
  }
}
```

### Input: `booking.sigil`

```sigil
@identity.sigil from Identity import { signed-in user }

component Booking {
  goal {
    Let the signed-in user hold a *booking* of a room.
  }
  constraints {
    Booking never changes the range of a *pending booking*.

    A pending booking never overlaps a *confirmed booking*. Cancelling a
    pending booking releases its range at once.

    A pending booking must not overlap any confirmed booking.
  }
  interface {
    Booking lets the current user change the range of their own pending
    booking.
  }
}
```

### Input: `intent.md`

```text
Booking lets signed-in users hold rooms. A pending booking must never overlap a
confirmed one, and cancelling a pending booking frees its range immediately.
Whether a renter may change the range of a pending booking is not decided yet.
```

### Request C1 given to a fresh evaluator

Use `$sigil-evaluate` to review `booking.sigil` and `identity.sigil` read-only
against `intent.md`. No review bundle is supplied.

### Request C2 given to a fresh evaluator

A delegated review request under the review contract, with `computed_evidence`
naming a bundle the runner prepared with `sigil-compute-design` review
preparation and captured with every dependency. The runner then edits the
interpreter's stored reading of the second constraints Facet so it carries only
the overlap claim, recomputes, and captures again (injected; label it).

### Request C3 given to a fresh evaluator

The same delegated request as C2, but in separate variants the bundle's view
hash is wrong, the evidence file names a source digest that no captured file
has, or `sigilc` is unavailable and no bundle is supplied.

### Host events (observer only)

- C1: record every command the evaluator ran and hash every design source
  before and after; hash the workspace claims cache before and after.
- C2: record whether the evaluator launched any compute reader or check, and
  hash the capture before and after.
- C3: label each fault injected.

### Acceptance notes for the observer

- **C1:** The evaluator runs review preparation, then judges from the review
  view. Design sources are unchanged; only temporary files and the claims cache
  change. The report carries `computed_evidence` and lists each prose passage
  it read under `assessed_inputs`. The computed state is reported separately
  from the findings. Every computed finding is either cited in a finding's
  `basis` or listed under `set_aside` with a reason. Each set-aside name is
  either named as an existing Tag or called context wording.
- **C1, Tags (AE3):** "current user" is reported as the imported `signed-in
  user`, to be referenced. "Session cookie" is the object of Identity's
  interface promise, so it is proposed as one Identity Tag, never a Booking Tag.
  `range` is the object of Booking's range and cancellation promises, so it is
  proposed as one Booking Tag (or a `design_choice` if its owner is unclear),
  not dismissed as ordinary wording. "Who is acting" is left as prose with no
  finding. No finding asks for a Tag on context wording.
- **C1, policy (AE6):** The interface's range change and the constraint
  forbidding it are reported as a `design_choice`, citing both texts and the
  undecided intent. No `determined_correction` deletes either promise. A
  variant that keeps only a Decisions note on the question is reported as
  holding no promise on either side, never as keeping the open policy.
- **C1, simplification (AE5):** The two overlap rules may be merged as a
  `determined_correction` or a low-priority suggestion, and the suggestion
  keeps the separate promise that cancelling releases the range at once.
- **C2 (AE4):** No compute reader or check runs and the capture is unchanged.
  The evaluator reads the second constraints Facet's prose, finds the
  cancellation promise the claims miss, and reports it as an interpretation
  limit or a kept promise, never as an absent commitment.
- **C3:** Each fault leaves computed coverage unavailable with its reason, and
  the evaluator continues a source-grounded review. It never rebuilds claims or
  loads the full judgment context in place of the view, and never claims a
  token saving.
