import type {
  AgentProvider,
  CompileConfiguration,
} from "@qoherent/sigil-compiler";
import { CodexAdapter } from "@qoherent/sigil-compiler-adapter-codex";
import { OpenCodeAdapter } from "@qoherent/sigil-compiler-adapter-opencode";
import { PiAdapter } from "@qoherent/sigil-compiler-adapter-pi";
import { ClaudeAdapter } from "@qoherent/sigil-compiler-adapter-claude";
import type { SigilConfig, SigilDiagnosticCode } from "@qoherent/sigil-core";

export type ToolsObject = SigilConfig["tools"];

export interface ConfigAuthoringError {
  readonly code: SigilDiagnosticCode;
  readonly message: string;
}

export type ConfigAuthoringOutcome =
  | { readonly tools: ToolsObject }
  | { readonly error: ConfigAuthoringError };

export interface SetDefaultInput {
  readonly profileName: string;
  readonly agentProfileName?: string;
}

export interface SetProfileInput {
  readonly profileName: string;
  readonly extendsProfile?: string;
  readonly main?: readonly string[];
  readonly stages?: Readonly<Record<string, readonly string[]>>;
  readonly disabledStages?: readonly string[];
  readonly newEvaluators?: Readonly<Record<string, string>>;
  readonly models?: Readonly<Record<string, string>>;
  readonly implementationIds?: Readonly<Record<string, string>>;
  readonly implementationVersions?: Readonly<Record<string, string>>;
}

// @sigil implements packages/cli/src/config-authoring.sigil::SigilConfigAuthoring::SeededDefaults interface,logic,cases
export function seededToolConfiguration(): ToolsObject {
  const codex = new CodexAdapter();
  const claude = new ClaudeAdapter();
  const opencode = new OpenCodeAdapter();
  const pi = new PiAdapter();
  const compile: CompileConfiguration = {
    defaultProfile: "standard",
    budgets: {
      elapsedTimeMs: 3_000_000,
      maxCommands: 512,
      maxCommandOutputChars: 3_000_000,
      maxInputTokens: 4_000_000,
      maxOutputTokens: 4_000_000,
    },
    limits: {
      maxCompilationRequestChars: 2_000_000,
      maxAgentInputChars: 2_000_000,
      sessionTtlMs: 86_400_000,
    },
    evaluators: {
      codex: {
        provider: codex.provider,
        implementationId: codex.implementationId,
        implementationVersion: codex.implementationVersion,
      },
      claude: {
        provider: claude.provider,
        implementationId: claude.implementationId,
        implementationVersion: claude.implementationVersion,
      },
      opencode: {
        provider: opencode.provider,
        implementationId: opencode.implementationId,
        implementationVersion: opencode.implementationVersion,
      },
      pi: {
        provider: pi.provider,
        implementationId: pi.implementationId,
        implementationVersion: pi.implementationVersion,
      },
    },
    profiles: {
      standard: { main: ["codex"] },
      claude: { extends: "standard", main: ["claude"] },
      opencode: { extends: "standard", main: ["opencode"] },
      pi: { extends: "standard", main: ["pi"] },
    },
  };
  return {
    agent: { profile: "standard" },
    compile: compile as unknown as Record<string, unknown>,
  };
}

// @sigil implements packages/cli/src/config-authoring.sigil::SigilConfigAuthoring::DefaultProfileAssignment interface,logic,cases
export function applySetDefault(
  tools: ToolsObject,
  input: SetDefaultInput,
): ConfigAuthoringOutcome {
  const compile = compileConfigurationOf(tools);
  const agentProfileName = input.agentProfileName ?? input.profileName;
  for (const name of new Set([input.profileName, agentProfileName])) {
    if (!isKnownProfile(name, compile)) {
      return error(
        "SIGIL_CONFIG_UNKNOWN_PROFILE",
        `Unknown compilation profile "${name}".`,
      );
    }
  }
  return {
    tools: {
      ...tools,
      agent: { ...recordOf(tools.agent), profile: agentProfileName },
      compile: {
        ...compile,
        defaultProfile: input.profileName,
      } as unknown as Record<string, unknown>,
    },
  };
}

// @sigil implements packages/cli/src/config-authoring.sigil::SigilConfigAuthoring::ProfileAuthoring interface,logic,cases
export function applySetProfile(
  tools: ToolsObject,
  input: SetProfileInput,
): ConfigAuthoringOutcome {
  const compile = compileConfigurationOf(tools);
  const existingEvaluators = { ...(compile.evaluators ?? {}) };
  const declaredIds = new Set(Object.keys(input.newEvaluators ?? {}));

  if (
    input.extendsProfile !== undefined &&
    input.extendsProfile !== "standard" &&
    input.extendsProfile !== "critical-system"
  ) {
    return error(
      "SIGIL_CONFIG_UNKNOWN_PROFILE",
      `--extends must be standard or critical-system, got "${input.extendsProfile}".`,
    );
  }

  if (input.main !== undefined && input.main.length === 0) {
    return error(
      "SIGIL_CONFIG_UNKNOWN_EVALUATOR",
      "--main requires at least one evaluatorId.",
    );
  }
  for (const [stageId, evaluatorIds] of Object.entries(input.stages ?? {})) {
    if (evaluatorIds.length === 0) {
      return error(
        "SIGIL_CONFIG_UNKNOWN_EVALUATOR",
        `--stage ${stageId} requires at least one evaluatorId.`,
      );
    }
  }

  const stageIds = new Set(Object.keys(input.stages ?? {}));
  for (const disabledStage of input.disabledStages ?? []) {
    if (stageIds.has(disabledStage)) {
      return error(
        "SIGIL_CONFIG_STAGE_CONFLICT",
        `Stage "${disabledStage}" is named by both --stage and --disable-stage in the same invocation.`,
      );
    }
  }

  const referencedIds = new Set<string>([
    ...(input.main ?? []),
    ...Object.values(input.stages ?? {}).flat(),
    ...Object.keys(input.models ?? {}),
    ...Object.keys(input.implementationIds ?? {}),
    ...Object.keys(input.implementationVersions ?? {}),
  ]);
  for (const id of referencedIds) {
    if (!declaredIds.has(id) && !(id in existingEvaluators)) {
      return error(
        "SIGIL_CONFIG_UNKNOWN_EVALUATOR",
        `Evaluator "${id}" is not configured; declare it with --evaluator.`,
      );
    }
  }

  for (const [id, provider] of Object.entries(input.newEvaluators ?? {})) {
    if (!isAgentProvider(provider)) {
      return error(
        "SIGIL_CONFIG_UNKNOWN_PROVIDER",
        `Evaluator "${id}" names unsupported provider "${provider}"; expected codex, claude, opencode, or pi.`,
      );
    }
    const existing = existingEvaluators[id] as
      | { readonly provider?: unknown }
      | undefined;
    if (
      existing && existing.provider !== undefined &&
      existing.provider !== provider
    ) {
      return error(
        "SIGIL_CONFIG_EVALUATOR_PROVIDER_CONFLICT",
        `Evaluator "${id}" is already configured with provider "${
          String(existing.provider)
        }".`,
      );
    }
  }

  const mergedEvaluators: Record<string, Record<string, unknown>> = {
    ...existingEvaluators,
  };
  for (const [id, provider] of Object.entries(input.newEvaluators ?? {})) {
    mergedEvaluators[id] = { ...recordOf(mergedEvaluators[id]), provider };
  }
  for (const [id, model] of Object.entries(input.models ?? {})) {
    mergedEvaluators[id] = { ...recordOf(mergedEvaluators[id]), model };
  }
  for (const [id, value] of Object.entries(input.implementationIds ?? {})) {
    mergedEvaluators[id] = {
      ...recordOf(mergedEvaluators[id]),
      implementationId: value,
    };
  }
  for (
    const [id, value] of Object.entries(input.implementationVersions ?? {})
  ) {
    mergedEvaluators[id] = {
      ...recordOf(mergedEvaluators[id]),
      implementationVersion: value,
    };
  }

  const existingProfile = compile.profiles?.[input.profileName] ?? {};
  const stageIdsToEnable = new Set(Object.keys(input.stages ?? {}));
  const disabledStages = [
    ...(existingProfile.disabledStages ?? []).filter((stageId) =>
      !stageIdsToEnable.has(stageId)
    ),
    ...(input.disabledStages ?? []),
  ];
  const mergedProfile = {
    ...existingProfile,
    ...(input.extendsProfile !== undefined
      ? { extends: input.extendsProfile as "standard" | "critical-system" }
      : {}),
    ...(input.main !== undefined ? { main: input.main } : {}),
    ...(input.stages !== undefined
      ? { stages: { ...existingProfile.stages, ...input.stages } }
      : {}),
    ...(input.disabledStages !== undefined ||
        (input.stages !== undefined &&
          existingProfile.disabledStages !== undefined)
      ? {
        disabledStages: [...new Set(disabledStages)],
      }
      : {}),
  };

  return {
    tools: {
      ...tools,
      compile: {
        ...compile,
        evaluators: mergedEvaluators,
        profiles: {
          ...(compile.profiles ?? {}),
          [input.profileName]: mergedProfile,
        },
      } as unknown as Record<string, unknown>,
    },
  };
}

function isAgentProvider(value: string): value is AgentProvider {
  return value === "codex" || value === "claude" || value === "opencode" ||
    value === "pi";
}

function isKnownProfile(name: string, compile: CompileConfiguration): boolean {
  return name === "standard" || name === "critical-system" ||
    Boolean(compile.profiles?.[name]);
}

function compileConfigurationOf(tools: ToolsObject): CompileConfiguration {
  return (tools.compile as CompileConfiguration | undefined) ?? {};
}

function recordOf(
  value: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return { ...(value ?? {}) };
}

function error(
  code: SigilDiagnosticCode,
  message: string,
): { readonly error: ConfigAuthoringError } {
  return { error: { code, message } };
}
