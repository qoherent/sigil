# Computed alignment orchestration contract

The host runs tools, retains evidence outside the workspace, and delegates
interpretation. The binary never launches a model or reads skills. A plain
“align this implementation” or “review this implementation” request stays on
advisory `sigil-align`. This action is for an explicit computed implementation
check, `sigilc align`, or this skill by name.

## Selection before delegation

Inspect effective workspace `.sigil/config.json` and `.sigil/local.json`:
local tool settings merge recursively, with arrays replacing workspace arrays.
Require `tools.sigilc.implementation` before any child runs. When absent, return
a minimal proposed JSON selection based on observed code directories, with
suggested plumbing excludes. For example, when `src` is the code directory:

```json
{"tools":{"sigilc":{"implementation":{"dirs":["src"],"exclude":["**/generated/**"]}}}}
```

This is output only. Select actual observed dirs and propose only relevant
excludes; do not invent a directory or install this example. Leave workspace
configuration and store unchanged and name the missing selection. An existing
block is validated by the compiler's strict selection contract later; the host
does not create a second validator or widen selection. Optional `design` source
roots define promise scope through imports and owners; absent `design` means
all workspace design. The full-design loop still checks the entire design.

## One seeded store, one owner of write-back

Create a unique run directory OUTSIDE the workspace. Keep preparations, answer
artifacts, command payloads/exits and reports there. Seed its private store from
both workspace `.sigil/claims/interpretations/` and
`.sigil/claims/implementation/`; absent directories start empty. Retain an
immutable seed copy of both, including evidence of absent entries. All commands
pass the real workspace as `--root` and this SAME private store as `--store`.
Never prepare, ingest or check against the workspace store.

Load the [design orchestration contract](../../sigil-compute-design/references/computed-evaluation.md)
and execute its FULL-design action first. Apply this explicit composition
override only here: its store is already seeded; do not seed again or create an
inner private store, and defer its write-back to this outer action's successful
end. Everything else in its full-design protocol remains: initial linked
check, grouping unread units by source, fresh children only for positive
requestedUnits, source-local bounded re-asks, final linked check and matched
version-6 report/context. A full-design action with no queue launches no child.
Standalone `sigil-compute-design` retains its own seeding and write-back.

Record any failed design source or operational, delegation or identity failure
as a FAILED outer run even if the design action continues other sources for
evidence and obtains a final report. It writes nothing back. Never use a
completed report to erase a failed-run flag. Completed Incomplete is different:
remaining unread units after legitimate re-asks, or unresolved imports, can be
reported and accepted readings can be written back when no step failed.

If the final matched design state is `disjoint` or `incomplete`, launch no code
prepare or reader. Run `sigilc align check` deterministically on this same store
to get the corresponding Incomplete alignment report and design findings.
Recognize that report below before naming an Implementation state. A failure in
this check supplies no invented verdict and makes the outer run failed.

## Native code surface

```text
sigilc align prepare --out NEW_DIR [--root DIR] [--store DIR]
sigilc align ingest --binding FILE --claims FILE [--root DIR] [--store DIR]
sigilc align check [--root DIR] [--store DIR]
```

Prepare's version-1 payload includes `requestedUnits`, `reusedUnits`, `inputs`
(the safe directory paths for requested files), `namesDigest`, `selection` and
`presentationByteLimit` (1000000 bytes). Each directory contains `request.json`,
the FULL `source.txt`, `binding.json`, `rows.md`, `examples.md`, `rejected.md`.
Do not manufacture a unit from an empty or unpresentable file.

The binding is format 1: `path`, `contentHash`, `namesDigest`, `selectionDigest`,
`guidanceFingerprint`, `vocabularyGeneration` (code generation 1). The request's
names carry `id`, `kind` (Component or Tag), `label`, `qualifiedLabel`, `owner`,
`source`, `digest`, `membershipDigest`, admitted `claims` and exact `facets`.
Compiled code guidance and these names govern the answer; do not substitute
design `vocabulary.md` or host-made column tables.

Prepare once after a usable design result. For EACH presented whole file launch
one fresh child with no inherited conversation. Zero requested files launches
no child and goes directly to check. Retain the payload and each binding.

## Hand off a whole file

Give each child only its prepared directory, the installed
[sigil-understand](../../sigil-understand/SKILL.md) and
[sigil-egglog](../../sigil-egglog/SKILL.md) entrypoints, and an answer artifact
outside the workspace. Explicitly select egglog's
[code profile](../../sigil-egglog/references/code-dialect.md), not its design
profile. Supply `request.json`, `source.txt`, binding and all three code guidance
files. The child reads the entire presented file and the design context in its
request; it does not read other files or run the tool. Missing skills, failed
agent creation, interruption or absent completion are failures.

The child writes only its plain-text `.egg` answer, one literal flat data call
per line, nothing else: no JSON, markdown fences, rules or explanatory prose.
The host captures and ingests those exact bytes without repair, stripping or
substitution. All mappings come from the child. No language parser or `@sigil`
annotation supplies evidence. Whole-file coverage includes helpers, state,
initialization and tests; use module elements for otherwise uncovered file work.

Keep observations (`element`, `act`, `measure`) separate from `realizes` mappings.
Component membership requires an IN-SCOPE design claim accounting for that
element's behavior. File placement, names or proximity establish no membership.
Tag realization means delivery alone; add Component membership only when
supported separately. Leave an element unmapped when design does not account
for it: never force every element into membership to make a check pass. Kind
`test` maps names it actually exercises, but cannot answer production promises,
establish production membership or delivery, or become a second owner.

Names are component-qualified; ambiguous bare labels refuse a file and name
qualified alternatives. Cross-file actions target only presented design names,
never another file's element. Day measures use whole days converted by the
reader; duration, lead and span are separate, and latency uses milliseconds.
Use the compiled guidance for literal row shapes, accepted relations and measures.

## Serial ingestion and bounded re-asks

Ingest each completed artifact serially against its file binding and the same
private store. A completed exit-0 or exit-1 alignment ingest returns its
structured version-1 gate:
`path`, `storedUnits`, `admittedFacts`, `undesignedElements` (count),
`unreadUnits` (count), `refusals` (path and reason). It is NOT an Implementation
verdict and carries no design per-Facet unread list or comparison flag.

- Exit 0: admitted file. Undesigned elements can be accepted; do not re-ask them.
- Exit 1: malformed/refused file or empty/no-element unread answer. Re-ask only
  that refused/unread file. Preserve the gate and its last reasons.
- Exit 2: usage or binding mismatch, naming the field that moved. Stop the run;
  do not retry or reprepare to mask workspace changes.
- Exit 3: operational/IO failure. Stop the run without retry or write-back.

A malformed gate, wrong path, missing artifact, interrupted child or identity
mismatch is a failed run, not an unread reading to repair. Legitimate exit-1
refusal is a completed gate; exhaustion of its rounds is not an operational
failure. Count answers per file: first answer and at most TWO re-asks.

For each re-ask, prepare into a fresh empty directory and select ONLY the
corresponding stale file requests for refused/unread files. Other new or reused
files are not a reason to start children. Give a new isolated child the prior
refusal reasons WORD FOR WORD and the new preparation, then ingest serially.
Never rewrite rows yourself. After answer 3, list still unread files with their
last reasons. Drift, undesigned elements and unanswered promises never initiate
another reading. Do not retry the overall run.

Freshness belongs to the tool: content plus code guidance/generation is the memo
key, excluding paths, so renamed identical bytes may reuse a reading. Cited
names and membership claims ground it; unrelated design edits do not re-ask.
Added names re-ask undesigned files, and membership claim/name changes can
re-ask member files. Do not override reuse or ask every file on each run.

## Final check and matching identity

Run align check once after ingestion/re-asks (or immediately when no files were
requested). It returns version 1, `scope: "workspace"`, lowercase `state`
(`closed`, `converged`, `drift`, `incomplete`), `designState`, `incompleteReasons`,
`findings` and `unreadUnits` counts, `report`, `judgmentContext`, `workspaceDigest`,
`vocabularyGeneration` and `guidanceFingerprint`. Closed/Converged exit 0;
Drift/Incomplete exit 1; usage exits 2 and operational failure exits 3. A bare
exit code never supplies a verdict.

Require this invocation's structured payload and its matching private-store
report `claims/workspace.align.json` and context
`claims/workspace.align.context.json`. Both paths must lie under THIS private
store; a dropped `--store` is a failure even if other fields agree. Verify:

- Report version 1, `source: "workspace"`, state and designState equal summary;
  summary state agrees with exit code. Its findings and unreadFiles match counts.
- Report identity includes `workspaceDigest`, `designBindingDigest`,
  `selectionDigest`, `namesDigest`, `guidanceFingerprint`,
  `vocabularyGeneration`, `implementationDigest`. Match workspaceDigest,
  guidanceFingerprint and generation to summary; match namesDigest to the
  applicable retained preparation and selectionDigest to the retained selection
  fingerprint. File binding selectionDigest uses selectionFingerprint
  (effective config); report identity.selectionDigest uses fingerprint
  (resolved selection). Do not equate those two hashes. With no code preparation use the check's
  retained selection/design context rather than inventing a preparation.
- Context version 1 has the SAME entire identity as the report. It carries
  `designCheck`, `designFacts`, `designFacets`, `codeFacts`, `entities`, `tables`,
  `selection`; its linked designCheck agrees with the completed full-design
  check and matching version-6 linked report: its identity.bindingDigest equals
  designBindingDigest, and linked.workspaceDigest equals workspaceDigest. Keep
  these reports as evidence.

The report additionally records `iterations`, `incompleteReasons`, `findings`,
`undesignedFiles`, `undesignedElements`, `unanswered` (a subset of findings),
`unreadFiles`, `selection`, `designFindings`. Each code finding names `law`,
`subject`, `object`, `detail`, `claims`, `codeRows` (path/element/id/kind/row) and
`locations`. Location hashes are SHA-256 over UTF-8 bytes. Preserve the tool's
locations and identities, never coin replacement digests. Old reports,
mismatches or malformed payloads make the run failed and supply no verdict.

## Write-back only after outer success

After the final matched align check, and only if NO step failed, write accepted
readings from BOTH private `claims/interpretations/` and
`claims/implementation/` back using the immutable seed:

- Copy an entry absent in the workspace store.
- For an existing entry, copy only if private bytes differ from seed AND the
  current workspace bytes still equal seed. Leave concurrently changed entries
  alone and report that they were retained.
- Write each accepted copy to a temporary sibling in its target directory and
  atomically rename per file. Reports and contexts remain private; never copy
  them back. This is a per-file rule, not a transaction across the two trees.

A completed Incomplete can write its accepted readings under this same rule.
A failed run writes NOTHING back, including design readings accepted before a
later code failure. No inner design write-back may happen early.

## Hand back the bound result

State exactly Closed, Converged, Drift or Incomplete from the matched report;
keep the separate design state explicit. Include report/context paths, full
report identity, workspace scope, actual promise roots, and the seeded store.
For Drift show laws, claims and code rows; for Incomplete show reasons, unread
files with last refusals, and design findings. No global Coherent verdict is
assigned to implementation, and comparison states remain separate.

Include selection exclusions with each pattern and removed count,
`autoExcludedDesign`, empty files, unpresentable files, skipped symlinks, and
`selection.outsideComponents` (components whose promises are not judged).
Unpresentable files keep Incomplete until explicitly excluded. Do not hide
these scope limits behind a pass.

For undesigned plumbing (logging, build glue, generated code), propose specific
selection excludes OR designing that behavior, as output only. Do not add,
widen or write excludes, edit configuration, or write code/design. A failed run
names the broken step and retained evidence; it never invents an Implementation
verdict from exit status alone or silently retries.
