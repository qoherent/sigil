# Computed design evaluation

The current skill is [sigil-compute-design](../../skills/sigil-compute-design/SKILL.md).
It runs the one-source and full-design loops with `sigilc` 0.3.0. The rename
preserves source selection, private stores, fresh children, re-asks, report
identity checks and conditional write-back.

The [evaluation fixture](../../skills/sigil-compute-design/evals/computed-evaluation-fixture.md)
covers the routing, reading, refusal, failure, isolation and write-back cases.
Offline validation checks the renamed catalog, dependencies and local links.
Live benchmark results are recorded separately; a rename is no new behavioral
observation.

The [2026-09-23 observations](evidence/sigil-compute/observations.md) retain the
skill name, tool versions and limits actually observed then. Their evidence
paths and bytes are unchanged.

Review preparation (0.5.0) was observed on 2026-10-12 as part of the
[claims-guided review comparison](claims-guided-review.md): a cold whole-design
run, an unchanged rerun with no reader, a selected-source run, and a compiler
that writes no review view (controlled replay).

## Missing `sigilc` (2026-10-13)

`sigil-compute-design` 0.5.2 and `sigil-compute-align` 0.1.1 check that `sigilc`
responds before any work and hand back the official installer command. Three
fresh hosts ran the new fixtures ([scenario 17](../../skills/sigil-compute-design/evals/computed-evaluation-fixture.md),
[scenario 14](../../skills/sigil-compute-align/evals/computed-alignment-fixture.md))
against a catalog copied from the branch, in workspaces created from the
fixtures' inputs. The runner restricted the hosts to a PATH without `sigilc`
(instructed unavailability, not a missing host capability). The hosts were
Claude Code subagents; no model identity was recorded beyond that.

- **17a, decline:** `sigilc --version` exited 127. The host started no child,
  prepared and checked nothing, named no state, showed the `install.sh` and
  `install.ps1` commands, and stated it would run the installer only on the
  user's agreement.
- **14, align:** the same result before reading configuration: no child, no
  store, no proposed selection block, installer shown, consent requested.
- **17b, agree:** the host stopped and asked, as 17a did. After the observer
  replied "Yes, install it", the host ran the official command once. **The
  install itself was not observed:** the host's permission classifier refused to
  run `curl ... | sh`, so the host reported the block and gave the user the
  command to run, and did not retry. Because that block is a host setting, this
  run shows the consent gate and the single attempt, not the install or the
  continuation into `prepare`. The observer served the installer through a local
  `curl` shim because the first GitHub release does not exist yet.

Separately, running the locally built `install.sh` directly with
`SIGIL_ARCHIVE_PATH` and `SIGIL_CHECKSUMS_PATH` installed `sigil` 0.9.0 and
`sigilc` 0.3.0 into an isolated directory, and both answered `--version`. The
case of an install followed by a continued run remains unobserved.

## Release match (2026-10-13)

`sigil-compute-design` 0.5.3 and `sigil-compute-align` 0.1.2 pin the installer to
the release their skills belong to (0.9.0) and, once `sigilc` answers, compare it
with `sigil --version`. Five fresh hosts ran the new fixture variants
([scenario 17](../../skills/sigil-compute-design/evals/computed-evaluation-fixture.md),
[scenario 14](../../skills/sigil-compute-align/evals/computed-alignment-fixture.md))
against a catalog copied from the branch without the `evals/` folders, in
workspaces created from scenario 2a's input plus the promise example's
`.sigil/config.json`. Each host was restricted, by instruction, to a PATH the
runner built per variant; `sigilc` was the checkout's debug build (0.3.0). The
hosts and their children were Claude Code subagents; no model identity was
recorded beyond that. The observer's reply to an installer offer was supplied in
the host's brief, not typed live.

- **17c, mismatch, declined:** `sigil --version` printed 0.8.0. The host named
  both releases, showed the pinned `cli-v0.9.0` installer, did not run it, then
  continued: one `prepare`, one fresh child, one `ingest` (exit 0, Loose, one
  gap finding), and the write-back. The existing `sigilc` was left alone.
- **17d, `sigil` absent:** `sigil --version` exited 127. The host continued
  without an installer offer and ran the same loop to a Loose result. It noted
  in its hand-back that the match could not be confirmed; the user-facing
  message was only the hand-back, so the wording to the user is not separately
  observed.
- **17e, checkout tools:** a launcher running the checkout's CLI printed 0.9.0.
  The host raised no warning, made no offer, and ran the loop to a Loose result.
- **Align, mismatch (scenario 14 variant):** `sigil --version` printed 0.8.0. The
  host named both releases, showed the pinned installer, did not run it, then
  continued to the selection check and stopped there because the workspace has
  no `tools.sigilc.implementation`, handing back a proposed block as output only.
- **17f, release not published: not observed.** The host showed the pinned
  installer and then declined to run it, because the "yes, install it" reached it
  through the launching agent's message rather than from the user. The failed
  download path (curl 404 shim) therefore did not run, and the skill's
  "may not be published yet, build from source" wording is untested here.

Every host skipped the BLAKE3 check of the interpretations digest because
`b3sum` was not on the permitted PATH; they verified the other report identity
fields. `base.sigil` has a `SIGIL_SECTION_ORDER` diagnostic that the loop does
not act on; it comes from the fixture's input, not from this change.

After these runs, a review of the change tightened the contract's wording
without changing its steps: a failed install is judged by the installer's output
and by `sigilc --version`, not the exit code; the mismatch offer is asked once
and never blocks; a newer `sigil` raises no offer; and the release is named only
by the installer URLs. These wording changes were not observed again.
