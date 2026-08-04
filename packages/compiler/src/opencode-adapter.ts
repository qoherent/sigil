import type {
  AgentAdapter,
  AgentCommandTrace,
  AgentEvaluationRequest,
  AgentEvaluationResult,
  CanonicalCommandFamilyIdentifier,
} from "./types.ts";
import {
  AdapterFailure,
  assertProviderExit,
  commandFamily,
  decodeProviderOutput,
  defaultProviderRunner,
  objectValue,
  parseFindingsObject,
  preflightAgentRequest,
  providerEventLines,
  type ProviderRunner,
  providerSignal,
  removeTemporaryPath,
  requiredUsage,
  validateSettledResult,
} from "./adapter-runtime.ts";

// @sigil implements packages/compiler/src/opencode-adapter.sigil::SigilOpenCodeAdapter::OpenCodeAdapter interface
export class OpenCodeAdapter implements AgentAdapter {
  readonly provider = "opencode" as const;
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    approvalEscalation: false,
    ephemeral: true,
  } as const;

  constructor(
    readonly model?: string,
    private readonly runner: ProviderRunner = defaultProviderRunner,
    readonly id = "opencode",
  ) {}

  // @sigil implements packages/compiler/src/opencode-adapter.sigil::SigilOpenCodeAdapter::OpenCodeInvocation logic,constraints
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<AgentEvaluationResult> {
    const prompt = preflightAgentRequest(this, request);
    const stateRoot = await Deno.makeTempDir({ prefix: "sigil-opencode-" });
    try {
      const allowedTools = openCodeTools(request);
      const config = {
        $schema: "https://opencode.ai/config.json",
        share: "disabled",
        autoupdate: false,
        permission: {
          "*": "deny",
          external_directory: "deny",
          ...Object.fromEntries(allowedTools.map((tool) => [tool, "allow"])),
        },
        tools: {
          bash: false,
          edit: false,
          write: false,
          patch: false,
          task: false,
          webfetch: false,
          websearch: false,
          skill: false,
          lsp: false,
          ...Object.fromEntries(allowedTools.map((tool) => [tool, true])),
        },
      };
      const result = await this.runner({
        command: "opencode",
        args: [
          "run",
          "--pure",
          "--format",
          "json",
          "--dir",
          request.workspaceAccess.agentRoot,
          ...(this.model ? ["--model", this.model] : []),
          prompt,
        ],
        input: "",
        cwd: request.workspaceAccess.agentRoot,
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          OPENCODE_DISABLE_MODELS_FETCH: "true",
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
          OPENCODE_DISABLE_CLAUDE_CODE: "true",
          XDG_CONFIG_HOME: `${stateRoot}/config`,
          XDG_DATA_HOME: `${stateRoot}/data`,
          XDG_CACHE_HOME: `${stateRoot}/cache`,
          XDG_STATE_HOME: `${stateRoot}/state`,
        },
        signal: providerSignal(request),
      });
      assertProviderExit("opencode", result);
      return validateSettledResult(
        parseOpenCodeEvents(
          decodeProviderOutput(result.stdout),
          request,
          this.model,
        ),
        request,
      );
    } catch (error) {
      if (error instanceof AdapterFailure) throw error;
      if (request.signal?.aborted) {
        throw new AdapterFailure(
          "AGENT_CANCELLED",
          "Agent evaluation was cancelled.",
          { cause: error },
        );
      }
      if (
        error instanceof DOMException &&
        ["AbortError", "TimeoutError"].includes(error.name)
      ) {
        throw new AdapterFailure(
          "AGENT_TIMEOUT",
          "Agent evaluation timed out.",
          { cause: error },
        );
      }
      throw new AdapterFailure(
        "AGENT_PROVIDER_FAILED",
        "OpenCode evaluation failed.",
        { cause: error },
      );
    } finally {
      await removeTemporaryPath(stateRoot);
    }
  }
}

function openCodeTools(request: AgentEvaluationRequest): readonly string[] {
  const mapping = new Map<CanonicalCommandFamilyIdentifier, string>(
    [
      ["workspace.read", "read"],
      ["workspace.glob", "glob"],
      ["workspace.grep", "grep"],
      ["workspace.list", "list"],
    ] as const,
  );
  return request.capabilities.allowedCommands.flatMap((identifier) => {
    const tool = mapping.get(identifier);
    return tool && !request.capabilities.forbiddenCommands.includes(identifier)
      ? [tool]
      : [];
  });
}

function parseOpenCodeEvents(
  raw: string,
  request: AgentEvaluationRequest,
  model: string | undefined,
): AgentEvaluationResult {
  const commands: AgentCommandTrace[] = [];
  const text: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let hasUsage = false;
  let resolvedModel: string | null = null;
  let commandOutputChars = 0;
  for (const value of providerEventLines(raw, "OpenCode")) {
    const event = objectValue(value);
    const part = objectValue(event?.part);
    if (!event || typeof event.type !== "string") {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        "OpenCode emitted an invalid event shape.",
      );
    }
    if (event.type === "error") {
      throw new AdapterFailure(
        "AGENT_PROVIDER_FAILED",
        "OpenCode emitted an error event.",
      );
    }
    if (event.type === "text") {
      if (typeof part?.text !== "string") {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "OpenCode text event is malformed.",
        );
      }
      text.push(part.text);
    } else if (event.type === "tool_use") {
      if (commands.length >= request.budgets.maxCommands) {
        throw new AdapterFailure(
          "AGENT_BUDGET_EXCEEDED",
          "OpenCode exceeded its command budget.",
        );
      }
      const state = objectValue(part?.state);
      const tool = typeof part?.tool === "string" ? part.tool : undefined;
      if (
        !tool || !state ||
        !["completed", "error", "failed"].includes(String(state.status))
      ) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "OpenCode tool event is not settled.",
        );
      }
      const output = typeof state.output === "string" ? state.output : "";
      commandOutputChars += output.length;
      if (commandOutputChars > request.budgets.maxCommandOutputChars) {
        throw new AdapterFailure(
          "AGENT_BUDGET_EXCEEDED",
          "OpenCode tool output exceeded its character budget.",
        );
      }
      commands.push({
        sequence: commands.length,
        canonicalCommandFamily: commandFamily(request.capabilities, tool),
        providerOperationId: typeof part?.callID === "string"
          ? part.callID
          : null,
        status: state.status === "completed" ? "completed" : "failed",
        exitCode: typeof state.exitCode === "number" ? state.exitCode : null,
      });
    } else if (event.type === "step_finish") {
      const tokens = objectValue(part?.tokens);
      if (
        !tokens || !Number.isSafeInteger(tokens.input) ||
        !Number.isSafeInteger(tokens.output)
      ) {
        throw new AdapterFailure(
          "AGENT_USAGE_UNAVAILABLE",
          "OpenCode step usage is unavailable.",
        );
      }
      inputTokens += tokens.input as number;
      outputTokens += tokens.output as number;
      hasUsage = true;
      const eventModel = part?.modelID ?? event.modelID;
      if (typeof eventModel === "string") resolvedModel = eventModel;
    } else if (event.type !== "step_start") {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        `OpenCode emitted unknown event ${JSON.stringify(event.type)}.`,
      );
    }
  }
  if (!hasUsage) {
    throw new AdapterFailure(
      "AGENT_USAGE_UNAVAILABLE",
      "OpenCode emitted no settled usage.",
    );
  }
  if (!text.length) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "OpenCode emitted no completed assistant text.",
    );
  }
  return {
    findings: parseFindingsObject(text.join("")),
    commands,
    usage: requiredUsage(inputTokens, outputTokens),
    configuredModel: model ?? null,
    resolvedModel,
  };
}
