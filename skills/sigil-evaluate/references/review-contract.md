# Revision-bound design review contract

This is the shared protocol for the evaluator and its caller. It specifies a
portable handoff and report, not a model runner, service, compiler format, or
persisted workflow. The host supplies agent creation, tools, cancellation, and
any enforced restrictions. Review records belong outside authored Sigil and
workspace source discovery.

## Request

For delegated review the caller captures exact input bytes into a temporary
directory before launching a fresh evaluator. Use the following fields in a
structured object or clearly labeled text; field meaning is mandatory, serialization
is host-neutral.

| Field | Content |
| --- | --- |
| `protocol` | `sigil-design-review/v1` |
| `scope` | Selected files/components/contributions and review purpose; design-only. |
| `established_intent` | Supplied commitments and their input anchors, not the writer's argument for approval. Capture any intent supplied in conversation as its own input. |
| `unresolved_questions` | Known undecided consequential choices, or an empty list. |
| `source_root` | Original absolute Sigil workspace root used for root-relative imports. |
| `captured_root` | Absolute temporary capture directory. |
| `inputs` | All selected drafts, provider/linked context, and intent evidence, with identities below. |
| `evaluator_skill` | Available evaluator entrypoint and version or digest; include shared language-pack identity. |
| `read_only` | Instructions prohibiting source edits, plus the actual host restrictions and allowed read roots. Say when restriction is instructions only. |
| `computed_evidence` | Required when the review uses computed claims; absent for a source-only review. See below. |

Each input identity contains `role` (`draft`, `context`, or `intent`),
`original_path`, `captured_path`, and `sha256` of the exact bytes at the captured
path. Use absolute paths and a full lowercase SHA-256 digest, not timestamps,
branch names, summaries, or line ranges as identity. Hash the saved bytes; do not
normalize line endings or alter link/import spellings. Virtual intent inputs
have an explicit logical original location and are immutable for that request.

Capture workspace files under the same relative layout whenever possible. Keep
the original-to-captured mapping even when layout is preserved: root-relative
`@` imports resolve against `source_root`; local Inline Links resolve against
the **original linking source's directory**, then map the resolved original
target to its capture. Resolve links outside the workspace through that mapping
as well. Never reinterpret an import as capture-directory-relative or a local
link as workspace-root-relative. Preserve target query/fragment semantics.

Supply the draft, explicit scope, necessary evidence, and evaluator instructions
to the separate agent. Do not rely on inherited conversation, send acceptance
notes, or advocate for the draft. Include accessible locations for relevant
uncaptured context so the evaluator can retrieve it read-only. Core language
authority comes exclusively from the installed sibling understanding pack.

### Direct input and additional context

A direct evaluator does not create or change files. The one exception is
computed evidence: its review preparation through `sigil-compute-design` may
write temporary files, its private store, and the workspace's claims cache,
never a design source. A delegated evaluator runs no preparation. If the caller
has provided captures, use them. Otherwise read the original sources and record
their exact byte digests with `captured_path: null` and `capture_mode: in_place`;
scope the assessment to those bytes. In a direct review, `computed_evidence`
bundle and dependency entries take the same shape: their original store or
workspace path, `captured_path: null`, `capture_mode: in_place`, and the SHA-256
of the bytes actually read. A caller preparing a later delegated review must
capture them before dispatch. For pasted text, identify the supplied message
and state inability to establish file-byte identity if the host cannot do so;
such a report cannot establish freshness for automatic corrections.

Every additional provider, linked document, or intent source actually used joins
`assessed_inputs`, with its original location and exact digest. When a read-only
evaluator cannot capture new files, it records the in-place identity; the caller
must preserve those exact bytes in a new capture and review again if it cannot
prove they match. For mutable or external context, preserve a stable captured
response with its original URL/location when authorized; otherwise report the
identity or access limitation and do not assert current coverage.

Read relevant language-pack files and report the pack manifest identity under
`authority`; this distinguishes language authority from project context. A
changed authority also invalidates reuse of the report.

### Computed evidence

`computed_evidence` is a versioned extension of `sigil-design-review/v1`. It
names a frozen review bundle from one unfiltered linked `sigilc check`, prepared
by `sigil-compute-design`'s review preparation. It holds:

| Field | Content |
| --- | --- |
| `version` | `sigil-computed-evidence/v1` |
| `computation_scope` | `workspace`, plus the review scope it was prepared for: the whole design or the selected sources. |
| `state` | The final linked check's state and `workspaceDigest`. |
| `source_root` | The original workspace root the check ran against. |
| `bundle` | The review view, evidence file, report, and judgment context: each with its original store path, `captured_path`, and `sha256`. |
| `dependencies` | Every source and configuration file the evidence file's `inputs` names, with original path, captured path, and `sha256` of the captured bytes, which must equal the digest `inputs` records; an absent configuration file is listed as absent. |
| `authority` | The `sigilc` identity from the evidence file, its guidance fingerprint and vocabulary generation, and the `sigil-compute-design` skill version. |
| `coverage` | The evidence file's coverage totals, and the unread units inside and outside the review scope. |

`dependencies` are what the computation read; they are not `assessed_inputs`,
which still means the evidence the evaluator actually inspected. A source
passage retrieved through the bundle joins `assessed_inputs` with the digest of
the captured file it was read from. The bundle freezes the readings used by one
assessment: a later cache update neither changes it nor certifies a different
one.

A delegated evaluator uses the supplied bundle and runs no computation against
`captured_root`. Before reading it, it checks every `bundle` and `dependencies`
hash against the captured bytes and checks that the evidence file's own
`artifacts` hashes match the captured view, report, and context. It also checks
that `dependencies` are exactly the evidence file's `inputs`: the same relative
paths, the same SHA-256 for each, and the same files absent. A source edited
after the check but before capture passes the first checks with new bytes the
view does not describe; only this comparison catches it. Any mismatch leaves
computed coverage unavailable for that request; the source-grounded assessment
may continue.

## Report

Return `protocol`, `status` (`complete` or `incomplete`), `scope`, `source_root`,
`assessed_inputs`, `authority`, `findings`, `coverage`, and `limitations`. A
review that used computed claims also returns `computed_evidence`, echoing the
verified bundle, dependency, and authority identities it used, and `set_aside`:
one entry per group of computed findings no reported finding cites in its
`basis`, with their aliases and the reason they were not reported. A report
without `computed_evidence` is a source-only review: it remains valid, but
cannot establish computed coverage.
`source_root` records the original absolute workspace root actually used for
root-relative resolution. In a delegated report it must exactly match the
request's `source_root`; a missing or unequal value makes the report incomplete
and unusable for current coverage or automatic corrections, even when all file
hashes match. Recapture and retry or provide the portable handoff. For direct
review, record the established root, or null with the affected resolution
limitation when it cannot be established; do not guess a root from capture paths.
`assessed_inputs` echoes verified identities of the bytes actually read, including
additional context; it must not blindly echo the requested manifest. Check
captured input hashes before assessing. Mismatch leaves the affected assessment
incomplete. Coverage names the reviewed components, commitments, and relevant
relationships, plus omitted scope. Limitations state unavailable sources or
validation and the actual read-only restriction. An empty list is allowed only
when there are no such limitations.

Each finding includes:

| Field | Content |
| --- | --- |
| `id` | Local diagnostic identifier for discussion. |
| `basis` | Optional, with computed evidence: the bundle aliases (`F3`, `C12`, `U7`, …) the finding rests on. Aliases are local to the bundle and never replace `location` or `evidence`. |
| `location` | Original source path and line range, component/contract, or precise affected scope. |
| `evidence` | Supporting input identities and exact quoted text or precise anchors; both sides for contradictions. |
| `consequence` | Observable behavior, ownership, or readability impact. |
| `priority` | `high`, `medium`, or `low`, justified by the consequence. |
| `suggestion` | Concrete intent-preserving change, specific human decision, or evidence to retrieve. |
| `disposition` | `determined_correction`, `design_choice`, or `evidence_gap`. |
| `authorizing_commitment` | For determined corrections, the existing source/intent anchor that determines this change and the promises it preserves. Otherwise null. |

`complete` means the requested assessment finished with identifiable evidence;
it does not mean no findings or human approval. If missing adopted policy or
another necessary source prevents assessing requested meaning, return
`incomplete` with any supported findings and the affected coverage limitation.
An unresolved human design choice can appear in a completed assessment.
Absent compiler validation alone does not prevent a completed design-only review.

Mechanical observations use the existing `coverage` and `limitations` fields
under [mechanical validation](mechanical-validation.md), without adding required
protocol fields. Identify the actual tool, command, workspace, targets, exits,
diagnostics, and mechanically assessed input snapshot. Keep configuration and
other CLI input identities separate from semantic `assessed_inputs` unless that
context actually informed design judgment. The request's existing `scope` may
identify the writer's mechanical snapshot by path and digest. A live workspace
whose relevant source or configuration differs cannot establish mechanical
coverage of that earlier capture. Direct evaluation records in-place evidence
and creates no files beyond the computed-evidence preparation above; the caller
can retain the returned observations later.

Do not disguise an interrupted, cancelled, missing, or malformed report as empty
findings. The caller treats missing required fields, unverifiable identities,
unsupported dispositions, or missing correction authority as incomplete and
retries or returns the precise limitation. Same-agent review does not count as
an independent evaluator run.

## Freshness and reuse

Before applying any correction or claiming coverage of the current draft, the
caller checks **all** current draft, intent, provider, and linked context bytes
against `assessed_inputs`, as well as authority identity. With
`computed_evidence`, it also checks current workspace source membership and
bytes against `dependencies`, the bundle hashes, the original root, and the
computation authority; any change makes the computed coverage stale. Include context the
evaluator retrieved beyond the original request. Verify original-to-capture
mapping and source root as well: a relocation that changes resolution can change
meaning even when individual file bytes are unchanged. Missing or changed input
makes coverage stale; capture a fresh set and request a new assessment before
using its findings to edit. Do not rely on the draft digest alone.

The writer independently checks the suggested correction against the cited
authority and preserves all commitments before editing. Determined corrections
need no additional human approval. Semantic edits require a fresh delegated
review; a previous report cannot certify the changed draft. Track progress by
affected commitment and consequence, not just finding IDs or phrasing.

## Unavailable delegation

Return the current draft as independently unreviewed and provide this request
envelope, exact captures and digests, scope, unresolved questions, and instructions
for a fresh read-only evaluator. Keep temporary captures available long enough
for the receiving host, or package their exact bytes with the mapping. State the
actual host limitation. Do not claim the handoff itself is a completed review or
substitute a same-agent pass for delegation.
