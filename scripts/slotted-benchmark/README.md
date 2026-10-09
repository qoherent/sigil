# Slotted interpretation benchmark

The benchmark runs Sigil's computed-claims evaluation against the seven-source
Slotted design. One **pass** launches one orchestrator process (Codex, Claude
Code or Pi) in its own pass directory. The orchestrator carries out the
`sigil-compute` skill's whole-design action end to end: it reads every source
with fresh children, re-asks what ingest left unread (at most twice), writes the
readings back, and runs the final check. The benchmark then runs the pinned
`sigil-claims check` itself and scores the planted problems from that report.
What the agent hands back is only cross-checked against it.

The benchmark owns the Slotted fixture and its four planted problems in
[`fixture.ts`](./fixture.ts). It checks their evidence against the workspace
trees before scheduling a batch. If the design has drifted, the report marks the
affected planted-problem measure as unavailable.

The linked check sees every source's stored readings, so a problem that spans
components, such as `booking-rooms-archived-mark-ownership` (Booking claims a
mark that Rooms' private `state` says Rooms owns), is scored from the linked
report. A planted problem whose anchor Facets were still unread at the end of a
pass, for example because a unit stayed refused after the re-asks, is
unavailable for that pass rather than missed, and the other problems still
score.

## Requirements

- Deno and Rust/Cargo must be available.
- The Claude, Codex, or Pi CLI you select must be installed and authenticated.
- Each model selector must be accepted by its selected CLI.
- Pi additionally needs the `pi-subagents` extension (see below).

The `deno task slotted-benchmark` command builds `sigilc` and `sigil-claims`
with Cargo before running the benchmark.

## Run a batch

Pass one `--agent AGENT:MODEL` option for each agent/model pair and choose a
positive pass count:

```sh
deno task slotted-benchmark run \
  --agent claude:MODEL \
  --agent codex:MODEL \
  --agent pi:MODEL \
  --passes 3 \
  --reasoning medium
```

Replace each `MODEL` with a selector supported by that CLI. For example, Pi
selectors may include a provider such as `provider/model`.

Options:

- `--reasoning LEVEL` sets the reasoning effort of the orchestrator and of every
  child (`low`, `medium`, `high`, `xhigh`, as the host accepts them). Without it
  each host uses its own default and no child effort is checked.
- `--timeout-ms N` bounds one **whole pass**: staging, the orchestrator and its
  children. The default is 7,200,000 ms. The benchmark's own check after the
  agent exits gets at least 30 s beyond that. A pass that runs out of time is
  reported `interrupted`, never scored as missed; its pass directory, host
  events and a check of whatever was stored are kept as partial evidence.
- `--out DIR` chooses the batch directory, which must not exist. By default each
  run gets a new directory under `analyze-demo/slotted-runs/benchmarks/`, which
  Git ignores.
- `--codex-auth FILE` names the Codex auth file (default `~/.codex/auth.json`).
- `--pi-subagents FILE` names the `pi-subagents` extension entry (default
  `~/.pi/agent/npm/node_modules/pi-subagents/index.js`).

The command prints the report path and counts for scheduled, valid, failed or
invalid, interrupted, and unfinished passes. A stopped batch keeps its completed
and pending pass records so its report can be rebuilt later.

Run live batches one at a time. The Codex service has had stalls of 15 to 60
minutes per call, and parallel runs make them worse.

## What a pass is

Each pass gets a directory, `attempts/<id>/pass/`, which is kept as evidence:

| Part               | What it is                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root/`            | A copy of `examples/slotted` that keeps `.sigil/config.json` and has no `.sigil/claims/` store. It is the skill's `--root`, so the full-design write-back lands here, never in the fixture. |
| `store/`           | The private store. It must be empty when the pass starts; a pass whose store is not empty is refused. Nothing from an earlier pass is reused.                                               |
| `run/`             | The run directory: the orchestrator's preparations, seeds and the children's answer files.                                                                                                  |
| `skills/`          | `sigil-compute`, `sigil-understand` and `sigil-egglog` staged as siblings. The prompt names `skills/sigil-compute/SKILL.md` by path, and their hashes are recorded in the manifest.         |
| `bin/sigil-claims` | The pinned binary, first on the orchestrator's `PATH`.                                                                                                                                      |

Host output is kept beside it in `attempts/<id>/evidence/`: the prompt, raw
events, the last message, and the benchmark's own check under `check/`.

The orchestrator prompt ([`agents.ts`](./agents.ts)) names the staged skill, the
root, the store, the run directory, and the requested model and effort, and
requires a fresh child for every reading. The child instructions (return nothing
for context rows, write the answer to a file) live in the skill, not here.

### How a pass is judged

The state and the planted problems come from the check the benchmark runs after
the agent exits. The pass is:

- `valid` when that check validates (report version 5, the fixture's workspace
  digest, stored readings) and the agent's hand-back state agrees with it;
- `invalid` when the hand-back disagrees with the benchmark's check, a child ran
  at an effort other than the requested one, the check does not validate, or the
  fixture's own `.sigil` changed;
- `failed` when the host did not launch or finished without a final message, or
  the agent handed back no state (or `failed`);
- `interrupted` on a timeout or cancellation.

Only `valid` passes are scored. An `incomplete` linked state is a valid result:
it means units were still unread after the re-asks, and it is reported with the
unread count.

Observed child models and efforts are recorded where the host shows them:

- Codex: read from each child's rollout file in a scratch `CODEX_HOME` kept with
  the evidence (the stream itself carries no child model or effort).
- Claude Code: child models come from the stream. The child effort is requested
  through the agent definition but never echoed, so it is `unverified` and does
  not fail the pass.
- Pi: from the `subagent` tool result, where present.

A host that exposes no child effort is recorded as `unverified` and the pass is
still scored. A child effort that differs from the requested one makes the pass
invalid.

## Host settings

Settings are built in [`hosts.ts`](./hosts.ts), which the host probe
(`deno task slotted-benchmark:probe`) shares, so a pass runs with the settings
the probe checked.

| Host        | Orchestrator                                                                                                                                                                                                                                                                                                                                         | Children                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex       | `codex exec --json --ignore-user-config --ignore-rules --enable skip_host_skill_discovery --sandbox workspace-write -C PASS --skip-git-repo-check`, `-c model_reasoning_effort="LEVEL"`; a scratch `CODEX_HOME` with the auth file copied in for the run and deleted afterwards. No `--ephemeral`, which would hide the children's model and effort. | `spawn_agent` with `fork_turns: "none"`; effort from `-c agents.default_subagent_reasoning_effort="LEVEL"`.                                                  |
| Claude Code | `claude --print --output-format stream-json --restricted --strict-mcp-config --permission-mode dontAsk --tools Bash,Read,Write,Glob,Grep,Agent --effort LEVEL`, with `--allowedTools` for `Bash(sigil-claims *)` and the shell the skill needs (`mkdir`, `cp`, `mv`, `ls`, `cat`, `test`). `--safe-mode` is not passed: it disables `--agents`.      | An `interpreter` agent given with `--agents` (tools Read, Glob, Grep, Write; the requested model and effort).                                                |
| Pi          | `pi --print --mode json --no-extensions -e PI_SUBAGENTS_ENTRY --no-skills --tools read,bash,subagent --thinking LEVEL`                                                                                                                                                                                                                               | An `interpreter` agent in `.pi/agents/` (`context: "fresh"` is required by the prompt; restricted tools; `thinking: LEVEL`; no inherited context or skills). |

**Pi support is untested live.** The host probe could not run Pi: the xAI
provider answered 403 (out of credits). The Pi settings and the readers of its
event stream were written from the `pi-subagents` documentation and are only
exercised by fake-host tests. Treat the first live Pi pass as a probe. Codex and
Claude Code were verified live in U1, except that the Claude shell allowlist
beyond `sigil-claims` (`mkdir`, `cp`, `mv`, `ls`, `cat`, `test`) is chosen from
what the skill's seed and write-back steps need and has not been run live.

None of the hosts gives an OS-level boundary. Codex's `workspace-write` sandbox
confines writes to the pass directory but can read elsewhere; Claude Code's and
Pi's allowlists limit tools, not file access. The benchmark's guard is that it
checks the result: the fixture's `.sigil` hash must be unchanged after a pass
and the check's workspace digest must match the fixture's.

## Read or rebuild a report

Every batch contains a `report.md` with these sections:

- **Runs:** one row per scheduled pass: agent, requested and observed model,
  requested reasoning effort, pass, status, the benchmark's linked state, the
  state the agent handed back, planted findings (or N/A where the anchor Facets
  were unread), additional findings, unread units, the observed children (count,
  model, effort and whether it was observed), and evidence links (record,
  outcome, prompt, host events, pass directory, linked report and context).
- **Agent and model comparison:** rows grouped by agent, model and reasoning
  effort. The table reports linked state counts, planted-problem detection,
  additional-finding frequencies and the unread units of scored passes. It does
  not assign one overall rank.
- **Planted finding evidence and additional findings for review:** evidence
  links for matched planted problems, and extra findings that need human review.

There is no per-source validity, Facet coverage or repeated-run variation: the
benchmark no longer sees the individual readings, only the final check.

To rebuild a report from a saved batch without starting an agent:

```sh
deno run --allow-read --allow-write --allow-run --allow-env \
  scripts/slotted-benchmark/main.ts report \
  analyze-demo/slotted-runs/benchmarks/BATCH_DIRECTORY
```

The report uses only evidence inside the batch directory. Requested models are
shown separately from observed model IDs; hosts that do not report a served
model are labeled unverified.

## Retained evidence

Each batch keeps its `sigilc tree` output, the workspace digest, fixture
preflight, tool, skill and guidance identities (the orchestrator prompt is
hashed as a template; each pass keeps its own rendered prompt), the pinned
binary and skills, one record per scheduled pass, and for each pass its
directory and host output as described above. The agents do not receive the
planted-problem answer key or prior batch output.

See [`report.ts`](./report.ts) for report definitions and
[`docs/computed-evaluation-demo.md`](../../docs/computed-evaluation-demo.md) for
the current demo workflow and historical manual results.
