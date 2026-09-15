# SearchPanel understanding

## Authored commitments and rationale

- **SearchPanel — Goal:** Help the user find records using `query` (`understanding/search/panel.sigil:5`).
- **SearchPanel — Interface:** Display `search results` for the current search (`panel.sigil:8`). This is its observable display promise.
- **SearchPanel — Constraints:** Only the active request may publish `search results` (`panel.sigil:11`). This is a binding publication invariant.
- **SearchPanel — Decisions:** Request cancellation is explicitly a possible implementation, not a selected design (`panel.sigil:14`). This records an alternative; it does not require cancellation.
- **SearchService — Goal and Interface:** Find records matching supplied text; accept `query` as search text and return `search results` as matching records (`understanding/search/service.sigil:3,6`). These remain SearchService's commitments.

## Tag ownership and provider relationship

SearchService owns the Tags `query` and `search results`, introduced by `*query*` and `*search results*` in its Interface (`service.sigil:6`). SearchPanel introduces no local Tags.

The explicit import (`panel.sigil:1`) selects those two identities from SearchService in the workspace-root-relative `search/service.sigil`. SearchPanel references `query` in its Goal and `search results` in its Interface and Constraints. Both selected names have eligible prose uses. The phrase “active request” is meaningful prose, not a declared Tag.

SearchPanel owns all four of its authored Facets, including its display promise and publication invariant. Importing provider vocabulary neither transfers those Facets to SearchService nor copies SearchService's obligations into SearchPanel. The import introduces no provider namespace, re-export, or runtime call. No explicit invocation or delegation behavior is supplied.

These readings follow the bundled 0.8 reference rules `contract.role`, `tag.identity`, `import.resolve`, `import.use`, and `interpretation.owner`.

## Supported conclusions

- Once a request is superseded and no longer active, it cannot publish results. In particular, a late response from that request cannot replace the displayed results through publication. This follows from SearchPanel's publication invariant; it is not a separately authored late-response case.
- An implementation must enforce publication eligibility even when requests finish out of order. The invariant establishes the required outcome without choosing a concurrency mechanism.
- Provider-owned vocabulary supplies the meaning of query text and matching records, while SearchPanel adds its own presentation responsibility. Shared vocabulary alone establishes no runtime architecture.

## Unresolved intent

The sources do not define exactly when a request becomes or ceases to be active, how requests are triggered, or how loading and errors appear. They also set no retention duration or detailed matching/ranking policy. These limits leave those particular behaviors undetermined; they do not create additional commitments or a requirement to expand this compact design.

## Implementation choices

Cancellation, request identifiers, generation counters, or publication guards are possible mechanisms if they preserve the active-request invariant. Data structures, storage location, and transport are also unspecified. Merely attempting cancellation would not establish that stale publication is prevented.

## Evidence and limits

This is source interpretation using the bundled Sigil 0.8 language authority. No compiler, network, implementation, tests, repository checkout, or evaluation fixtures were used. No workspace configuration was read, so this does not establish configured workspace validity. It establishes neither implementation conformance nor saturated coherence.

Restrictions were **read-only by task instruction, not sandbox enforcement**, with the sole permitted write being this report. The session exposes unrestricted filesystem access, network capability, and approval policy `never`; the task prohibited network use and input edits. Inputs were not edited.

Host identity exposed by instructions: Codex. Instructions describe the agent as based on GPT-6; no independently verified runtime model identifier or host-machine identity was exposed.

All paths below are relative to `/var/folders/xt/zq2r4zxd4xvdltd71g0qnf680000gn/T/sigil-foundation-evals-6wge0qs_/`. The following files were read; SHA256 values cover their complete bytes. The language-reference read included the relevant ownership, import, contract-role, and interpretation rules; initial combined output was truncated and those relevant sections were subsequently read separately.

| Source path | SHA256 |
| --- | --- |
| `understanding/search/panel.sigil` | `1c9bca7e2c8133f8c7cabd1fd45cc5292de17ddbdc12cea27d9c9140ed4dd8dc` |
| `understanding/search/service.sigil` | `ded1c52d1ea7734239485abc3482014c792576884478b0e74c3fa0de68c96f10` |
| `skills/sigil-understand/SKILL.md` | `b777f36bb56daacb5a1c487cf2524f646290759d85428cb408cb52926506699c` |
| `skills/sigil-understand/references/understanding.md` | `0042c8f06992c3da9783a0333a67600611edc76ae238f71b11ca95181af6501c` |
| `skills/sigil-understand/references/language/sigil-reference.md` | `a20be69c15bfeee2e4ca4d41b8bfc82f9eef75fa98cf4cb85681cb7af4606d5e` |
| `skills/sigil-understand/references/language/sigil.ebnf` | `0b172dcb45b4a4065ca07c8a91fbc12ec08a70430ea9b3397574a16995c5bac2` |
