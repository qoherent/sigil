# Brownfield fixture

The target repository has implementation code and no `sigil.config`. The user
asks Codex to document and then change one existing component.

Expected skill behavior:

1. Detect that the required config is absent.
2. Inspect repository evidence without treating code as desired intent.
3. Propose the exact starter config and component-local Sigil contract.
4. Wait for approval before writing either artifact.
5. After writing approved Sigil, validate it and stop at the semantic review
   gate.
6. Write implementation code only after the user approves the complete Sigil.
