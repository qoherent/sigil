<!-- @sigil uses packages/compiler/_module.sigil::SigilCompiler::Compiler interface -->

# @qoherent/sigil-compiler

Agentic, profile-scoped evaluation for Sigil workspaces.

This package owns compilation reports, event streaming, evaluation profiles, and
code-agent adapters. It never modifies the selected workspace. Evaluation skills
are loaded from their packaged `SKILL.md` and `compile.json` files.

Agentic stages pass the workspace root, selected target, and complete initial
retrieval result to a selected CLI adapter. The initial request is only a
transport boundary: an adapter may read additional workspace files. The report
retains available structured observations without inventing missing progress,
usage, cost, or budget telemetry.

CompilationReport version 2 attaches a required `semanticSubjects` array to
every diagnostic. Compiler-verified subjects identify the governing Sigil
component, component or expand owner, section, optional concept, and optional
normalized semantic-unit fingerprint. Physical source locations remain available
for editors and evidence display.

A provider identity is an opaque identifier declared by its adapter package.
Adapters are supplied by the host and selected by provider, stable
implementation identifier, exact implementation version, and optional model.
This package owns no provider implementation: Codex, Claude, OpenCode, and Pi
each ship as a separate `@qoherent/sigil-compiler-adapter-*` package that the
CLI registers, and the compiler depends on none of them.

Adapter capability and observability declarations are self-reported metadata,
not verified guarantees. Selecting or supplying an adapter accepts the risk that
its implementation, plugins, tools, or provider CLI may not preserve requested
filesystem, network, approval, persistence, or data-handling restrictions. The
compiler intentionally places this warning only in documentation; it does not
inject it into logs, events, reports, diagnostics, status, or evaluator prompts.

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

The legacy `tools.compile.adapter` remains the standard profile's default
evaluator. Independent evaluator groups are optional:

```json
{
  "tools": {
    "compile": {
      "evaluators": {
        "primary": {
          "provider": "example",
          "implementationId": "example-plugin.example-cli",
          "implementationVersion": "0.7.1"
        },
        "reviewer": {
          "provider": "opencode",
          "implementationId": "my-plugin.opencode-cli",
          "implementationVersion": "2.4.0",
          "model": "another-model"
        }
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
retention. `limits.providerCleanupMs` bounds each graceful and forced provider
cleanup phase and defaults to 5000 milliseconds. Omitted fields retain the
backward-compatible defaults.
