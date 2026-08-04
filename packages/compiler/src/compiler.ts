import {
  type ImplementationEvidenceInput,
  type ImplementationSource,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  type ResolvedComponent,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  retrievePurposeContext,
  type SigilDiagnostic,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import metadata from "../deno.json" with { type: "json" };
import {
  resolveAgentAdapter,
  validModelIdentifier,
} from "./adapter-registry.ts";
import { FINDINGS_SCHEMA } from "./adapter-runtime.ts";
import { compilationEvaluationTarget } from "./evaluation.ts";
import { createCompilationEventStream } from "./event-protocol.ts";
import { compilationHistoryKey } from "./history.ts";
import { exportCompilationReport } from "./report-export.ts";
import { constructCompilationReport } from "./report-protocol.ts";
import {
  COMPILER_AGENT_CAPABILITIES,
  stageForCompilationFocus,
} from "./profile.ts";
import {
  CompilerFailure,
  compilerFailureCode as stableCompilerFailureCode,
} from "./status.ts";
import {
  COMPILATION_STAGE_IDS,
  type EvaluationSkillPackage,
  loadEvaluationSkills,
} from "./evaluation-skills.ts";
import {
  createSemanticSubjectResolver,
  semanticSubjectIdentity,
  type SemanticSubjectResolver,
} from "./semantic-subjects.ts";
import type {
  AgentAdapter,
  AgentExecutionBudgets,
  AgentFinding,
  CompilationLimits,
  CompilationReport,
  CompilationTarget,
  CompileConfiguration,
  CompileOptions,
  CompilerDiagnostic,
  EffectiveProfile,
  EvaluatorConfiguration,
  StageReport,
} from "./types.ts";

interface StageDefinition {
  readonly id: string;
  readonly required: boolean;
  readonly agentic: boolean;
  readonly dependencies: readonly string[];
  readonly skill?: EvaluationSkillPackage;
}

const DEFAULT_EXECUTION_BUDGETS = {
  elapsedTimeMs: 1_800_000,
  maxCommands: 512,
  maxCommandOutputChars: 3_000_000,
  maxInputTokens: 1_000_000,
  maxOutputTokens: 1_000_000,
} as const;
const DEFAULT_LIMITS: CompilationLimits = {
  maxCompilationRequestChars: 1_000_000,
  maxAgentInputChars: 1_000_000,
  sessionTtlMs: 86_400_000,
};
class DenoReadOnlyFileSystem implements SigilFileSystem {
  readTextFile(path: string): Promise<string> {
    return Deno.readTextFile(path);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }
  async listFiles(root: string): Promise<readonly string[]> {
    const files: string[] = [];
    async function visit(path: string): Promise<void> {
      const stat = await Deno.stat(path);
      if (stat.isFile) {
        files.push(path.replaceAll("\\", "/"));
        return;
      }
      if (!stat.isDirectory) return;
      for await (const entry of Deno.readDir(path)) {
        if (
          entry.isSymlink ||
          [".git", ".deno", ".vscode-test", "node_modules", "build", "coverage"]
            .includes(entry.name)
        ) continue;
        await visit(`${path}/${entry.name}`);
      }
    }
    await visit(root);
    return files.sort();
  }
}

export async function loadCompilationConfiguration(
  startPath: string,
): Promise<CompileConfiguration> {
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath,
  });
  return parseConfiguration(workspace.config?.tools.compile);
}

// @sigil implements packages/compiler/_module.sigil::SigilCompiler interface,logic,constraints,cases
export async function compile(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const requestedStage = options.requestedStage ??
    stageForCompilationFocus(options.focus);
  const cancellationSignal = options.cancellationSignal ?? options.signal;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const eventStream = createCompilationEventStream(runId, options.onEvent);
  const emit = eventStream.emit;
  await emit("started", {
    workspacePath,
    target,
    requestedStage,
    focus: options.focus,
  });

  try {
    if (options.requestedStage && options.focus) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "requestedStage and focus are mutually exclusive.",
      );
    }
    const fs = new DenoReadOnlyFileSystem();
    const workspace = await loadSigilWorkspace(fs, {
      startPath: workspacePath,
      currentDirectory: Deno.cwd(),
    });
    const resolved = resolveSigilWorkspace(workspace);
    const configuration = parseConfiguration(workspace.config?.tools.compile);
    const skills = await loadEvaluationSkills();
    const definitions = stageDefinitions(skills);
    const profile = await effectiveProfile(
      options.profile ?? configuration.defaultProfile ?? "standard",
      configuration,
      definitions,
      requestedStage,
    );
    const adapters = adaptersFrom(profile, options);
    assertProfileEvaluators(profile, adapters);
    const components = resolveTarget(resolved, target, workspace.root);
    const implementationSources = await loadImplementationSources(
      fs,
      workspace.root,
    );
    const sourceFingerprint = await workspaceEvidenceFingerprint(
      workspace.root,
      workspace.files.map((file) => file.document),
      implementationSources,
    );
    const semanticSubjects = createSemanticSubjectResolver(
      resolved,
      implementationSources,
      workspace.root,
    );

    const diagnostics: CompilerDiagnostic[] = await Promise.all(
      resolved.diagnostics.map((item) =>
        fromCoreDiagnostic(item, semanticSubjects)
      ),
    );
    const stageReports: StageReport[] = [];
    const failed = new Set<string>();
    const evaluatorLabel = adapters.map((item) => item.id).join(",") ||
      "unavailable";

    for (const stage of profile.stages) {
      const definition = definitions.find((item) => item.id === stage.id)!;
      if (!stage.enabled) {
        failed.add(stage.id);
        stageReports.push(stageReport(stage, "disabled", "none", 0));
        continue;
      }
      if (stage.dependencies.some((dependency) => failed.has(dependency))) {
        failed.add(stage.id);
        stageReports.push(
          stageReport(
            stage,
            "skipped-by-dependency",
            evaluatorLabel,
            0,
          ),
        );
        continue;
      }
      if (cancellationSignal?.aborted) {
        throw new DOMException("Compilation cancelled.", "AbortError");
      }

      const stageStartedAt = new Date().toISOString();
      await emit("stage-started", { stage: stage.id });
      const before = diagnostics.length;
      const evaluations: NonNullable<StageReport["evaluations"]>[number][] = [];
      let state: StageReport["state"] = "completed";
      try {
        if (definition.agentic) {
          if (!adapters.length) {
            throw new Error(
              "No compiler evaluator is configured for the selected profile.",
            );
          }
          if (!definition.skill) {
            throw new Error(`Evaluation skill ${stage.id} is unavailable.`);
          }
          for (const adapter of adapters) assertAdapterCapabilities(adapter);
          for (const component of components) {
            const retrievalPurpose =
              definition.skill.manifest.implementationEvidence === "compare"
                ? "implementation"
                : stage.id === "semantic-readiness"
                ? "semantic"
                : "architecture";
            const implementationEvidence: ImplementationEvidenceInput = {
              workspaceSnapshotIdentity:
                resolved.workspace.workspaceSnapshotIdentity,
              discoveryState: "complete",
              sources: implementationSources,
              diagnostics: [],
            };
            const retrieval = await retrievePurposeContext(
              resolved,
              {
                kind: "component",
                componentName: component.name,
                path: canonicalWorkspacePath(
                  component.filePath,
                  workspace.root,
                ),
              },
              retrievalPurpose,
              resolved.glossary,
              retrievalPurpose === "implementation"
                ? implementationEvidence
                : null,
            );
            const request = {
              stage: stage.id,
              skill: definition.skill.guidance,
              allowedRules: definition.skill.manifest.rules,
              implementationEvidence:
                definition.skill.manifest.implementationEvidence,
              workspaceAccess: {
                kind: "snapshot-read-only" as const,
                agentRoot: workspace.root,
                workspaceSnapshotIdentity:
                  resolved.workspace.workspaceSnapshotIdentity,
              },
              target: compilationEvaluationTarget(
                component,
                workspace.root,
                retrieval,
              ),
              retrieval,
              outputSchema: FINDINGS_SCHEMA,
              capabilities: profile.capabilities,
              budgets: profile.executionBudgets,
              maxInputChars: profile.agentInputBudgetChars,
              signal: cancellationSignal,
            };
            const requestSize = JSON.stringify(request, (_key, value) =>
              value instanceof AbortSignal ? undefined : value).length;
            if (requestSize > profile.contextBudgetChars) {
              throw new Error(
                `Evaluation request for ${component.name} is ${requestSize} characters, exceeding the ${profile.contextBudgetChars}-character budget.`,
              );
            }
            const componentDiagnostics: CompilerDiagnostic[][] = [];
            for (const adapter of adapters) {
              const result = await adapter.evaluate(request);
              evaluations.push({
                evaluatorId: adapter.id,
                componentName: component.name,
                commands: result.commands,
                usage: result.usage,
                configuredModel: result.configuredModel,
                resolvedModel: result.resolvedModel,
              });
              const evaluatorDiagnostics: CompilerDiagnostic[] = [];
              for (const finding of result.findings) {
                if (!definition.skill.manifest.rules.includes(finding.code)) {
                  throw new Error(
                    `Evaluator returned undeclared rule ${
                      JSON.stringify(finding.code)
                    } for stage ${stage.id}.`,
                  );
                }
                const diagnostic = await fromAgentFinding(
                  stage.id,
                  definition.skill,
                  adapter,
                  finding,
                  component.name,
                  semanticSubjects,
                );
                evaluatorDiagnostics.push(diagnostic);
                diagnostics.push(diagnostic);
                await emit("diagnostic", {
                  componentName: component.name,
                  diagnostic,
                });
              }
              componentDiagnostics.push(evaluatorDiagnostics);
            }
            for (
              const diagnostic of await disagreementDiagnostics(
                stage.id,
                component.name,
                adapters,
                componentDiagnostics,
              )
            ) {
              diagnostics.push(diagnostic);
              await emit("diagnostic", {
                componentName: component.name,
                diagnostic,
              });
            }
          }
        }
      } catch (error) {
        if (profile.criticalSystem && definition.agentic) {
          throw profileEvaluatorError(
            `A required critical-system evaluator is unavailable or incomplete: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        state = "failed";
        failed.add(stage.id);
        const diagnostic = await stageFailure(stage.id, adapters[0], error);
        diagnostics.push(diagnostic);
        await emit("diagnostic", { diagnostic });
      }
      const report: StageReport = {
        id: stage.id,
        required: stage.required,
        state,
        evaluator: stage.agentic ? evaluatorLabel : "sigil-core",
        diagnosticCount: diagnostics.length - before,
        startedAt: stageStartedAt,
        completedAt: new Date().toISOString(),
        ...(evaluations.length ? { evaluations } : {}),
      };
      stageReports.push(report);
      await emit("stage-completed", { stage: report });
    }

    const historyDisabled = options.disableHistory ?? options.noHistory ??
      false;
    const historyKey = options.history && !historyDisabled
      ? await compilationHistoryKey(workspace.root, target, profile)
      : undefined;
    let previous: CompilationReport | undefined;
    if (historyKey) {
      try {
        previous = await options.history!.read(historyKey);
      } catch (error) {
        await deliverHistoryWarning(options, {
          code: "COMPILER_HISTORY_READ_FAILED",
          operation: "read",
          historyKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const report = constructCompilationReport({
      runId,
      workspaceRoot: workspace.root,
      target,
      componentNames: components.map((item) => item.name),
      startedAt,
      completedAt: new Date().toISOString(),
      sourceFingerprint,
      requestedStage,
      focus: options.focus,
      profile,
      stages: stageReports,
      diagnostics,
      previous,
    });
    const exportDestination = options.reportExport ?? options.output;
    if (cancellationSignal?.aborted) {
      throw new DOMException("Compilation cancelled.", "AbortError");
    }
    if (exportDestination) {
      await exportCompilationReport(report, exportDestination, workspace.root);
    }
    await emit("completed", { report });
    if (historyKey) {
      try {
        await options.history!.write(historyKey, report);
      } catch (error) {
        await deliverHistoryWarning(options, {
          code: "COMPILER_HISTORY_WRITE_FAILED",
          operation: "write",
          historyKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return report;
  } catch (error) {
    const type = error instanceof DOMException && error.name === "AbortError"
      ? "cancelled"
      : "failed";
    const code = stableCompilerFailureCode(error);
    try {
      await emit(type, {
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // The event consumer failed, so no further terminal delivery is possible.
    }
    throw error;
  }
}

async function deliverHistoryWarning(
  options: CompileOptions,
  warning: Parameters<NonNullable<CompileOptions["hostWarningSink"]>>[0],
): Promise<void> {
  try {
    await options.hostWarningSink?.(warning);
  } catch {
    // History warnings and their optional delivery remain non-authoritative.
  }
}

function stageDefinitions(
  skills: ReadonlyMap<string, EvaluationSkillPackage>,
): readonly StageDefinition[] {
  return COMPILATION_STAGE_IDS.map((id) => {
    if (id === "deterministic-foundation") {
      return {
        id,
        required: true,
        agentic: false,
        dependencies: [],
      };
    }
    const skill = skills.get(id);
    if (!skill) throw new Error(`Required evaluation skill ${id} is missing.`);
    return {
      id,
      required: true,
      agentic: true,
      dependencies: skill.manifest.dependencies,
      skill,
    };
  });
}

function assertAdapterCapabilities(adapter: AgentAdapter): void {
  if (
    !adapter.capabilities.readOnlyWorkspace ||
    adapter.capabilities.network !== false ||
    adapter.capabilities.approvalEscalation !== false ||
    !adapter.capabilities.ephemeral
  ) {
    throw new Error(
      `Adapter ${adapter.id} cannot enforce read-only, offline, approval-free, ephemeral workspace inspection.`,
    );
  }
}

function stageReport(
  stage: EffectiveProfile["stages"][number],
  state: StageReport["state"],
  evaluator: string,
  diagnosticCount: number,
): StageReport {
  return {
    id: stage.id,
    required: stage.required,
    state,
    evaluator,
    diagnosticCount,
  };
}

function parseConfiguration(value: unknown): CompileConfiguration {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tools.compile must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.budgets !== undefined) validateConfiguredBudgets(raw.budgets);
  if (raw.limits !== undefined) validateConfiguredLimits(raw.limits);
  return raw as unknown as CompileConfiguration;
}

function validateConfiguredLimits(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tools.compile.limits must be an object.");
  }
  const known = new Set(Object.keys(DEFAULT_LIMITS));
  for (const [name, configured] of Object.entries(value)) {
    if (!known.has(name)) {
      throw new Error(
        `tools.compile.limits contains unknown field ${JSON.stringify(name)}.`,
      );
    }
    if (!Number.isSafeInteger(configured) || (configured as number) <= 0) {
      throw new Error(
        `tools.compile.limits.${name} must be a positive safe integer.`,
      );
    }
  }
}

function validateConfiguredBudgets(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tools.compile.budgets must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const known = new Set(Object.keys(DEFAULT_EXECUTION_BUDGETS));
  for (const [name, configured] of Object.entries(raw)) {
    if (!known.has(name)) {
      throw new Error(
        `tools.compile.budgets contains unknown field ${JSON.stringify(name)}.`,
      );
    }
    if (
      !Number.isSafeInteger(configured) ||
      (configured as number) <= 0
    ) {
      throw new Error(
        `tools.compile.budgets.${name} must be a positive safe integer.`,
      );
    }
  }
}

export function resolveCompilationSettings(
  configuration: CompileConfiguration,
): {
  readonly budgets: AgentExecutionBudgets;
  readonly limits: CompilationLimits;
} {
  const budgets = { ...DEFAULT_EXECUTION_BUDGETS, ...configuration.budgets };
  validateConfiguredBudgets(budgets);
  const limits = { ...DEFAULT_LIMITS, ...configuration.limits };
  validateConfiguredLimits(limits);
  return { budgets, limits };
}

async function effectiveProfile(
  name: string,
  configuration: CompileConfiguration,
  definitions: readonly StageDefinition[],
  requestedStage?: string,
): Promise<EffectiveProfile> {
  const custom = configuration.profiles?.[name];
  const base = custom?.extends ?? name;
  if (base !== "standard" && base !== "critical-system") {
    throw new Error(`Unknown compilation profile ${JSON.stringify(name)}.`);
  }
  const included = base === "standard"
    ? definitions.filter((stage) => stage.id !== "standards-risk")
    : definitions;
  const disabled = new Set(custom?.disabledStages ?? []);
  const selected = requestedStage
    ? stageClosure(requestedStage, included)
    : included;
  if (requestedStage && selected.some((stage) => disabled.has(stage.id))) {
    throw new Error(
      `Requested stage ${
        JSON.stringify(requestedStage)
      } depends on a stage disabled by profile ${JSON.stringify(name)}.`,
    );
  }
  const stages = selected.map((stage) => ({
    id: stage.id,
    required: stage.required,
    enabled: !disabled.has(stage.id),
    agentic: stage.agentic,
    dependencies: stage.dependencies,
  }));
  const evaluators = selectedEvaluators(name, base, custom, configuration);
  const settings = resolveCompilationSettings(configuration);
  const profileBase = {
    name,
    criticalSystem: base === "critical-system",
    contextBudgetChars: settings.limits.maxCompilationRequestChars,
    agentInputBudgetChars: settings.limits.maxAgentInputChars,
    limits: settings.limits,
    executionBudgets: settings.budgets,
    capabilities: COMPILER_AGENT_CAPABILITIES,
    stages,
    adapter: configuration.adapter,
    evaluators,
    skills: selected.flatMap((stage) =>
      stage.skill
        ? [{
          id: stage.skill.manifest.id,
          version: stage.skill.manifest.version,
          capabilities: stage.skill.manifest.capabilities,
        }]
        : []
    ),
  };
  return {
    name: profileBase.name,
    criticalSystem: profileBase.criticalSystem,
    contextBudgetChars: profileBase.contextBudgetChars,
    agentInputBudgetChars: profileBase.agentInputBudgetChars,
    limits: profileBase.limits,
    executionBudgets: profileBase.executionBudgets,
    capabilities: profileBase.capabilities,
    stages: profileBase.stages,
    adapter: profileBase.adapter,
    evaluators: profileBase.evaluators,
    fingerprint: await digest(JSON.stringify(profileBase)),
  };
}

/*
 * @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::ProfileConfiguration constraints
 * @sigil implements packages/compiler/src/profile.sigil::SigilCompilationProfile::ProviderModelSelection cases
 */
function selectedEvaluators(
  name: string,
  base: "standard" | "critical-system",
  custom: CompileConfiguration["profiles"] extends
    | Readonly<
      Record<string, infer T>
    >
    | undefined ? T | undefined
    : never,
  configuration: CompileConfiguration,
): readonly EvaluatorConfiguration[] {
  const configuredIds = custom?.evaluatorIds as unknown;
  if (
    configuredIds !== undefined &&
    (!Array.isArray(configuredIds) ||
      configuredIds.some((id) => typeof id !== "string" || !id))
  ) {
    throw evaluatorConfigurationError(
      base,
      `Profile ${
        JSON.stringify(name)
      } evaluatorIds must contain non-empty strings.`,
    );
  }
  const ids = (configuredIds as readonly string[] | undefined) ??
    (base === "standard" && configuration.adapter ? ["default"] : []);
  if (new Set(ids).size !== ids.length) {
    throw evaluatorConfigurationError(
      base,
      `Profile ${JSON.stringify(name)} selects duplicate evaluator identities.`,
    );
  }
  return ids.map((id) => {
    const raw = id === "default"
      ? configuration.adapter
      : configuration.evaluators?.[id];
    if (!raw || typeof raw !== "object") {
      throw evaluatorConfigurationError(
        base,
        `Profile ${JSON.stringify(name)} references unavailable evaluator ${
          JSON.stringify(id)
        }.`,
      );
    }
    const provider = (raw as Record<string, unknown>).provider;
    const model = (raw as Record<string, unknown>).model;
    if (!["codex", "claude", "opencode", "pi"].includes(String(provider))) {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${
          JSON.stringify(id)
        } must use provider codex, claude, opencode, or pi.`,
      );
    }
    if (model !== undefined && !validModelIdentifier(model)) {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${
          JSON.stringify(id)
        } model must be a non-empty provider-native identifier.`,
      );
    }
    return {
      id,
      provider: provider as "codex" | "claude" | "opencode" | "pi",
      ...(model !== undefined ? { model } : {}),
    };
  });
}

function stageClosure(
  requestedStage: string,
  available: readonly StageDefinition[],
): readonly StageDefinition[] {
  const requested = available.find((stage) => stage.id === requestedStage);
  if (!requested) {
    const known = COMPILATION_STAGE_IDS.includes(
        requestedStage as typeof COMPILATION_STAGE_IDS[number],
      )
      ? `Stage ${
        JSON.stringify(requestedStage)
      } is not enabled by this profile.`
      : `Unknown compilation stage ${JSON.stringify(requestedStage)}.`;
    throw new Error(known);
  }
  const selected = new Set<string>();
  const visit = (stage: StageDefinition): void => {
    for (const dependency of stage.dependencies) {
      const definition = available.find((item) => item.id === dependency);
      if (!definition) {
        throw new Error(
          `Stage ${stage.id} requires unavailable dependency ${dependency}.`,
        );
      }
      visit(definition);
    }
    selected.add(stage.id);
  };
  visit(requested);
  return available.filter((stage) => selected.has(stage.id));
}

// @sigil uses packages/compiler/src/adapter-registry.sigil::SigilAgentAdapterRegistry::AgentAdapterRegistry interface
function adaptersFrom(
  profile: EffectiveProfile,
  options: CompileOptions,
): readonly AgentAdapter[] {
  if (options.adapters) {
    return profile.evaluators.map((configuration) => {
      const adapter = options.adapters!.find((item) =>
        item.id === configuration.id
      );
      if (!adapter) {
        const message = `Selected evaluator ${
          JSON.stringify(configuration.id)
        } is unavailable.`;
        throw profile.criticalSystem
          ? profileEvaluatorError(message)
          : new Error(message);
      }
      return adapter;
    });
  }
  if (options.adapter) {
    if (profile.name === "critical-system") {
      return [options.adapter];
    }
    return [options.adapter];
  }
  return profile.evaluators.map((configuration) => {
    if (configuration.provider === "mock") {
      throw new Error("The mock provider must be supplied by the host.");
    }
    return resolveAgentAdapter(
      configuration.provider,
      configuration.model,
      configuration.id,
    );
  });
}

function assertProfileEvaluators(
  profile: EffectiveProfile,
  adapters: readonly AgentAdapter[],
): void {
  if (!profile.criticalSystem) return;
  const identities = new Set(adapters.map((item) => item.id));
  if (adapters.length < 2 || identities.size < 2) {
    throw profileEvaluatorError(
      "The critical-system profile requires at least two distinct available evaluator identities.",
    );
  }
  for (const adapter of adapters) {
    try {
      assertAdapterCapabilities(adapter);
    } catch (error) {
      throw profileEvaluatorError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function profileEvaluatorError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "COMPILER_PROFILE_EVALUATORS_REQUIRED",
  });
}

function evaluatorConfigurationError(
  base: "standard" | "critical-system",
  message: string,
): Error {
  return base === "critical-system"
    ? profileEvaluatorError(message)
    : new Error(message);
}

function resolveTarget(
  resolved: ResolvedSigilWorkspace,
  target: CompilationTarget,
  root: string,
): readonly ResolvedComponent[] {
  const selected = target.kind === "workspace"
    ? resolved.components
    : selectExplicitTarget(resolved.components, target, root);
  if (
    target.kind === "component" && !target.declarationPath &&
    selected.length > 1
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `Component target ${JSON.stringify(target.name)} is ambiguous.`,
    );
  }
  if (!selected.length) {
    const selector = target.kind === "component"
      ? target.name
      : target.kind === "workspace"
      ? ""
      : target.filePath;
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `No component matched ${target.kind}${
        target.kind === "workspace" ? "" : ` ${selector}`
      }.`,
    );
  }
  return dependencyOrder(resolved, selected);
}

function selectExplicitTarget(
  components: readonly ResolvedComponent[],
  target: Exclude<CompilationTarget, { readonly kind: "workspace" }>,
  root: string,
): readonly ResolvedComponent[] {
  if (target.kind === "component") {
    assertNormalizedTargetPath(target.declarationPath);
    return components.filter((item) =>
      item.name === target.name && (!target.declarationPath ||
        canonicalWorkspacePath(item.filePath, root) === target.declarationPath)
    );
  }
  assertNormalizedTargetPath(target.filePath);
  const file = canonicalWorkspacePath(target.filePath, root);
  if (target.kind === "file") {
    return components.filter((item) =>
      canonicalWorkspacePath(item.filePath, root) === file ||
      item.expansions.expands.some((expansion) =>
        canonicalWorkspacePath(expansion.filePath, root) === file
      )
    );
  }
  if (
    !Number.isSafeInteger(target.line) || target.line < 1 ||
    !Number.isSafeInteger(target.column) || target.column < 1
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "Location target line and column must be positive integers.",
    );
  }
  const location = { line: target.line, column: target.column };
  return components.filter((item) =>
    (canonicalWorkspacePath(item.filePath, root) === file &&
      rangeContains(item.declaration.range, location)) ||
    item.expansions.expands.some((expansion) =>
      canonicalWorkspacePath(expansion.filePath, root) === file &&
      rangeContains(expansion.declaration.range, location)
    )
  );
}

function assertNormalizedTargetPath(path: string | undefined): void {
  if (path === undefined) return;
  if (
    !path || path.startsWith("/") || path.startsWith("\\") ||
    path.includes("\\") || path.split("/").some((part) => part === "..") ||
    path.startsWith("./") || path.includes("//")
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `Compilation target path is not normalized and workspace-relative: ${
        JSON.stringify(path)
      }.`,
    );
  }
}

function rangeContains(
  range: {
    start: { line: number; column: number };
    end: {
      line: number;
      column: number;
    };
  },
  location: { line: number; column: number },
): boolean {
  const afterStart = location.line > range.start.line ||
    (location.line === range.start.line &&
      location.column >= range.start.column);
  const beforeEnd = location.line < range.end.line ||
    (location.line === range.end.line && location.column < range.end.column);
  return afterStart && beforeEnd;
}

function dependencyOrder(
  resolved: ResolvedSigilWorkspace,
  selected: readonly ResolvedComponent[],
): readonly ResolvedComponent[] {
  const selectedKeys = new Set(selected.map(componentKey));
  const ordered: ResolvedComponent[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (component: ResolvedComponent): void => {
    const key = componentKey(component);
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (
      const imported of resolved.imports.filter((item) =>
        item.sourceFile === component.filePath
      )
    ) {
      for (const name of imported.names) {
        const dependency = resolved.components.find((candidate) =>
          candidate.name === name.name &&
          candidate.filePath === name.componentFile
        );
        if (dependency && selectedKeys.has(componentKey(dependency))) {
          visit(dependency);
        }
      }
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(component);
  };
  for (const component of selected) visit(component);
  return ordered;
}

function componentKey(component: ResolvedComponent): string {
  return `${component.filePath}\0${component.name}`;
}

function canonicalWorkspacePath(path: string, root: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalizedRoot !== "." &&
    (normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`))
  ) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, "") || ".";
  }
  return normalized.replace(/^\.\//, "");
}

async function fromCoreDiagnostic(
  item: SigilDiagnostic,
  resolver: SemanticSubjectResolver,
): Promise<CompilerDiagnostic> {
  const semanticSubjects = await resolver.resolve(item.filePath, item.range);
  const fingerprint = await diagnosticFingerprint(
    item.code,
    "deterministic-foundation",
    semanticSubjects,
    item.filePath,
    item.range,
  );
  return {
    code: item.code,
    fingerprint,
    severity: item.severity === "error"
      ? "error"
      : item.severity === "warning"
      ? "warning"
      : "information",
    stage: "deterministic-foundation",
    skill: "sigil-core",
    message: item.message,
    filePath: item.filePath,
    range: item.range,
    semanticSubjects,
    evidence: item.message,
    impact: item.severity === "error"
      ? "The contract cannot complete deterministic evaluation."
      : "The compiler recorded a deterministic finding.",
    correction: "Resolve the referenced Sigil diagnostic.",
    evaluator: `sigil-core@${metadata.version}`,
    lifecycle: "new",
  };
}

async function fromAgentFinding(
  stage: string,
  skill: EvaluationSkillPackage,
  adapter: AgentAdapter,
  finding: AgentFinding,
  componentName: string,
  resolver: SemanticSubjectResolver,
): Promise<CompilerDiagnostic> {
  const range = finding.line
    ? {
      start: { line: finding.line, column: finding.column ?? 1 },
      end: { line: finding.line, column: (finding.column ?? 1) + 1 },
    }
    : undefined;
  const semanticSubjects = await resolver.resolve(
    finding.filePath,
    range,
    componentName,
  );
  return {
    code: finding.code,
    fingerprint: await diagnosticFingerprint(
      finding.code,
      stage,
      semanticSubjects,
      finding.filePath,
      range,
      componentName,
    ),
    severity: finding.severity,
    stage,
    skill: `${skill.manifest.id}@${skill.manifest.version}`,
    message: finding.message,
    filePath: finding.filePath,
    range,
    semanticSubjects,
    evidence: finding.evidence,
    impact: finding.impact,
    correction: finding.correction,
    evaluator: adapter.id,
    lifecycle: "new",
  };
}

async function disagreementDiagnostics(
  stage: string,
  componentName: string,
  adapters: readonly AgentAdapter[],
  results: readonly (readonly CompilerDiagnostic[])[],
): Promise<readonly CompilerDiagnostic[]> {
  if (new Set(adapters.map((item) => item.id)).size < 2) return [];
  const bySubject = new Map<
    string,
    { sample: CompilerDiagnostic; severities: Map<string, string> }
  >();
  for (let index = 0; index < adapters.length; index++) {
    for (
      const diagnostic of results[index].filter((item) =>
        item.severity === "error" || item.severity === "warning"
      )
    ) {
      const key = JSON.stringify({
        code: diagnostic.code,
        subjects: diagnostic.semanticSubjects.map(semanticSubjectIdentity),
        fallback: diagnostic.semanticSubjects.length ? undefined : {
          filePath: diagnostic.filePath,
          line: diagnostic.range?.start.line,
          column: diagnostic.range?.start.column,
        },
      });
      const entry = bySubject.get(key) ?? {
        sample: diagnostic,
        severities: new Map<string, string>(),
      };
      entry.severities.set(adapters[index].id, diagnostic.severity);
      bySubject.set(key, entry);
    }
  }
  const findings: CompilerDiagnostic[] = [];
  for (const [key, entry] of bySubject) {
    const signatures = adapters.map((adapter) =>
      entry.severities.get(adapter.id) ?? "absent"
    );
    if (new Set(signatures).size < 2) continue;
    findings.push({
      code: "COMPILER_EVALUATOR_DISAGREEMENT",
      fingerprint: await digest(
        `COMPILER_EVALUATOR_DISAGREEMENT:${stage}:${componentName}:${key}`,
      ),
      severity: "warning",
      stage,
      skill: "compiler-reconciliation",
      message:
        `Evaluators disagree on ${entry.sample.code} for ${componentName}.`,
      filePath: entry.sample.filePath,
      range: entry.sample.range,
      semanticSubjects: entry.sample.semanticSubjects,
      evidence: adapters.map((adapter, index) =>
        `${adapter.id}: ${signatures[index]}`
      ).join("; "),
      impact:
        "The critical-system evaluation does not provide independent agreement.",
      correction:
        "Review the cited semantic subject and reconcile evaluator evidence.",
      evaluator: adapters.map((item) => item.id).join(","),
      lifecycle: "new",
    });
  }
  return findings;
}

async function stageFailure(
  stage: string,
  adapter: AgentAdapter | undefined,
  error: unknown,
): Promise<CompilerDiagnostic> {
  return {
    code: "COMPILER_EVALUATOR_INCOMPLETE",
    fingerprint: await digest(`COMPILER_EVALUATOR_INCOMPLETE:${stage}`),
    severity: "information",
    stage,
    skill: stage,
    message: error instanceof Error ? error.message : String(error),
    semanticSubjects: [],
    evidence: "The required evaluator did not complete successfully.",
    impact: "This run cannot become green.",
    correction:
      "Configure an available read-only adapter or disable the stage in a project profile.",
    evaluator: adapter?.id ?? "unavailable",
    lifecycle: "new",
  };
}

function workspaceEvidenceFingerprint(
  root: string,
  sigilDocuments: readonly unknown[],
  implementation: readonly ImplementationSource[],
): Promise<string> {
  return digest(JSON.stringify({
    sigilDocuments,
    implementation: implementation.map((source) => ({
      filePath: canonicalWorkspacePath(source.filePath, root),
      text: source.text,
    })),
  }));
}

async function loadImplementationSources(
  fs: SigilFileSystem,
  root: string,
): Promise<readonly ImplementationSource[]> {
  return Promise.all(
    (await fs.listFiles(root))
      .filter(isSupportedImplementationSource)
      .map(async (filePath) => ({
        filePath,
        text: await fs.readTextFile(filePath),
      })),
  );
}

function diagnosticFingerprint(
  code: string,
  stage: string,
  semanticSubjects: readonly CompilerDiagnostic["semanticSubjects"][number][],
  filePath?: string,
  range?: CompilerDiagnostic["range"],
  componentName?: string,
): Promise<string> {
  return digest(JSON.stringify({
    code,
    stage,
    componentName,
    semanticSubjects: semanticSubjects.map(semanticSubjectIdentity),
    fallback: semanticSubjects.length ? undefined : {
      filePath,
      line: range?.start.line,
      column: range?.start.column,
    },
  }));
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
