# Portable review handoff — not a completed review

The current run prohibits delegation by task instruction. No separate evaluator ran. A receiving host must first have authorization to run a fresh read-only evaluator; elapsed time does not remove this restriction.

On such a host, use `review-request.json` as the sole project evidence authority. Read the captured evaluator entrypoint, design-review guidance, review contract, understanding guidance, normative reference, and grammar. Verify all captured SHA-256 digests and the language-pack manifest identity. Resolve any references against original source locations before mapping to captures; this draft has no imports or links. Review only the stated design scope. Preserve all files. Return every report field required by sigil-design-review/v1, identifying only bytes actually assessed and the actual read-only restrictions. Do not treat this handoff or a writer pass as independent review.

If transferred to another host, retain logical original locations and source_root, update only captured_path/captured_root mappings, and reverify saved bytes and authority identities. The capture directory retains the installed sibling authority layout.
