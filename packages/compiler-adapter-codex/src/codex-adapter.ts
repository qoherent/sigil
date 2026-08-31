import {
  AdapterFailure,
  type AgentAdapter,
  type AgentCommandTrace,
  type AgentEvaluationRequest,
  type AgentEvaluationResult,
  type AgentFinding,
  type AgentUsage,
  assertCapabilityContract,
  type CommandRunner,
  coordinateAdapterExecution,
  createAdapterSubprocessHandle,
  defaultRunner,
  evaluationPrompt,
  FINDINGS_SCHEMA,
  hasPreventiveBudgetExhaustion,
  normalizeObservability,
  numberValue,
  objectValue,
  parseFindingsObject,
  truncateRetainedOutput,
  validateAdapterSubprocessInput,
  validateAgentEvaluationRequest,
  validateAgentEvaluationResult,
  validateExecutionBudgets,
} from "@qoherent/sigil-compiler";
import metadata from "../deno.json" with { type: "json" };

export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  readonly implementationId = "builtin.codex-cli";
  readonly implementationVersion = metadata.version;
  readonly capabilities = {
    schemaVersion: 1,
    workspaceAccess: "read-only",
    agentToolNetwork: false,
    approvalEscalation: false,
    statePersistence: "ephemeral",
  } as const;
  readonly observability = {
    progress: "none",
    usage: "final",
    cost: "unavailable",
    tokenBudgetEnforcement: "post-settlement-only",
    costBudgetEnforcement: "unavailable",
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: CommandRunner = defaultRunner,
    readonly id = "codex",
  ) {}

  // @sigil implements packages/compiler-adapter-codex/src/codex-adapter.sigil::SigilCodexCompilerAdapter::CodexAdapter interface,logic,cases
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<AgentEvaluationResult> {
    const elapsedOrigin = performance.now();
    if (request.signal?.aborted) {
      throw new AdapterFailure(
        "cancelled",
        "Evaluation was cancelled before invocation.",
      );
    }
    if (
      JSON.stringify(normalizeObservability(request.observability)) !==
        JSON.stringify(normalizeObservability(this.observability))
    ) {
      throw new AdapterFailure(
        "binding-mismatch",
        "Codex request observability does not match the selected adapter.",
      );
    }
    try {
      assertCapabilityContract(this, request);
    } catch (error) {
      throw new AdapterFailure(
        "capability-mismatch",
        "Codex capabilities do not match the requested contract.",
        undefined,
        { cause: error },
      );
    }
    let prompt: string;
    try {
      validateAgentEvaluationRequest(request);
      prompt = evaluationPrompt(request);
    } catch (error) {
      throw new AdapterFailure(
        "incomplete-evidence",
        "Codex evaluation request evidence is incomplete or invalid.",
        undefined,
        { cause: error },
      );
    }
    validateAdapterSubprocessInput(
      prompt,
      request.limits.maxInitialRequestChars,
    );
    if (performance.now() - elapsedOrigin >= request.budgets.elapsedTimeMs) {
      throw new AdapterFailure(
        "elapsed-time",
        "Codex evaluation elapsed-time budget expired before invocation.",
      );
    }
    if (hasPreventiveBudgetExhaustion(request)) {
      throw new AdapterFailure(
        "preventive-budget",
        "Codex evaluation cannot start with an exhausted preventive budget.",
      );
    }

    const schema = JSON.stringify(FINDINGS_SCHEMA);
    const parser = new CodexEventParser(
      request.limits.maxRetainedCommandOutputChars,
      request.limits.maxProviderFrameChars,
      request.limits.maxFinalResultChars,
    );
    const handle = createAdapterSubprocessHandle(
      `${this.implementationId}@${this.implementationVersion}`,
    );
    return await coordinateAdapterExecution({
      elapsedOrigin,
      elapsedTimeMs: request.budgets.elapsedTimeMs,
      providerCleanupMs: request.limits.providerCleanupMs,
      implementationIdentity:
        `${this.implementationId}@${this.implementationVersion}`,
      handle,
      signal: request.signal,
      invoke: async (signal, resources, terminationControl) => {
        const schemaResourceIdentity = "file:codex-output-schema";
        resources.declareResource(schemaResourceIdentity);
        let schemaPath: string | undefined;
        let stderr = "";
        try {
          schemaPath = await Deno.makeTempFile({ suffix: ".json" });
          resources.observeResource(schemaResourceIdentity, "active");
          await Deno.writeTextFile(schemaPath, schema);
          const args = [
            "exec",
            "--ephemeral",
            "--ignore-rules",
            "--ignore-user-config",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "-C",
            request.workspaceRoot,
            "--json",
            "--output-schema",
            schemaPath,
            "-c",
            'approval_policy="never"',
            "-c",
            'web_search="disabled"',
            ...(this.model ? ["--model", this.model] : []),
            "-",
          ];
          await this.runner(
            "codex",
            args,
            prompt,
            (frame) => {
              if (frame.channel === "stdout") {
                parser.write(frame.text);
              } else {
                stderr += frame.text;
              }
            },
            signal,
            {
              cwd: request.workspaceRoot,
              implementationIdentity:
                `${this.implementationId}@${this.implementationVersion}`,
              maxInitialRequestChars: request.limits.maxInitialRequestChars,
              maxProviderFrameChars: request.limits.maxProviderFrameChars,
              handle,
              resources,
              terminationControl,
            },
          );
          const result = parser.finish();
          validateExecutionBudgets(result, request);
          return validateAgentEvaluationResult(request, result);
        } catch (error) {
          if (
            error instanceof AdapterFailure && error.kind === "process" &&
            stderr
          ) {
            throw new AdapterFailure(
              "process",
              `${error.message}\n${stderr}`,
              error.recovery,
              { cause: error },
            );
          }
          throw error;
        } finally {
          resources.cleanupAttempt(`remove:${schemaPath ?? "uncreated"}`);
          try {
            if (schemaPath) {
              await Deno.remove(schemaPath);
              resources.observeResource(schemaResourceIdentity, "released");
            } else {
              resources.reportResourceObservation(
                schemaResourceIdentity,
                "impossible",
                "Codex output schema temp file was not created.",
              );
            }
          } catch (error) {
            resources.reportResourceObservation(
              schemaResourceIdentity,
              "failed",
              String(error),
            );
          }
        }
      },
    });
  }
}

class CodexEventParser {
  readonly #commands: AgentCommandTrace[] = [];
  #usage: AgentUsage | undefined;
  #findings: readonly AgentFinding[] | undefined;
  #latestCheckpointFindings: readonly AgentFinding[] | undefined;
  #buffer = "";
  #line = 0;

  constructor(
    readonly maxCommandOutputChars: number,
    readonly maxProviderFrameChars: number,
    readonly maxFinalResultChars: number,
  ) {}

  write(chunk: string): void {
    this.#buffer += chunk;
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#acceptLine(line);
    }
    if (this.#buffer.length > this.maxProviderFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Codex event line ${this.#line + 1} exceeds maxProviderFrameChars.`,
      );
    }
  }

  finish(): AgentEvaluationResult {
    if (this.#buffer) this.#acceptLine(this.#buffer.replace(/\r$/, ""));
    this.#buffer = "";
    if (!this.#findings) {
      throw new AdapterFailure(
        "final-result-protocol",
        "Codex event stream did not contain a final agent message.",
      );
    }
    return {
      findings: this.#findings,
      commands: this.#commands,
      usage: this.#usage,
      usageAvailability: this.#usage ? "final" : "unavailable",
      costAvailability: "unavailable",
    };
  }

  #acceptLine(line: string): void {
    this.#line++;
    if (!line.trim()) return;
    if (line.length > this.maxProviderFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Codex event line ${this.#line} exceeds maxProviderFrameChars.`,
      );
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new AdapterFailure(
        "final-result-protocol",
        `Codex event line ${this.#line} is not valid JSON.`,
        undefined,
        { cause: error },
      );
    }
    if (this.#findings) {
      throw new AdapterFailure(
        "final-result-protocol",
        "Codex event stream contained framing after its completed terminal result.",
      );
    }
    if (event.type === "item.completed") {
      const item = objectValue(event.item);
      if (item?.type === "agent_message" && typeof item.text === "string") {
        let candidate: readonly AgentFinding[] | undefined;
        try {
          candidate = parseFindingsObject(item.text);
        } catch {
          candidate = undefined;
        }
        if (candidate) {
          if (item.text.length > this.maxFinalResultChars) {
            throw new AdapterFailure(
              "final-result-protocol",
              "Codex terminal result exceeds maxFinalResultChars.",
            );
          }
          // Agent messages before turn completion are checkpoints. Only the latest
          // checkpoint becomes terminal when Codex emits turn.completed.
          this.#latestCheckpointFindings = candidate;
        }
      } else if (item?.type === "command_execution") {
        truncateRetainedOutput(
          typeof item.aggregated_output === "string"
            ? item.aggregated_output
            : "",
          this.maxCommandOutputChars,
        );
        this.#commands.push({
          command: typeof item.command === "string" ? item.command : "unknown",
          status: typeof item.status === "string" ? item.status : undefined,
          exitCode: typeof item.exit_code === "number"
            ? item.exit_code
            : undefined,
        });
      }
    } else if (event.type === "turn.completed") {
      if (this.#latestCheckpointFindings) {
        this.#findings = this.#latestCheckpointFindings;
        this.#latestCheckpointFindings = undefined;
      }
      const rawUsage = objectValue(event.usage);
      this.#usage = rawUsage
        ? {
          inputTokens: numberValue(rawUsage.input_tokens),
          cachedInputTokens: numberValue(rawUsage.cached_input_tokens),
          outputTokens: numberValue(rawUsage.output_tokens),
        }
        : undefined;
    }
  }
}
