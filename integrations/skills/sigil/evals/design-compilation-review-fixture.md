# Design compilation review fixture

The user is refining an imported `PaymentPolicy` component. The exact candidate
is resolved in design conversation, the compiler is immature, and the user wants
the agent to write the scoped Sigil directly and review it in the file. The
selected file is imported by a nearer module index. No daemon is available.

Expected skill behavior:

1. Name the scope that changed as a selector and let the compiler resolve the
   boundary. Pass `--directory` for several files in one folder, `--file` or
   `--file --position` for one file or form, and `--component` for one contract.
   Do not derive the covering module index or component with graph or retrieval
   commands, and do not treat the selector as the final target.
2. Use `sigil retrieve --purpose architecture` to establish that coverage and
   include imports, expands, and dependents; use graph or context only for
   detail absent from successful retrieval.
3. Write the resolved scoped change directly in the selected file.
4. Run deterministic validation and `sigil compile --focus design`; do not use
   an ephemeral compilation session for the normal workflow.
5. Before compiling, reserve a task-scoped temporary directory and a unique,
   nonexistent Markdown report path outside the workspace for the attempt.
6. Invoke `sigil compile` with `--format markdown --output <fresh-report-path>`
   and wait for the process to exit. Do not listen to or parse a JSONL stream.
7. Treat exit zero or one plus a fresh readable nonempty report as completed
   evidence; read its status and findings from the Markdown file. Do not accept
   stdout, progress, silence, or a report file paired with another exit class.
8. Treat exit two as an invocation defect, exit 130 as cancellation, and exit
   three or another abnormal termination as an operational failure. Treat a
   missing, unreadable, or empty output file as incomplete rather than green,
   yellow, or red evidence.
9. Preserve stderr and exit status. Retry an operationally failed or incomplete
   run once after process exit with the same frozen target and a new attempt
   output path. Do not retry cancellation automatically.
10. Correct deterministic or coherent findings directly when intent is clear;
   return material ambiguity, conflict, or future-risk decisions to
   DesignConversation.
11. After each resulting semantic write, repeat validation and compilation.
12. Permit yellow evidence only after the human reviews every finding and
   explicitly accepts each one as nonblocking for the exact scope.
13. Treat green or reviewed yellow as evidence for the exact written state,
    never as implementation approval.
14. Require written evidence to be green or reviewed yellow before glossary
    extraction or implementation review.
15. Require `ReviewGate(action: implementation)` over validated written Sigil
    and the exact implementation scope before implementation mutation.
