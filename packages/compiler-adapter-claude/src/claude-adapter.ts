import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AdapterSubprocessResult,
  type AgentAdapter,
  type AgentCommandTrace,
  type AgentEvaluationRequest,
  type AgentEvaluationResult,
  assertCapabilityContract,
  capabilitiesMatch,
  coordinateAdapterExecution,
  createAdapterSubprocessHandle,
  evaluationPrompt,
  FINDINGS_SCHEMA,
  normalizeObservability,
  parseFindingsObject,
  runAdapterSubprocess,
  validateAdapterSubprocessInput,
  validateAgentEvaluationRequest,
  validateAgentEvaluationResult,
} from "@qoherent/sigil-compiler";
import metadata from "../deno.json" with { type: "json" };

export type ClaudeCommandRunner = (
  invocation: AdapterSubprocessInvocation,
) => Promise<AdapterSubprocessResult>;

const defaultRunner: ClaudeCommandRunner = runAdapterSubprocess;

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = "claude" as const;
  readonly implementationId = "builtin.claude-cli";
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
    usage: "partial",
    cost: "final",
    tokenBudgetEnforcement: "post-settlement-only",
    costBudgetEnforcement: "post-settlement-only",
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: ClaudeCommandRunner = defaultRunner,
    readonly id = "claude",
  ) {}

  // @sigil implements packages/compiler-adapter-claude/src/claude-adapter.sigil::SigilClaudeCompilerAdapter interface,logic,constraints,cases
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
        "Claude request observability does not match the selected adapter.",
      );
    }
    try {
      assertCapabilityContract(this, request);
    } catch (error) {
      throw new AdapterFailure(
        "capability-mismatch",
        "Claude capabilities do not match the requested contract.",
        undefined,
        { cause: error },
      );
    }
    if (!capabilitiesMatch(request.capabilities, this.capabilities)) {
      throw new AdapterFailure(
        "capability-mismatch",
        "Claude capabilities do not match the requested contract.",
      );
    }

    let prompt: string;
    try {
      validateAgentEvaluationRequest(request);
      prompt = evaluationPrompt(request);
    } catch (error) {
      throw new AdapterFailure(
        "incomplete-evidence",
        "Claude evaluation request evidence is incomplete or invalid.",
        undefined,
        { cause: error },
      );
    }
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--json-schema",
      JSON.stringify(FINDINGS_SCHEMA),
      "--input-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep,Bash",
      "--allowedTools",
      "Read,Glob,Grep,Bash",
      "--disallowedTools",
      "Edit,Write,NotebookEdit",
      "--no-session-persistence",
      "--safe-mode",
      ...(this.model ? ["--model", this.model] : []),
    ];
    const handle = createAdapterSubprocessHandle(
      `${this.implementationId}@${this.implementationVersion}`,
    );
    const input = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    });
    validateAdapterSubprocessInput(
      input,
      request.limits.maxInitialRequestChars,
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
        let streamedStdout = "";
        let streamBuffer = "";
        let observedCommands = 0;
        let budgetTerminationRequested = false;
        const result = await this.runner({
          implementationIdentity:
            `${this.implementationId}@${this.implementationVersion}`,
          command: "claude",
          args,
          cwd: request.workspaceRoot,
          input,
          signal,
          maxInitialRequestChars: request.limits.maxInitialRequestChars,
          maxProviderFrameChars: request.limits.maxProviderFrameChars,
          handle,
          resources,
          terminationControl,
          onFrame: (frame) => {
            if (frame.channel !== "stdout") return;
            streamedStdout += frame.text;
            streamBuffer += frame.text;
            const lines = streamBuffer.split(/\r?\n/);
            streamBuffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                observedCommands += commandObservations(JSON.parse(line));
              } catch {
                // Complete framing validation remains owned by parseClaudeEvents.
              }
            }
            if (
              observedCommands > request.budgets.maxCommands &&
              !budgetTerminationRequested
            ) {
              budgetTerminationRequested = true;
              terminationControl.requestPreventiveBudgetTermination(
                `Claude emitted more than ${request.budgets.maxCommands} command observations.`,
              );
            }
          },
        });
        const parsed = parseClaudeEvents(
          result.stdout || streamedStdout,
          request.limits.maxProviderFrameChars,
          request.limits.maxFinalResultChars,
          request.limits.maxRetainedCommandOutputChars,
        );
        if (parsed.commands.length > request.budgets.maxCommands) {
          throw new AdapterFailure(
            "preventive-budget",
            `Claude emitted ${parsed.commands.length} command observations, exceeding the configured limit.`,
          );
        }
        try {
          return validateAgentEvaluationResult(request, parsed);
        } catch (error) {
          throw new AdapterFailure(
            "final-result-protocol",
            "Claude returned an invalid terminal result.",
            undefined,
            { cause: error },
          );
        }
      },
    });
  }
}

// @sigil implements packages/compiler-adapter-claude/src/claude-adapter.sigil::SigilClaudeCompilerAdapter logic,constraints,cases
export function parseClaudeEvents(
  raw: string,
  maxFrameChars: number,
  maxFinalResultChars: number,
  maxRetainedCommandOutputChars: number,
): AgentEvaluationResult {
  const commands: AgentCommandTrace[] = [];
  const usageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let usageSeen = false;
  let usageInvalid = false;
  let terminal: Record<string, unknown> | undefined;
  let resultCount = 0;

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    if (line.length > maxFrameChars) {
      throw new AdapterFailure(
        "operational-limit",
        `Claude event line ${index + 1} exceeds maxProviderFrameChars.`,
      );
    }
    let event: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!objectValue(value)) throw new Error("event is not an object");
      event = value as Record<string, unknown>;
    } catch (error) {
      throw new AdapterFailure(
        "final-result-protocol",
        `Claude event line ${index + 1} is not valid JSON.`,
        undefined,
        { cause: error },
      );
    }
    if (event.type === "assistant") {
      const message = objectValue(event.message);
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const item = objectValue(block);
          if (!item || item.type !== "tool_use") continue;
          const input = objectValue(item.input);
          if (typeof item.name !== "string" || !input) {
            throw new AdapterFailure(
              "final-result-protocol",
              "Claude emitted a malformed assistant tool-use frame.",
            );
          }
          const command = typeof input.command === "string"
            ? input.command
            : item.name;
          commands.push({
            command: command.slice(0, maxRetainedCommandOutputChars),
            status: "started",
          });
        }
      }
      const usage = objectValue(message?.usage);
      if (usage) {
        usageSeen = true;
        const inputTokens = numberValue(usage.input_tokens);
        const cachedInputTokens = numberValue(usage.cache_read_input_tokens);
        const outputTokens = numberValue(usage.output_tokens);
        if (
          inputTokens === undefined || cachedInputTokens === undefined ||
          outputTokens === undefined
        ) {
          usageInvalid = true;
        } else {
          usageTotals.inputTokens += inputTokens;
          usageTotals.cachedInputTokens += cachedInputTokens;
          usageTotals.outputTokens += outputTokens;
        }
      }
    }
    if (event.type === "result") {
      resultCount++;
      terminal = event;
    }
  }

  if (resultCount !== 1 || !terminal) {
    throw new AdapterFailure(
      "final-result-protocol",
      `Claude event stream must contain exactly one terminal result event; received ${resultCount}.`,
    );
  }
  if (terminal.subtype !== "success" || terminal.is_error === true) {
    throw new AdapterFailure(
      "execution",
      `Claude reported an unsuccessful result: ${
        String(terminal.subtype ?? "unknown")
      }.`,
    );
  }
  const text = terminal.result;
  if (typeof text !== "string" || !text.trim()) {
    throw new AdapterFailure(
      "final-result-protocol",
      "Claude terminal result did not contain assistant text.",
    );
  }
  if (text.length > maxFinalResultChars) {
    throw new AdapterFailure(
      "final-result-protocol",
      "Claude terminal result exceeds maxFinalResultChars.",
    );
  }
  let findings;
  try {
    findings = parseFindingsObject(extractResultObject(text));
  } catch (error) {
    throw new AdapterFailure(
      "final-result-protocol",
      `Claude terminal result is not one valid result object: ${
        error instanceof Error ? error.message : String(error)
      }`,
      undefined,
      { cause: error },
    );
  }
  const cost = numberValue(terminal.total_cost_usd);
  return {
    findings,
    commands,
    usage: usageSeen && !usageInvalid ? usageTotals : undefined,
    usageAvailability: usageSeen && !usageInvalid ? "partial" : "unavailable",
    cost: cost === undefined ? undefined : { amount: cost },
    costAvailability: cost === undefined ? "unavailable" : "final",
  };
}

function extractResultObject(text: string): string {
  const trimmed = text.trim();
  const whole = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (whole) return whole[1].trim();
  return trimmed;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function commandObservations(value: unknown): number {
  const event = objectValue(value);
  if (event?.type !== "assistant") return 0;
  const message = objectValue(event.message);
  if (!Array.isArray(message?.content)) return 0;
  return message.content.filter((block) =>
    objectValue(block)?.type === "tool_use"
  )
    .length;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
