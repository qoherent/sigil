# Design-quality benchmark

This benchmark shows whether a change to `sigil-write`, `sigil-evaluate` or the
claims laws brings designs that `sigil-write` generates closer to a known-good
design. Each benchmark pairs a requirement file with a reference design. A
**pass** has `sigil-write` author a design from the requirement file alone, and
the benchmark measures that design beside the reference. It reports separate
measures and never a single score, ranking or threshold.

The package runs on [Bun](https://bun.sh/). It shares the host runner in
[`../agent-runner`](../agent-runner) with the
[Slotted interpretation benchmark](../slotted-benchmark/README.md).

## Benchmarks

| Name                    | Requirement file                                                                                     | Reference                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `slotted-with-split`    | [`benchmarks/slotted-with-split/requirement.md`](benchmarks/slotted-with-split/requirement.md)       | [`examples/slotted`](../../examples/slotted) |
| `slotted-without-split` | [`benchmarks/slotted-without-split/requirement.md`](benchmarks/slotted-without-split/requirement.md) | [`examples/slotted`](../../examples/slotted) |

The two Slotted benchmarks differ only in whether the module split is given.
`slotted-with-split` ends with a `## Module split` section that names the seven
components, their allowed dependencies, where each mechanism lives, and one
design file per component. `slotted-without-split` is the same text without that
section, so the writer chooses the split itself. Comparing the two separates
"chose a different split" from "wrote thinner modules".

Both files keep the Slotted requirement IDs (R1–R28 and AE1–AE13), and both
benchmarks share one requirement list,
[`benchmarks/slotted/requirements.json`](benchmarks/slotted/requirements.json).
The coverage reading and the report cite those IDs.

A requirement file is exactly what the writer receives. It is its only evidence.

## Commands

```sh
cd scripts/design-benchmark
bun install
bun run main.ts --help
```

Build the binaries first; `run` gives the writer the repository's debug builds
of `sigil` and `sigilc`:

```sh
PATH="$HOME/.cargo/bin:$PATH" deno task build:sigil
PATH="$HOME/.cargo/bin:$PATH" deno task build:sigilc
```

- `run` regenerates designs for one benchmark, one or more `agent:model` pairs,
  a reasoning level and a pass count.
- `measure` scores a committed design and its stored readings without calling a
  model.
- `reread` takes new claims readings, and with `--coverage` new coverage
  readings, on stored designs.
- `report` re-measures listed batches with the current `sigilc` and writes one
  table per measure beside the reference.
- `pin-reader` pins the reader that takes every claims and coverage reading.

Evidence goes under `.benchmarks/` at the repository root, which is ignored.

## Run a batch

```sh
bun run main.ts run --benchmark slotted-with-split \
  --agent claude:MODEL [--agent codex:MODEL ...] --reasoning high --passes 3
```

`run` refuses to start when the reference is not pinned (see
[Pin the reference](#pin-the-reference)), when a writer's agent, model and
reasoning level equal the pinned reader's, when the reference readings were
taken under another law set, or when `--out` already exists. It writes:

```
.benchmarks/<benchmark>-<time>/manifest.json         what the batch ran with
.benchmarks/<benchmark>-<time>/report.md             the batch's report
.benchmarks/<benchmark>-<time>/attempts/<id>/record.json
.benchmarks/<benchmark>-<time>/attempts/<id>/design/       the writer's design
.benchmarks/<benchmark>-<time>/attempts/<id>/store/        the claims readings
.benchmarks/<benchmark>-<time>/attempts/<id>/coverage.json the coverage reading
.benchmarks/<benchmark>-<time>/attempts/<id>/evidence/     every stage's events
```

The manifest records the writers, the reasoning level, the digest of every
staged skill and of the writer's `sigil` and `sigilc`, the pinned reader, the
requirement digests, the reference's digests and the readings identity (guidance
fingerprint and vocabulary generation). `--timeout-ms` bounds one stage; the
default is one hour. `--slotted-workspace DIR` names the maintainer's Slotted
workspace, which defaults to `~/Workspace/slotted` when it exists.

Ctrl-C (or SIGTERM) cancels a batch: the active stage is recorded as
`interrupted`, the passes not started stay `pending`, and the report is still
written. A second Ctrl-C exits at once; its active record stays `running`, and
`report` shows it as `interrupted`. An interrupted pass keeps its staging
directory under the OS temp directory and names it in `stagingPath`; look at it,
then remove it by hand.

### Where a pass runs

Each pass runs in a fresh directory under the OS temp directory, outside the
repository. The writer's staging directory holds:

```
requirement.md   the benchmark's requirement file, the writer's only evidence
skills/          sigil-write, sigil-understand, sigil-evaluate,
                 sigil-compute-design and sigil-egglog, copied from skills/
bin/             sigil and sigilc, copied and first on PATH
design/          the workspace the writer authors; sigil init made its config
run/             the run directory of the review preparation
store/           the review preparation's private store
```

The prompt ([`writer.ts`](writer.ts)) tells `sigil-write` that no human is
available and that `requirement.md` is the only evidence, so it lists questions
and evidence gaps in its final message instead of waiting or searching. The
writer may start two children: `interpreter`, for the claims readings of its
review preparation, and a read-only `reviewer`, for the delegated
`sigil-evaluate` review. Its final line is
`Hand-back: written|failed, review
delegated|none`.

### Stages and statuses

A pass has four stages, each with its own status:

1. **writer**: `sigil-write` authors the design. The design, the host events and
   `run/` and `store/` are copied into the attempt whatever the outcome.
2. **readScan**: the writer's host events are scanned for forbidden reads and
   for writes outside `design/`, `run/` and `store/`; the requirement file, the
   staged skills and the binaries are hashed again; and the staging directory is
   compared with its snapshot.
3. **claims**: the pinned reader runs the evaluation benchmark's full-design
   action on a copy of the design with an empty store. The design's own
   `.sigil/claims` is never copied.
4. **coverage**: the pinned reader is given the requirement file, the
   requirement list and every Facet with its `#N` handle, and writes one JSON
   answer. The stage maps the handles to Facet ids.

A status is `pending`, `running`, `done`, `failed`, `interrupted`, `invalid` or
`unavailable`. A stage that does not finish leaves the later stages
`unavailable`, never missed, and keeps the earlier stages' evidence. A design
that does not parse is still scored structurally; its claims and coverage are
`unavailable`. A coverage reader that times out or writes no usable answer gives
a stored reading with every requirement `not read`.

### Invalid and unverified passes

A pass is `invalid` at the read scan, and is left out of the report's tables,
when:

- its host events show a read inside the sigil repository, an installed sigil
  plugin or skill directory, or the Slotted workspace;
- the requirement file, a staged skill or a staged binary changed; or
- the writer wrote outside `design/`, `run/` and `store/`: anything new or
  changed in the staging directory outside them, or a write-tool path, a shell
  redirect target, or the destination of `cp`, `mv`, `mkdir`, `touch`, `tee`,
  `rm`, `sed -i` or `apply_patch` anywhere else, including elsewhere under the
  OS temp directory.

On Claude Code the forbidden roots are also denied through `--settings`. A pass
whose host cannot show every child's reads is scored with `reads: unverified`:
always on Pi, and on Claude Code or Codex when a child session shows no tool
call. A hand-back without a delegated review is valid and shows `review: none`.

## Reread

```sh
bun run main.ts reread .benchmarks/<batch> [--coverage]
bun run main.ts reread reference [--coverage] [--out DIR]
```

Stored claims readings are keyed by the guidance fingerprint, which includes the
claims laws, so a law change leaves every stored reading unread. `reread`
retakes them with the pinned reader. On a batch it moves each attempt's old
`store/` (and with `--coverage` its `coverage.json`) into
`evidence/superseded-<time>/`, reads again, updates the manifest's readings,
reader and reference digests, and rewrites the report. The designs are not
touched. Coverage readings cite Facet ids and survive a law-only change; reread
a batch with `--coverage` when the pinned reader changed.

An attempt is reread only when its new reading finishes: the reader completes,
hands back a state rather than `failed`, and, with `--coverage`, its coverage
reading finishes too. Otherwise the attempt keeps its old store, coverage,
record and reader identity, and `reread` lists it as skipped with the reason.
Nothing is left half-replaced.

Each attempt retains the identity of its reader. If a reread stops partway
through a reader change, untouched attempts keep their old readings and reader
identity. Their claims and coverage are unavailable in comparisons with the new
reader until they are reread with `--coverage`. A reread that refreshes no
attempts leaves the batch's reader and reference identities unchanged. Rereads
also refuse a reader whose agent, model and reasoning level match a writer.

Replacing the reader pin keeps the existing reference evidence, but `run` and
`report` reject reference coverage from the previous reader. Take new reference
readings with `reread reference --coverage` before comparing new passes.

`reread reference` reads `examples/slotted` into a new reference store directory
(by default `.benchmarks/reference-slotted-<time>/`) and never writes the
committed `reference/slotted/`. It prints where it wrote and the commands that
copy the new readings in. Without `--coverage` it carries the committed coverage
reading over.

A claims reading is refused, and writes no readings, when the reader hands back
`failed` or no state, or when the store leaves units unread. Tool calls the
claims reader was refused are printed with the reading: the reader may work
around them, and the store and its hand-back decide whether the reading stands.
The pinned reader's claims orchestrator prompt is the benchmark's own
(`benchmarkClaimsPrompt`): it does not write back to the workspace store, since
the harness reads the private store. Changing either prompt changes the reader's
identity, so pin the reader again with `pin-reader --force` before `reread`.

## Pin the reference

The reference store, `reference/slotted/`, holds the pinned reader
(`reader.json`), its frozen skills (`reader-skills/`), the reference's claims
readings (`store/` and `readings.json`) and its coverage reading
(`coverage.json`). `run` takes the reader from there, never from a flag. To pin
it, or to re-pin it after a law change:

1. Choose the reader: an agent, a model and a reasoning level that no writer
   under test will use.
2. Freeze its skills and write `reader.json`:

   ```sh
   bun run main.ts pin-reader --agent claude:MODEL --reasoning high
   ```

   This copies `sigil-compute-design`, `sigil-understand` and `sigil-egglog`
   from `skills/` into `reference/slotted/reader-skills/`. Re-pinning needs
   `--force`. After a law-only change, skip this step.
3. Take the reference readings:

   ```sh
   bun run main.ts reread reference --coverage
   ```

4. Review the new store it printed, then copy it in with the commands it
   printed:

   ```sh
   rm -rf reference/slotted/store
   cp -R ../../.benchmarks/reference-slotted-<time>/store reference/slotted/store
   cp ../../.benchmarks/reference-slotted-<time>/readings.json \
     ../../.benchmarks/reference-slotted-<time>/coverage.json reference/slotted/
   ```

5. Measure the reference twice and check the two outputs are the same:

   ```sh
   bun run main.ts measure --benchmark slotted-with-split --out /tmp/m1.md
   bun run main.ts measure --benchmark slotted-with-split --out /tmp/m2.md
   cmp /tmp/m1.md /tmp/m2.md
   ```

Commit `reference/slotted/` once it is right.

## Known limits

- Whether Claude Code's deny rules reach a custom `--agents` child is not
  documented, so every pass is also scanned afterwards.
- Pi shows none of its children's tool calls, and its launch settings are
  untested live; Pi passes are always `reads: unverified`.
- Codex has no deny setting and no per-child tool lists: its children are told
  their role in the prompt, and their reads come from the rollouts.
- The scans cannot see paths a program builds at run time, files a script writes
  without naming them on its command line, or reads through a symlink outside
  every root.
- Claude Code's writer has no Edit tool; it rewrites whole files with Write.

## Measures

Each measure is reported on its own, per design and, where it has one, per
component. Components are matched to the reference's by name; components with no
match are listed separately. A pass cell shows the pass value and the pass minus
the reference. "Closer to the reference" says which direction moves a pass
toward the reference. The report prints the same sentence under each table, from
one shared definition in `report.ts`.

Structural measures come from `sigilc tree` alone. Claims measures come from
`sigilc check` over the stored readings, with the law set the guidance
fingerprint names. Requirement coverage comes from the stored coverage reading.
A design that does not parse is still measured structurally; its claims and
coverage are unavailable.

- **Components per design.** Closer to the reference: A count nearer the
  reference's. It does not say whether the split into components is right.
- **Facets per contract role.** Closer to the reference: Counts nearer the
  reference's for each component and role; fewer than the reference means a
  thinner contract. It does not say whether the Facets say what the reference's
  Facets say.
- **Components without state, logic or cases.** Closer to the reference: The
  same components as the reference, each lacking the same roles; every other
  listed component is thinner than the reference's. It does not say whether that
  component needs the role.
- **Interface Tags that nothing imports.** Closer to the reference: Counts
  nearer the reference's for each component. It does not say whether an
  unimported Tag is a promise to callers outside the design or an unused one.
- **Interface Tags with no backing Facet.** Closer to the reference: Counts
  nearer the reference's; more than the reference means more Interface Tags that
  no state, logic or constraints Facet of the component introduces or mentions.
  It does not say whether the Facets that do mention a Tag deliver what it
  promises.
- **Tag-mention coupling.** Closer to the reference: Edges and mention counts
  nearer the reference's. It does not say whether a coupling is acceptable.
- **Import fan-in and fan-out.** Closer to the reference: Fan-in and fan-out
  nearer the reference's for each component. It does not say whether the
  requirement allows a dependency.
- **Tag-sharing groups.** Closer to the reference: Group counts, group sizes and
  untagged Facets nearer the reference's for each component. It does not say
  whether a component should be split or merged.
- **Import cycles.** Closer to the reference: The same cycles as the reference;
  each other cycle is further from it. It does not say whether a cycle is
  harmful.
- **Tag-mention cycles.** Closer to the reference: The same cycles as the
  reference; each other cycle is further from it. It does not say whether a
  cycle is harmful.
- **Claims state.** Closer to the reference: The same state as the reference. It
  does not say why the state differs; the findings say that.
- **Findings by class and law.** Closer to the reference: Counts nearer the
  reference's for each class, law and component. It does not say whether a
  finding is a real problem in the design.
- **Unread units.** Closer to the reference: A count nearer the reference's;
  unread units leave the claims measures incomplete. It does not say anything
  about the design itself.
- **Requirement coverage.** Closer to the reference: The same verdict as the
  reference for each requirement ID, citing Facets that answer it as the
  reference's do. It does not say whether a cited Facet answers its requirement
  well; the counts are not a grade.

## Known leak

[`skills/sigil-write/references/contract-prose.md`](../../skills/sigil-write/references/contract-prose.md)
contains examples taken from an earlier Slotted run, such as "Booking requires
the recurring booking series". The benchmark does not edit the skill it tests,
so a writer that reads that reference sees some Slotted vocabulary. Read Slotted
results with that in mind.

## Tests

```sh
bun test
bun run check
```

The tests use fake hosts and never start a real agent.
