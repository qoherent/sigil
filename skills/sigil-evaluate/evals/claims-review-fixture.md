# Claims review comparison fixture

This fixture compares advisory review from computed claims with the
source-only evaluator it replaces. It measures what each judge actually read
and found. It is not itself an observed result; the repository record is
`docs/skill-evaluation/claims-guided-review.md`.

## Inputs

- **Slotted:** the seven sources and `.sigil/config.json` of the retained
  Slotted benchmark workspace, with the planted problems its benchmark report
  lists. Intent: "Slotted is a room-booking design: people own rooms and rent
  other people's rooms, with owner approval of requests. SharedKernel is a
  kernel rather than a module."
- **Bounded cases:** the inputs of the
  [computed claims cases](design-review-fixture.md) (Tag reuse, an omitted
  promise, simplification, and an undecided policy).

## Runner setup

1. Retain the evaluator skill tree from before the claims-guided change and the
   current tree as two catalogs outside source discovery, with their commit
   identities and file hashes. Changing guidance during the comparison makes a
   new catalog; record which runs used which.
2. Run every judge with the same host, model, and reasoning effort, as a fresh
   delegated evaluator with a read-only sandbox and the same prompt. Give both
   sides the same captured sources and intent under the review contract. Give
   the claims side the frozen review bundle under `computed_evidence` as well,
   prepared by a separate review preparation run so its cost is counted apart.
   Make the `sigil` CLI unavailable to both, so neither spends turns on it.
3. Prepare computed evidence three ways and record each: cold (no stored
   readings), unchanged (seeded from the cold run), and edited.
4. Record per run: host input, cached input and output tokens from the host's
   own usage records, counting a cumulative counter once; reader children's
   usage separately; the number of model turns; elapsed time; every command;
   the final report; and every planted problem or bounded-case outcome it
   reports.

## Comparisons

- **Slotted:** three matched pairs on the same design revision.
- **Bounded cases:** one matched pair.
- **Computation:** the reader count and usage of the cold, unchanged and edited
  preparations.

## Acceptance notes for the observer

- Count a pair only when both runs completed with a report. Keep failed and
  incomplete runs in the record without counting them as savings.
- The token criterion passes only when the claims side's aggregate judge input,
  including every lookup, is lower than the source-only side's on complete
  pairs. Missing usage records leave it unverified.
- Quality is kept when the claims side reports every planted problem the
  source-only side reports, adds no unsupported Tag, deletes no independent
  promise, and leaves the undecided policy to the human.
- Report runtime as measured. A smaller view does not by itself mean a cheaper
  review: a judge's input grows with every model turn.
