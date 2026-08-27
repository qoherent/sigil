import {
  excludesWorkspacePath,
  type ImplementationEvidenceInput,
  type ImplementationSource,
  isSupportedImplementationSource,
  loadSigilWorkspace,
  resolveSigilWorkspace,
  retrievePurposeContext,
  type SigilConfig,
  type SigilDiagnostic,
  type SigilFileSystem,
} from "@qoherent/sigil-core";
import metadata from "../deno.json" with { type: "json" };
import { CodexAdapter, resolveAdapterRegistration } from "./adapters.ts";
import {
  capabilitiesMatch,
  evaluationCapabilitiesFor,
} from "./evaluation-capabilities.ts";
import {
  buildAgentEvaluationRequest,
  compilationEvaluationTarget,
} from "./evaluation.ts";
import {
  canonicalWorkspacePath,
  resolveCompilationTarget,
} from "./compilation-target.ts";
import {
  type CompilationEventWriter,
  openCompilationEventWriter,
  type WritableEnvelopeSink,
  type WriterResult,
} from "./event-writer.ts";
import { applyDiagnosticLifecycle, compilationHistoryKey } from "./history.ts";
import { exportCompilationReport } from "./report-export.ts";
import { constructCompilationReport } from "./report-protocol.ts";
import {
  parseCompilationConfiguration,
  resolveCompilationSettings,
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
import { validateAgentEvaluationResult } from "./evaluation-request.ts";
import {
  createSemanticSubjectResolver,
  semanticSubjectIdentity,
  type SemanticSubjectResolver,
} from "./semantic-subjects.ts";
import type {
  AgentAdapter,
  AgentFinding,
  CompilationFocus,
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

const INSPECTION_COMMAND_POLICY = {
  allowedCommands: [
    "sigil version",
    "sigil parse",
    "sigil check",
    "sigil fmt --check",
    "sigil glossary",
    "sigil graph",
    "sigil context",
    "sigil render",
    "rg",
    "sed",
    "git status/diff/show/log/grep/ls-files",
  ],
  forbiddenCommands: [
    "sigil init",
    "sigil fmt without --check",
    "sigil compile",
    "sigil skill install",
    "network clients",
    "file mutation",
    "code generation",
    "implementation execution or experiments",
  ],
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
  return (await loadCompilationWorkspace(startPath)).configuration;
}

export async function loadAgentProfile(
  workspacePath: string,
): Promise<string | undefined> {
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath: workspacePath,
    currentDirectory: Deno.cwd(),
  });
  assertLoadedWorkspace(workspace.diagnostics);
  const agent = workspace.config?.tools.agent;
  return agent && typeof agent === "object" && !Array.isArray(agent) &&
      typeof (agent as Record<string, unknown>).profile === "string"
    ? (agent as Record<string, string>).profile
    : undefined;
}

export async function resolveCompilationProfile(
  workspacePath: string,
  agent: boolean = false,
): Promise<string> {
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath: workspacePath,
    currentDirectory: Deno.cwd(),
  });
  assertLoadedWorkspace(workspace.diagnostics);
  const agentConfiguration = workspace.config?.tools.agent;
  const agentProfile = agent && agentConfiguration &&
      typeof agentConfiguration === "object" &&
      !Array.isArray(agentConfiguration) &&
      typeof (agentConfiguration as Record<string, unknown>).profile ===
        "string"
    ? (agentConfiguration as Record<string, string>).profile
    : undefined;
  const configuration = parseCompilationConfiguration(
    workspace.config?.tools.compile,
  );
  return agentProfile ?? configuration.defaultProfile ?? "standard";
}

export async function loadCompilationWorkspace(
  startPath: string,
): Promise<
  { readonly configuration: CompileConfiguration; readonly root: string }
> {
  await assertWorkspacePath(startPath);
  const workspace = await loadSigilWorkspace(new DenoReadOnlyFileSystem(), {
    startPath,
  });
  assertLoadedWorkspace(workspace.diagnostics);
  return {
    configuration: parseCompilationConfiguration(
      workspace.config?.tools.compile,
    ),
    root: workspace.root,
  };
}

export async function validateCompilationProfile(
  configuration: CompileConfiguration,
  profileName: string,
  focus: CompilationFocus,
): Promise<void> {
  const definitions = stageDefinitions(await loadEvaluationSkills());
  const profile = await effectiveProfile(
    profileName,
    configuration,
    definitions,
    stageForCompilationFocus(focus),
  );
  assertProfileEvaluators(profile, adaptersFrom(profile, {}));
}

// @sigil implements packages/compiler/src/compiler.sigil::SigilOneShotCompilation::OneShotCompilation interface,logic,cases
export async function compile(
  workspacePath: string,
  target: CompilationTarget = { kind: "workspace" },
  profileName: string,
  options: CompileOptions = {},
): Promise<CompilationReport> {
  const requestedStage = options.requestedStage ??
    stageForCompilationFocus(options.focus);
  const cancellationSignal = options.cancellationSignal ?? options.signal;
  const startedAt = new Date().toISOString();
  let eventWriter: CompilationEventWriter | undefined;

  try {
    if (options.requestedStage && options.focus) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "requestedStage and focus are mutually exclusive.",
      );
    }
    await assertWorkspacePath(workspacePath);
    const fs = new DenoReadOnlyFileSystem();
    const workspace = await loadSigilWorkspace(fs, {
      startPath: workspacePath,
      currentDirectory: Deno.cwd(),
    });
    assertLoadedWorkspace(workspace.diagnostics);
    const resolved = resolveSigilWorkspace(workspace);
    const configuration = parseCompilationConfiguration(
      workspace.config?.tools.compile,
    );
    const skills = await loadEvaluationSkills();
    const definitions = stageDefinitions(skills);
    let profile = await effectiveProfile(
      profileName,
      configuration,
      definitions,
      requestedStage,
    );
    profile = await bindSuppliedAdapter(profile, options.adapter);
    const adapters = adaptersFrom(profile, options);
    assertProfileEvaluators(profile, adapters);
    const components = resolveCompilationTarget(
      resolved,
      target,
      workspace.root,
    );
    const openedWriter = await openCompilationEventWriter(
      options.eventSink ?? callbackEventSink(options.onEvent),
      {
        operation: "one-shot-compilation",
        stageIdentities: profile.stages.map((stage) => stage.id),
      },
    );
    if (openedWriter.kind === "failure") {
      throw new CompilerFailure(
        "COMPILER_FAILED",
        `Compilation event stream could not be established: ${openedWriter.result}.`,
      );
    }
    eventWriter = openedWriter.writer;
    const runId = openedWriter.runId;
    const implementationSources = await loadImplementationSources(
      fs,
      workspace.root,
      workspace.config,
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

    const coreDiagnostics: CompilerDiagnostic[] = await Promise.all(
      resolved.diagnostics.map((item) =>
        fromCoreDiagnostic(item, semanticSubjects)
      ),
    );
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
    const diagnostics: CompilerDiagnostic[] = [];
    const agentDiagnosticFingerprints = new Set<string>();
    const stageReports: StageReport[] = [];
    const failed = new Set<string>();
    const adaptersByEvaluatorId = new Map(
      profile.evaluators.map((evaluator, index) => [
        evaluator.id,
        adapters[index],
      ]),
    );

    for (const stage of profile.stages) {
      const definition = definitions.find((item) => item.id === stage.id)!;
      const stageEvaluatorIds = stage.evaluatorIds;
      const stageAdapters = stageEvaluatorIds
        ? stageEvaluatorIds.map((id) => adaptersByEvaluatorId.get(id))
          .filter((adapter): adapter is AgentAdapter => !!adapter)
        : adapters;
      const evaluatorLabel = stageAdapters.map((item) => item.id).join(",") ||
        "unavailable";
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
      await requireEventDelivery(
        await eventWriter.stageStarted(stage.id),
        true,
      );
      const before = diagnostics.length;
      const evaluations: NonNullable<StageReport["evaluations"]>[number][] = [];
      let state: StageReport["state"] = "completed";
      try {
        if (!definition.agentic) {
          for (const rawDiagnostic of coreDiagnostics) {
            const diagnostic = currentLifecycle(rawDiagnostic, previous);
            diagnostics.push(diagnostic);
            await requireEventDelivery(
              await eventWriter.diagnostic(diagnostic),
              true,
            );
          }
          if (
            coreDiagnostics.some((diagnostic) =>
              diagnostic.severity === "error"
            )
          ) {
            state = "failed";
            failed.add(stage.id);
          }
        } else {
          if (
            !stageAdapters.length ||
            (stageEvaluatorIds &&
              stageAdapters.length !== stageEvaluatorIds.length)
          ) {
            throw new Error(
              "No compiler evaluator is configured for the selected profile.",
            );
          }
          if (!definition.skill) {
            throw new Error(`Evaluation skill ${stage.id} is unavailable.`);
          }
          for (const adapter of stageAdapters) {
            assertAdapterCapabilities(adapter);
          }
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
            const request = buildAgentEvaluationRequest({
              stage: stage.id,
              purpose: retrievalPurpose,
              skill: definition.skill.guidance,
              allowedRules: definition.skill.manifest.rules,
              implementationEvidence:
                definition.skill.manifest.implementationEvidence,
              workspaceRoot: workspace.root,
              workspaceSnapshotIdentity:
                resolved.workspace.workspaceSnapshotIdentity,
              target: await compilationEvaluationTarget(
                component,
                workspace.root,
                retrieval,
              ),
              capabilities: evaluationCapabilitiesFor(
                stageAdapters[0].capabilities,
              ),
              commandPolicy: INSPECTION_COMMAND_POLICY,
              observability: stageAdapters[0].observability,
              budgets: profile.executionBudgets,
              limits: {
                maxInitialRequestChars: profile.agentInputBudgetChars,
                maxProviderFrameChars:
                  profile.limits.maxCompilationRequestChars,
                maxFinalResultChars: profile.limits.maxCompilationRequestChars,
                maxRetainedCommandOutputChars:
                  profile.executionBudgets.maxCommandOutputChars,
                providerCleanupMs: profile.limits.providerCleanupMs,
              },
              signal: cancellationSignal,
            });
            const requestSize = JSON.stringify(request, (_key, value) =>
              value instanceof AbortSignal ? undefined : value).length;
            if (requestSize > profile.contextBudgetChars) {
              throw new Error(
                `Evaluation request for ${component.name} is ${requestSize} characters, exceeding the ${profile.contextBudgetChars}-character budget.`,
              );
            }
            const componentDiagnostics: CompilerDiagnostic[][] = [];
            for (const adapter of stageAdapters) {
              const adapterRequest = buildAgentEvaluationRequest({
                ...request,
                capabilities: evaluationCapabilitiesFor(adapter.capabilities),
                observability: adapter.observability,
              });
              const result = validateAgentEvaluationResult(
                adapterRequest,
                await adapter.evaluate(adapterRequest),
              );
              if (
                result.budgetOutcome?.token === "exceeded" ||
                result.budgetOutcome?.cost === "exceeded"
              ) {
                throw new Error(
                  `Evaluator ${adapter.id} exceeded a post-settlement execution budget.`,
                );
              }
              evaluations.push({
                evaluatorId: adapter.id,
                componentName: component.name,
                commands: result.commands,
                usage: result.usage,
                usageAvailability: result.usageAvailability ??
                  (result.usage ? "final" : "unavailable"),
                cost: result.cost,
                costAvailability: result.costAvailability ??
                  (result.cost ? "final" : "unavailable"),
                budgetOutcome: result.budgetOutcome,
              });
              const evaluatorDiagnostics: CompilerDiagnostic[] = [];
              const evaluatorFingerprints = new Set<string>();
              for (const finding of result.findings) {
                if (!definition.skill.manifest.rules.includes(finding.code)) {
                  throw new Error(
                    `Evaluator returned undeclared rule ${
                      JSON.stringify(finding.code)
                    } for stage ${stage.id}.`,
                  );
                }
                const diagnostic = currentLifecycle(
                  await fromAgentFinding(
                    stage.id,
                    definition.skill,
                    adapter,
                    finding,
                    component.name,
                    semanticSubjects,
                  ),
                  previous,
                );
                if (evaluatorFingerprints.has(diagnostic.fingerprint)) {
                  continue;
                }
                evaluatorFingerprints.add(diagnostic.fingerprint);
                evaluatorDiagnostics.push(diagnostic);
              }
              componentDiagnostics.push(evaluatorDiagnostics);
              for (const diagnostic of evaluatorDiagnostics) {
                if (agentDiagnosticFingerprints.has(diagnostic.fingerprint)) {
                  continue;
                }
                agentDiagnosticFingerprints.add(diagnostic.fingerprint);
                diagnostics.push(diagnostic);
                await requireEventDelivery(
                  await eventWriter.diagnostic(diagnostic, component.name),
                  true,
                );
              }
            }
            for (
              const rawDiagnostic of await disagreementDiagnostics(
                stage.id,
                component.name,
                stageAdapters,
                componentDiagnostics,
              )
            ) {
              const diagnostic = currentLifecycle(rawDiagnostic, previous);
              diagnostics.push(diagnostic);
              await requireEventDelivery(
                await eventWriter.diagnostic(diagnostic, component.name),
                true,
              );
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
        const diagnostic = currentLifecycle(
          await stageFailure(stage.id, stageAdapters[0], error),
          previous,
        );
        diagnostics.push(diagnostic);
        await requireEventDelivery(
          await eventWriter.diagnostic(diagnostic),
          true,
        );
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
      await requireEventDelivery(
        await eventWriter.stageCompleted(report),
        true,
      );
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
      await exportCompilationReport(
        report,
        exportDestination,
        options.reportExportRepresentation ?? "json",
        workspace.root,
      );
    }
    await requireEventDelivery(await eventWriter.completed(report));
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
    const code = stableCompilerFailureCode(error);
    if (eventWriter) {
      const message = error instanceof Error ? error.message : String(error);
      const delivery = code === "COMPILER_CANCELLED"
        ? await eventWriter.cancelled(message)
        : await eventWriter.failed(code, message);
      if (delivery !== "delivered") {
        throw new CompilerFailure(
          "COMPILER_FAILED",
          `Required terminal compilation event was not delivered: ${delivery}.`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

async function assertWorkspacePath(workspacePath: string): Promise<void> {
  if (!workspacePath.trim()) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "workspacePath must identify an existing configured workspace or Sigil source.",
    );
  }
  try {
    await Deno.lstat(workspacePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "workspacePath does not exist.",
        { cause: error },
      );
    }
    throw new CompilerFailure(
      "COMPILER_FAILED",
      "workspacePath could not be accessed.",
      { cause: error },
    );
  }
}

function assertLoadedWorkspace(
  diagnostics: readonly { readonly code: string; readonly severity: string }[],
): void {
  const error = diagnostics.find((item) =>
    item.severity === "error" &&
    (item.code === "SIGIL_CONFIG_NOT_FOUND" ||
      item.code.startsWith("SIGIL_CONFIG_"))
  );
  if (!error) return;
  if (error.code === "SIGIL_CONFIG_NOT_FOUND") {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "workspacePath is not governed by a configured Sigil workspace.",
    );
  }
  throw new CompilerFailure(
    "COMPILER_FAILED",
    `SigilCore could not load the selected workspace: ${error.code}.`,
  );
}

async function bindSuppliedAdapter(
  profile: EffectiveProfile,
  adapter: AgentAdapter | undefined,
): Promise<EffectiveProfile> {
  if (!adapter) return profile;
  const evaluator: EvaluatorConfiguration = {
    id: adapter.id,
    provider: adapter.provider,
    ...(adapter.model ? { model: adapter.model } : {}),
    implementationId: adapter.implementationId,
    implementationVersion: adapter.implementationVersion,
  };
  if (profile.evaluators.length) {
    const selected = profile.evaluators[0];
    if (
      selected.provider !== evaluator.provider ||
      selected.implementationId !== evaluator.implementationId ||
      selected.implementationVersion !== evaluator.implementationVersion ||
      selected.model !== evaluator.model
    ) {
      throw new CompilerFailure(
        "COMPILER_PROFILE_EVALUATORS_REQUIRED",
        "The supplied adapter does not match the profile's exact implementation binding.",
      );
    }
  }
  const evaluators = profile.evaluators.length
    ? profile.evaluators
    : [evaluator];
  const adapterBinding = {
    provider: evaluator.provider,
    ...(evaluator.model ? { model: evaluator.model } : {}),
    implementationId: evaluator.implementationId,
    implementationVersion: evaluator.implementationVersion,
  };
  const fingerprint = await digest(JSON.stringify({
    ...profile,
    fingerprint: undefined,
    adapter: adapterBinding,
    evaluators,
  }));
  return { ...profile, adapter: adapterBinding, evaluators, fingerprint };
}

function callbackEventSink(
  callback: CompileOptions["onEvent"],
): WritableEnvelopeSink {
  return async (bytes) => {
    if (!callback) return "delivered-all";
    try {
      await callback(JSON.parse(new TextDecoder().decode(bytes)));
      return "delivered-all";
    } catch {
      return "rejected-zero-unavailable";
    }
  };
}

function requireEventDelivery(result: WriterResult, progress = false): void {
  if (result === "delivered" || (progress && result === "suppressed")) return;
  throw new CompilerFailure(
    "COMPILER_FAILED",
    `Compilation event delivery failed: ${result}.`,
  );
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
    !capabilitiesMatch(
      evaluationCapabilitiesFor(adapter.capabilities),
      adapter.capabilities,
    )
  ) {
    throw new Error(
      `Adapter ${adapter.id} declares capabilities that do not match read-only, offline, approval-free inspection with its selected persistence mode.`,
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

function currentLifecycle(
  diagnostic: CompilerDiagnostic,
  previous: CompilationReport | undefined,
): CompilerDiagnostic {
  return applyDiagnosticLifecycle([diagnostic], previous)[0];
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
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      `Unknown compilation profile ${JSON.stringify(name)}.`,
    );
  }
  const included = base === "standard"
    ? definitions.filter((stage) => stage.id !== "standards-risk")
    : definitions;
  const disabled = new Set(custom?.disabledStages ?? []);
  const selected = requestedStage
    ? stageClosure(requestedStage, included)
    : included;
  if (requestedStage && selected.some((stage) => disabled.has(stage.id))) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
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
    evaluatorIds: stage.agentic
      ? evaluatorIdsForStage(name, base, custom, configuration, stage.id)
      : [],
  }));
  const evaluatorIds = [
    ...new Set(stages.flatMap((stage) => stage.evaluatorIds ?? [])),
  ];
  const evaluators = selectedEvaluators(
    name,
    base,
    custom,
    configuration,
    evaluatorIds.length ? evaluatorIds : undefined,
  );
  const settings = resolveCompilationSettings(configuration);
  const profileBase = {
    name,
    criticalSystem: base === "critical-system",
    contextBudgetChars: settings.limits.maxCompilationRequestChars,
    agentInputBudgetChars: settings.limits.maxAgentInputChars,
    limits: settings.limits,
    executionBudgets: settings.budgets,
    stages,
    adapter: configuration.adapter
      ? normalizeEvaluator("default", configuration.adapter)
      : undefined,
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
    stages: profileBase.stages,
    adapter: profileBase.adapter,
    evaluators: profileBase.evaluators,
    fingerprint: await digest(JSON.stringify(profileBase)),
  };
}

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
  selectedIds?: readonly string[],
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
  const ids = selectedIds ?? (configuredIds as readonly string[] | undefined) ??
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
    const implementationId = (raw as Record<string, unknown>)
      .implementationId;
    const implementationVersion = (raw as Record<string, unknown>)
      .implementationVersion;
    if (!["codex", "claude", "opencode", "pi"].includes(String(provider))) {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${
          JSON.stringify(id)
        } must use provider codex, claude, opencode, or pi.`,
      );
    }
    if (model !== undefined && typeof model !== "string") {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${JSON.stringify(id)} model must be a string.`,
      );
    }
    if (
      implementationId !== undefined &&
      (typeof implementationId !== "string" || !implementationId)
    ) {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${
          JSON.stringify(id)
        } implementationId must be a non-empty string.`,
      );
    }
    if (
      implementationVersion !== undefined &&
      (typeof implementationVersion !== "string" || !implementationVersion)
    ) {
      throw evaluatorConfigurationError(
        base,
        `Evaluator ${
          JSON.stringify(id)
        } implementationVersion must be a non-empty exact version.`,
      );
    }
    return normalizeEvaluator(
      id,
      raw as NonNullable<CompileConfiguration["adapter"]>,
    );
  });
}

function evaluatorIdsForStage(
  name: string,
  base: "standard" | "critical-system",
  custom: NonNullable<CompileConfiguration["profiles"]>[string] | undefined,
  configuration: CompileConfiguration,
  stage: string,
): readonly string[] | undefined {
  const stages = custom?.stages;
  if (!stages) {
    return custom?.main ?? custom?.evaluatorIds ??
      (base === "standard" && configuration.adapter ? ["default"] : undefined);
  }
  const ids = stages[stage] ?? custom?.main;
  if (
    !Array.isArray(ids) || ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw evaluatorConfigurationError(
      base,
      `Profile ${
        JSON.stringify(name)
      } must configure unique evaluator identities for agentic stage ${
        JSON.stringify(stage)
      }.`,
    );
  }
  return ids;
}

function normalizeEvaluator(
  id: string,
  raw: NonNullable<CompileConfiguration["adapter"]>,
): EvaluatorConfiguration {
  const provider = raw.provider;
  return {
    id,
    provider,
    ...(raw.model ? { model: raw.model } : {}),
    implementationId: raw.implementationId ?? `builtin.${provider}-cli`,
    implementationVersion: raw.implementationVersion ?? metadata.version,
  };
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
    throw new CompilerFailure("COMPILER_INVALID_INVOCATION", known);
  }
  const selected = new Set<string>();
  const visit = (stage: StageDefinition): void => {
    for (const dependency of stage.dependencies) {
      const definition = available.find((item) => item.id === dependency);
      if (!definition) {
        throw new CompilerFailure(
          "COMPILER_INVALID_INVOCATION",
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

function adaptersFrom(
  profile: EffectiveProfile,
  options: CompileOptions,
): readonly AgentAdapter[] {
  if (options.adapters) {
    const registrations = [
      ...compilerOwnedAdapters(profile.evaluators),
      ...options.adapters,
    ];
    return profile.evaluators.map((configuration) => {
      try {
        return resolveAdapterRegistration(registrations, configuration);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw profile.criticalSystem
          ? profileEvaluatorError(message)
          : new CompilerFailure(
            "COMPILER_PROFILE_EVALUATORS_REQUIRED",
            message,
          );
      }
    });
  }
  if (options.adapter) {
    if (profile.name === "critical-system") {
      return [options.adapter];
    }
    return [options.adapter];
  }
  const builtins = compilerOwnedAdapters(profile.evaluators);
  return profile.evaluators.map((configuration) => {
    const implementation = resolveAdapterRegistration(builtins, configuration);
    return implementation;
  });
}

function compilerOwnedAdapters(
  configurations: readonly EvaluatorConfiguration[],
): readonly AgentAdapter[] {
  const registrations = new Map<string, AgentAdapter>();
  for (const configuration of configurations) {
    const adapter = configuration.provider === "codex"
      ? new CodexAdapter(configuration.model)
      : undefined;
    if (adapter) {
      registrations.set(
        `${adapter.provider}\0${adapter.implementationId}\0${adapter.implementationVersion}\0${
          adapter.model ?? ""
        }`,
        adapter,
      );
    }
  }
  return [...registrations.values()];
}

function assertProfileEvaluators(
  profile: EffectiveProfile,
  adapters: readonly AgentAdapter[],
): void {
  if (
    adapters.length !== profile.evaluators.length ||
    profile.evaluators.some((binding, index) => {
      const adapter = adapters[index];
      return !adapter || adapter.provider !== binding.provider ||
        adapter.implementationId !== binding.implementationId ||
        adapter.implementationVersion !== binding.implementationVersion ||
        adapter.model !== binding.model;
    })
  ) {
    throw profile.criticalSystem
      ? profileEvaluatorError(
        "The selected adapters do not exactly satisfy the effective profile bindings.",
      )
      : new CompilerFailure(
        "COMPILER_PROFILE_EVALUATORS_REQUIRED",
        "The selected adapters do not exactly satisfy the effective profile bindings.",
      );
  }
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
    : new CompilerFailure("COMPILER_PROFILE_EVALUATORS_REQUIRED", message);
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
  const line = finding.line ?? undefined;
  const column = finding.column ?? undefined;
  const filePath = finding.filePath ?? undefined;
  const range = line
    ? {
      start: { line, column: column ?? 1 },
      end: { line, column: (column ?? 1) + 1 },
    }
    : undefined;
  const semanticSubjects = await resolver.resolve(
    filePath,
    range,
    componentName,
  );
  return {
    code: finding.code,
    fingerprint: await diagnosticFingerprint(
      finding.code,
      stage,
      semanticSubjects,
      filePath,
      range,
      componentName,
    ),
    severity: finding.severity,
    stage,
    skill: `${skill.manifest.id}@${skill.manifest.version}`,
    message: finding.message,
    filePath,
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
    impact:
      "This stage did not complete; a required stage prevents green, while an optional stage remains visible without changing required-stage status.",
    correction:
      "Configure an available read-only adapter or disable the stage in a project profile.",
    evaluator: adapter?.id ?? "unavailable",
    lifecycle: "new",
  };
}

/**
 * Each source is digested on its own and the digests are combined, because
 * serializing an entire workspace into one string exceeds the maximum string
 * length on a large repository and fails the run.
 */
async function workspaceEvidenceFingerprint(
  root: string,
  sigilDocuments: readonly unknown[],
  implementation: readonly ImplementationSource[],
): Promise<string> {
  const parts: string[] = [];
  for (const document of sigilDocuments) {
    parts.push(await digest(JSON.stringify(document)));
  }
  for (const source of implementation) {
    parts.push(
      await digest(JSON.stringify({
        filePath: canonicalWorkspacePath(source.filePath, root),
        text: source.text,
      })),
    );
  }
  return await digest(
    JSON.stringify({
      sigilDocuments: parts.slice(0, sigilDocuments.length),
      implementation: parts.slice(sigilDocuments.length),
    }),
  );
}

/**
 * Implementation evidence is workspace content, so the workspace exclusions
 * apply. Without them a vendored dependency tree or virtual environment is read
 * in full, which is neither the caller's code nor affordable to hold in memory.
 */
async function loadImplementationSources(
  fs: SigilFileSystem,
  root: string,
  config: SigilConfig | undefined,
): Promise<readonly ImplementationSource[]> {
  return Promise.all(
    (await fs.listFiles(root))
      .filter(isSupportedImplementationSource)
      .filter((filePath) =>
        !config ||
        !excludesWorkspacePath(canonicalWorkspacePath(filePath, root), config)
      )
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
