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

A direct evaluator does not create or change files. If the caller has provided
captures, use them. Otherwise read the original sources and record their exact
byte digests with `captured_path: null` and `capture_mode: in_place`; scope the
assessment to those bytes. A caller preparing a later delegated review must
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

## Report

Return `protocol`, `status` (`complete` or `incomplete`), `scope`, `source_root`,
`assessed_inputs`, `authority`, `findings`, `coverage`, and `limitations`.
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

Do not disguise an interrupted, cancelled, missing, or malformed report as empty
findings. The caller treats missing required fields, unverifiable identities,
unsupported dispositions, or missing correction authority as incomplete and
retries or returns the precise limitation. Same-agent review does not count as
an independent evaluator run.

## Freshness and reuse

Before applying any correction or claiming coverage of the current draft, the
caller checks **all** current draft, intent, provider, and linked context bytes
against `assessed_inputs`, as well as authority identity. Include context the
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
