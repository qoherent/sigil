# @qoherent/sigil-compiler

Agentic, profile-scoped evaluation for Sigil workspaces.

This package owns compilation reports, event streaming, evaluation profiles, and
code-agent adapters. It never modifies the selected workspace. Evaluation skills
are loaded from their packaged `SKILL.md` and `compile.json` files.

Agentic stages pass the workspace root and selected target to the agent, which
inspects Sigil and implementation files directly inside an ephemeral, offline,
read-only sandbox. Repository contents are not serialized into the initial
prompt. The report retains structured command and usage traces, not hidden
reasoning or complete file contents.

CompilationReport version 2 attaches a required `semanticSubjects` array to
every diagnostic. Compiler-verified subjects identify the governing Sigil
component, component or expand owner, section, optional concept, and optional
normalized semantic-unit fingerprint. Physical source locations remain available
for editors and evidence display.

Codex currently provides the enforceable direct-read capability mapping. Claude
configuration fails closed until its installed CLI can prove equivalent
read-only workspace and ephemeral-state controls. Compilation does not generate
code or execute implementation experiments.

Run a complete profile or one stage plus its dependency closure:

```sh
sigil compile .
sigil compile semantic-readiness .
sigil compile architecture-design . --component SigilCompiler
sigil compile . --file packages/compiler/src/compiler.sigil --position 40:3
```

An exact stage identifier in the first operand position selects a stage. Prefix
a colliding path with `./` to treat it as a path.

File targets include components declared in the file and expansions collected
from it. Adding a one-based `--position line:column` selects only the component
or expansion enclosing that exact location.

<!--
@sigil uses packages/compiler/src/profile.sigil::SigilCompilationProfile::CompilationProfile interface
@sigil uses packages/compiler/src/adapter.sigil::SigilAgentAdapter::ModelBinding constraints,cases
-->

The legacy `tools.compile.adapter` remains the standard profile's default
evaluator. It and each independent evaluator select `codex`, `claude`,
`opencode`, or `pi`, with an optional opaque provider-native `model`:

```json
{
  "tools": {
    "compile": {
      "evaluators": {
        "primary": {
          "provider": "opencode",
          "model": "anthropic/claude-sonnet-4-5"
        },
        "reviewer": { "provider": "pi", "model": "openai/gpt-5" }
      },
      "profiles": {
        "critical-system": {
          "evaluatorIds": ["primary", "reviewer"]
        }
      }
    }
  }
}
```

An omitted model delegates selection to that provider CLI. The compiler does not
discover model catalogs, rewrite identifiers, or fall back to another model.
Provider and model selections are included in the effective-profile fingerprint.
OpenCode runs in pure JSON mode with isolated state. Pi runs without sessions or
discovered extensions using only its read-only tools inside adapter-owned
process isolation. Codex uses its native read-only sandbox. These stock mappings
run directly without a host-supplied authorization callback. Provider-native
controls deny mutation and agent-network effects before launch; emitted
operations are validated during settlement. `maxCommands` is enforced when an
operation-start event is observed, so an over-limit read-only operation may
already have begun before the provider is terminated and the complete evaluation
is discarded.

Critical-system configuration is not required to load or compile a workspace
with another profile. Selecting a critical-system profile requires at least two
distinct, available evaluator identities; otherwise the run ends with
`COMPILER_PROFILE_EVALUATORS_REQUIRED`. Material differences in error or warning
findings produce `COMPILER_EVALUATOR_DISAGREEMENT`.

Completed runs may use a host-provided history store to classify diagnostic
lifecycle as new, unchanged, resolved, or regressed. History is compatible only
for the same workspace, target, report version, and effective profile. Corrupt
or incompatible entries are ignored.

Execution budgets, validation ceilings, request limits, and proposal-session
retention are configurable under `tools.compile`:

```json
{
  "tools": {
    "compile": {
      "budgets": {
        "elapsedTimeMs": 180000,
        "maxCommands": 64,
        "maxCommandOutputChars": 500000,
        "maxInputTokens": 200000,
        "maxOutputTokens": 200000
      },
      "limits": {
        "maxCompilationRequestChars": 1000000,
        "maxAgentInputChars": 1000000,
        "sessionTtlMs": 86400000
      }
    }
  }
}
```

Every value must be a positive safe integer. `budgets` selects effective
execution values and `limits` controls request size and proposal-session
retention. Omitted fields retain the backward-compatible defaults.
