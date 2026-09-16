# Mechanical validation alongside design review

Use available compatible `sigil` tooling to offload deterministic work. This
supplements the bundled language authority and independent design judgment;
it does not establish saturated coherence, implementation conformance, or
permission to decide missing policy. Never require installation or change a
workspace's configuration to make this step available.

## Establish tool and workspace

Resolve the executable and use the original configured workspace, not a partial
review capture. Retain the executable path and identity, command arguments,
working directory, stdout/stderr, and exit status. Probe read-only:

```sh
sigil version /absolute/workspace --format json
sigil check --help
sigil fmt --help
```

Verify tool identity separately from workspace metadata: the supported current
family is CLI `0.9.x`, core `0.8.x`, and language/configuration `0.8.0`.
`sigilVersion` alone reports the workspace setting; it cannot prove that a
legacy executable supports that language. Verify JSON check output, formatting,
and `--check` in actual help. A compatible CLI may still have the older
single-target formatter; use the capability it actually exposes. Do not infer
batch support from an unchanged artifact version.

If the executable, compatible tooling, workspace context, or execution permission
is unavailable, continue design work and state the specific mechanical limit.
Do not auto-install, initialize, upgrade, migrate, or substitute legacy `sigilc`.
A command that completed with diagnostics is a completed check with findings,
even if those diagnostics prevent further formatting. Invalid JSON, usage,
process failure, or denied access cannot establish a clean result.

## Select commands and write scope

Run `sigil check /absolute/workspace --format json`. Even a file argument to
`check` validates its discovered workspace, including implementation annotation
diagnostics; it does not isolate that file. Preserve unrelated diagnostics as
mechanical context without converting them into design conformance findings or
authority to edit implementation.

For the **writer**, fix supported non-width errors in the authored scope first,
then format the authored files explicitly and recheck the workspace. Width
errors (`SIGIL_LINE_TOO_LONG`) can be left for `fmt` to repair. Preserve Tags,
links, literal content, and every meaningful commitment; use the writing loop's
existing authority and progress rules for corrections.

```sh
sigil fmt /absolute/workspace/search/service.sigil /absolute/workspace/search/panel.sigil --root /absolute/workspace --format json
sigil check /absolute/workspace --format json
```

Submit the authored file set together when help advertises `[paths...]`; this
allows provider and consumer width repairs to validate together. For a verified
older single-target CLI, invoke it once per authored file. If that CLI cannot
complete an interdependent repair, retain the diagnostic and disclose the
single-target limitation; do not expand selection to a directory containing
unauthorized sources. Formatting failure does not prevent meaningful review.

For the **evaluator**, run the same workspace check and use only nonwriting
formatting checks on the selected design files:

```sh
sigil fmt /absolute/workspace/search/panel.sigil --root /absolute/workspace --check --format json
```

Use multiple explicit targets when supported, or one read-only invocation per
file otherwise. Never run writing `fmt`, fixes, installers, or `init` in an
evaluator. Direct evaluation creates no files, including evidence logs; return
the observations for the caller to retain.

Bare `sigil fmt` selects the current directory. At the workspace root it selects
all included workspace sources; in a nested directory it selects included sources
beneath that directory. A file selects only that file, a directory its included
sources, and multiple targets their deduplicated union in one workspace.
`--root` establishes configuration context; positional paths still resolve from
the working directory and remain the selection boundary. All targets and the
combined replacements validate before writes, including workspace context.
Exclusions apply. Missing, excluded, unmatched, or foreign-workspace targets fail
the invocation before writes. Never use bare `fmt` as shorthand for a scoped
writer repair.

## Interpret outcomes independently

| Observation | Report |
| --- | --- |
| Exit 0, valid output | Completed mechanical result for the actual scope; retain warnings. |
| Exit 1 with diagnostics | Completed check with the returned findings; distinguish selected design, other workspace, and annotation diagnostics. |
| `fmt --check` exit 1 with noncanonical files | Completed formatting check; identify files, preserve bytes. |
| Exit 2/3, unavailable process, denied access, or invalid output | Failed or unavailable mechanical validation with the actual cause and any emitted diagnostics; never a clean result. |

Read the JSON diagnostics and file statuses rather than assigning design severity
from an exit code. A successful mechanical check can coexist with a consequential
semantic contradiction. A failed workspace check does not authorize broader
writes, deletion of promises, or invented policy.

## Bind evidence to the reviewed revision

The writer completes check, supported fixes, scoped formatting, and recheck
**before** capturing review inputs. Subsequent edits, including formatting,
require new captures and fresh independent review before claiming coverage of
the changed bytes. Keep the mechanical input snapshot alongside the review
capture and identify its path and digest in the existing request `scope`; it
records command scope, membership, and configuration/other input identities
separately from semantic `inputs`.

For delegated evaluation, compare the relevant original files to the captured
inputs and the supplied mechanical snapshot before and after read-only commands.
A changed configuration invalidates the earlier mechanical snapshot even when
the draft matches. Run against the original workspace
only if that correspondence can be established. Preserve the original import
root and link mapping. A capture containing only a draft and a provider is not
a complete configured workspace. If live sources differ, evaluate the captured
meaning and report mechanical coverage unavailable for that captured revision.
Do not validate different live bytes and attribute the result to the capture.

In the existing report's `coverage` and `limitations`, record tool/version
identity, original workspace root, cwd, commands, selected targets, exit status,
diagnostics/file statuses, and input identities. Record configuration (including
local overrides and glossary when present), discovered source membership and
bytes, and additional CLI inputs such as implementation annotation sources
separately from semantic `assessed_inputs`. Check those identities and membership
before and after commands; mark affected observations stale or unavailable if
they changed or cannot be established. These are mechanical scope records, not
claims that implementation code received design review. Only context actually
used for semantic judgment joins `assessed_inputs` under the
[review contract](review-contract.md). No new request/report fields are required.

For direct review, record identities in place and verify read-only behavior.
The caller may save returned evidence afterward. Always distinguish completed
mechanical findings, unavailable mechanical coverage, semantic findings, and
unreviewed scope, including when the design assessment itself is complete.
