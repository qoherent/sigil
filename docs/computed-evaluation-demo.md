# Slotted computed-evaluation demo

Slotted is a room-booking design used to demonstrate Sigil's computed claims
loop. The benchmark owns the current seven-source fixture, its four planted
problems, the target state gradient, and the evidence anchors in
[`scripts/slotted-benchmark/fixture.ts`](../scripts/slotted-benchmark/fixture.ts).
The design files are in [`examples/slotted/`](../examples/slotted/). Keep the
planted problems in the fixture when comparing interpretations.

## Run the current benchmark

Build the two local tools, then select one or more coding-agent/model combinations
and a positive pass count. Replace `MODEL` with a model selector available in
each installed agent. The runner starts a fresh child for each source attempt
and keeps an isolated claims store per attempt.

```sh
deno task build:cli
deno task build:sigilc
deno task slotted-benchmark run --agent claude:MODEL --agent codex:MODEL --agent pi:PROVIDER/MODEL --passes 3
```

Use `--out DIR` to name the batch directory and `--timeout-ms N` to set a
per-attempt timeout. The default output is a new directory under
`analyze-demo/slotted-runs/benchmarks/`, which Git ignores. The command prints
its report path and completion counts. The directory keeps the captured export,
fixture check, prepared requests, exact child rows, raw agent events, native
reports, and one record for every scheduled attempt, including failures.

Rebuild a report from saved evidence without starting any agent:

```sh
deno task slotted-benchmark report analyze-demo/slotted-runs/benchmarks/BATCH_DIRECTORY
```

The report has a run table and an agent/model/source comparison table. It shows
planted-problem detection, additional findings for review, and differences in
Facet rows across repeated valid runs as separate views. It does not assign an
overall rank. A requested model is labeled unverified when the host supplies no
served-model identity.

The two-pass results below are historical observations from the manual workflow.
They used earlier guidance and mixed or restarted model calls, so they are not
an agent/model benchmark result. The fixture and current report are the authority
for new comparisons.

## Two full runs against one export

Both gradients used one export and separate empty private roots. Every source
gets a fresh child in each pass. The export has 7 sources and 534 resolved
references.

- Semantic export digest: `28c0807eb0580274f6c08ba2daebbb2201c499ce11677dcd0a8add28f0fa8bd4`
- Raw export SHA-256: `71aae38d7cd1e5f5e9ce1498573da427dd8b178d161eae2421381cfd818b66eb`
- Source-byte manifest SHA-256: `615b2a656166f6e4ee0d15e4ddb9fb2defa8c77e2f007cdfe6b62a99b7ccb916`
- Guidance fingerprint: `f86262b80a4dd32a29df56a69e3aa234635b7f9f6fd164f28d9c15735ebd404f`

The seven source files matched the manifest before both passes. Every prepare
reused zero units. All 14 counted results passed the native identity checks
used for that historical run.

Limits of this run:

1. The host limits were instruction-only. Each child was told to read only its
   prepared files and the two skill folders, and write only its own artifact.
   No operating system sandbox was enforced.
2. Children ran on two models: Qwen3.8 and xai/grok-4.7. The grok children
   failed with a 403 (credits exhausted) after partial progress; the affected
   sources were restarted with Qwen3.8.
3. One child (calendar pass 2) timed out after its artifact was complete;
   the artifact was ingested as-is.

| Source | Target | Pass 1 | Pass 2 | Facets presented |
| --- | --- | --- | --- | ---: |
| `slotted.sigil` | Coherent / 0 | Loose / 0, 1 unmet-obligation, 3 interpretation, 3 flow | Loose / 0, 3 unmet-obligation, 8 interpretation, 2 flow | 169 |
| `identity.sigil` | Coherent / 0 | Loose / 0, 1 flow | Loose / 0, 1 flow | 16 |
| `rooms.sigil` | Coherent / 0 | Loose / 0, 2 unmet-obligation, 5 interpretation | Loose / 0, 1 unmet-obligation, 1 interpretation, 4 flow | 40 |
| `shared.sigil` | Coherent / 0 | Loose / 0, 1 flow | Loose / 0, 2 flow | 18 |
| `availability.sigil` | Coherent / 0 | Loose / 0, 3 interpretation, 7 flow | Loose / 0, 6 flow | 81 |
| `calendar.sigil` | Loose / 0, unmet-obligation and unreached-step | Loose / 0, 3 unmet-obligation, 3 interpretation, 13 flow | Loose / 0, 2 unmet-obligation, 2 interpretation, 1 flow | 170 |
| `booking.sigil` | Disjoint / 1, contradiction and ownership conflict | Disjoint / 1, 9 contradiction, 2 ownership-conflict, 12 unmet-obligation, 20 interpretation, 27 flow | Disjoint / 1, 3 contradiction, 2 ownership-conflict, 3 unmet-obligation, 3 interpretation, 39 flow | 145 |

What the two runs show:

1. **All four planted problems appeared in both passes.** Booking was
   Disjoint with the contradiction (9 and 3 findings) and the ownership
   conflict (2 findings in both passes). Calendar was Loose with unmet
   obligations (3 and 2) and flow findings (13 and 1).
2. **Identity is reproducible.** Both passes report exactly one flow finding
   (step-negated-action), matching each other and the eighth run.
3. **Flow findings dominate the warning count.** Booking has 27 and 39, and
   availability has 7 and 6. Children write flow rows for steps that the
   prose describes but does not fully ground in the design's entities.
4. **Interpretation findings vary between passes.** Slotted reports 3 and 8,
   rooms 5 and 1. The model reads the same prose differently on each fresh run.
5. **No source reached Coherent in either pass.** Identity came closest with
   a single flow finding in both passes.

No future run is guaranteed to match any of this.

### Earlier runs

Eight earlier pairs of gradients ran on the same export under older guidance or
an older design. `analyze-demo/slotted-runs/DIAGNOSIS.md` holds the analysis of
why each changed. Each cell is pass 1 / pass 2.

| Source | Old guidance | Corrected naming rule | Four fixes | End declared by the prose | Booking says "and commits" | Guard and refusal examples | Eighth run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `slotted.sigil` | Coherent / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `identity.sigil` | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent | Loose / Loose |
| `rooms.sigil` | Coherent / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `shared.sigil` | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Coherent |
| `availability.sigil` | Coherent / Coherent | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `calendar.sigil` | Loose / Loose | Loose / Disjoint | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `booking.sigil` | Disjoint / Coherent | Disjoint / Disjoint | Disjoint / Disjoint | Disjoint / Disjoint | Disjoint / Disjoint | Disjoint / Disjoint | Disjoint / Disjoint |

The guidance fingerprints were `29f869c7…`, `21f7aa54…`, `a0ce1299…`,
`fbe42d67…` (twice), `b100d025…`, and `3bb9b9f0…`. The first run said a claim
could only name an asterisk-marked Tag, which cannot be done for an existing
Tag, and booking's planted problems came out in one pass of two. The third
changed four readings: a Tag is never the subject of "requires", "the only one
that may" writes an exclusive property, a rejection ends a flow, and a scoped
exception is not a global ban. The fourth changed the rule for flow ends: an
end is declared by the prose, never by position, and a commit counts as an end.
The design then changed once, in the sixth run, when Booking's timezone and
unarchive sentences were given "and commits". The seventh run added two
examples, a guard row and a refusal rule as a reading. The eighth run changed
the design again, to resolve the six unplanted review findings and Slotted's
dependency gap, and added a guidance rule that a name on the entity list is not
grounded by being listed. The ninth run (this one) changed the guidance again:
finding classes were renamed from `unguarded-flow` to `flow`, `ungrounded-claim`
to `interpretation`, and `uninterpreted-section` was retired; the guidance
fingerprint is `f86262b8…`.

The run records stay outside the repository, except the copies in
`analyze-demo/slotted-runs/`, which are ignored by git.

## Interpreting the historical results

The tool-owned fixture names the intended remedies and target state gradient.
The historical tables above show what earlier interpretations returned, rather
than a guarantee that a future model will reach those targets. Review the saved
rows and cited findings in each new benchmark report before making a claim
about an agent or model.

## Computed evaluation and advisory review

The two tools answer different questions.

- **Computed evaluation** (`sigilc`) gives a Coherent, Loose, or Disjoint
  state for one source, structured findings, and an exit code you can gate on.
- **Advisory review** (`sigil-evaluate`) reads the design and returns prose. It
  gives no state and no gate.

Use the computed loop to gate on the claims the prose expresses. Use advisory
review to judge meaning, ownership, and consistency across the whole design.

A separate fresh `sigil-evaluate` reviewer read the same seven files, byte for
byte the ones the two gradients above used. It checked the digests of all seven
files before assessing. The review was design-only. It ran no tooling and did
not look at the claims results. Its read-only limit was instruction-only. It
returned eight findings. Four are the deliberate problems:

- **Contradiction (high).** The Booking interface offers a range change and a
  constraint forbids it.
- **Ownership (high).** Rooms and Booking both claim the archived room mark. The
  reviewer called this a determined correction toward Rooms owning the mark. It
  is kept as authored, because it is a deliberate fixture problem.
- **Unmet obligation (high).** Calendar requires a display name from Identity.
  Identity has none, and the dependency list omits Calendar on Identity.
- **Dead-end step (high).** The owner digest step needs a stored previous
  digest, but Calendar is forbidden to store data, and nothing uses the digest.

The other four are real questions about the design that nobody planted:

- **Open bookings read (medium).** Booking's read of a room's bookings has no
  stated audience, so Calendar's masking can be bypassed.
- **Fall-back hour (medium).** SharedKernel never says what the repeated hour
  yields. The reviewer suggests one conversion case, mirroring the
  spring-forward one.
- **Transactional entry (low).** One Tag, owned by Rooms, names the pattern and
  also stands for Availability's entry. The reviewer calls the current form
  workable.
- **Repetition (low).** Several rules are stated twice across Booking, Slotted,
  and Identity.

The six unplanted findings from the earlier review (the room lock's audience,
the fall-back wording in Calendar, compare-and-set on non-status mutations, the
withdrawal case, the repeated 180-day number, and Slotted's plain-word Tags)
were fixed in the design, and this review did not raise them again. The four
above were left, because each is a policy choice for whoever owns the design.

The advisory reviewer names the deliberate problems in prose. The computed loop
found all four in both passes, with a state and an exit code, but it also
reported many warnings that the reviewer did not. Neither replaces the other.
