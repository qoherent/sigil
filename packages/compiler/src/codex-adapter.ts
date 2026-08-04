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
  decodeProviderOutput,
  defaultProviderRunner,
  FINDINGS_SCHEMA,
  objectValue,
  parseFindingsObject,
  preflightAgentRequest,
  providerEventLines,
  type ProviderRunner,
  providerSignal,
  requiredUsage,
  validateSettledResult,
} from "./adapter-runtime.ts";

export type CommandRunner = (
  command: string,
  args: readonly string[],
  input: string,
  signal?: AbortSignal,
) => Promise<string>;

// @sigil implements packages/compiler/src/codex-adapter.sigil::SigilCodexAdapter::CodexAdapter interface
export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    approvalEscalation: false,
    ephemeral: true,
  } as const;
  private readonly runner: ProviderRunner;

  constructor(
    readonly model?: string,
    runner: CommandRunner | ProviderRunner = defaultProviderRunner,
    readonly id = "codex",
  ) {
    this.runner = async (request) => {
      if (runner.length === 1) {
        return await (runner as ProviderRunner)(request);
      }
      return {
        stdout: await (runner as CommandRunner)(
          request.command,
          request.args,
          request.input,
          request.signal,
        ),
        code: 0,
      };
    };
  }

  // @sigil implements packages/compiler/src/codex-adapter.sigil::SigilCodexAdapter::CodexInvocation logic,constraints
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<AgentEvaluationResult> {
    const prompt = preflightAgentRequest(this, request);
    const schemaPath = await Deno.makeTempFile({ suffix: ".json" });
    try {
      await Deno.writeTextFile(schemaPath, JSON.stringify(FINDINGS_SCHEMA));
      const result = await this.runner({
        command: "codex",
        args: [
          "exec",
          "--ephemeral",
          "--ignore-rules",
          "--ignore-user-config",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "-C",
          request.workspaceAccess.agentRoot,
          "--json",
          "--output-schema",
          schemaPath,
          "-c",
          'approval_policy="never"',
          "-c",
          'web_search="disabled"',
          ...(this.model ? ["--model", this.model] : []),
          "-",
        ],
        input: prompt,
        cwd: request.workspaceAccess.agentRoot,
        signal: providerSignal(request),
      });
      assertProviderExit("codex", result);
      return validateSettledResult(
        parseCodexEvents(
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
        "Codex evaluation failed.",
        { cause: error },
      );
    } finally {
      await Deno.remove(schemaPath).catch(() => {});
    }
  }
}

function parseCodexEvents(
  raw: string,
  request: AgentEvaluationRequest,
  model: string | undefined,
): AgentEvaluationResult {
  const commands: AgentCommandTrace[] = [];
  let finalText: string | undefined;
  let usage: ReturnType<typeof requiredUsage> | undefined;
  let resolvedModel: string | null = null;
  let commandOutputChars = 0;
  for (const value of providerEventLines(raw, "Codex")) {
    const event = objectValue(value);
    if (!event || typeof event.type !== "string") {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        "Codex emitted an invalid event shape.",
      );
    }
    if (event.type === "item.completed") {
      const item = objectValue(event.item);
      if (item?.type === "agent_message" && typeof item.text === "string") {
        finalText = item.text;
      } else if (item?.type === "command_execution") {
        if (commands.length >= request.budgets.maxCommands) {
          throw new AdapterFailure(
            "AGENT_BUDGET_EXCEEDED",
            "Codex exceeded its command budget.",
          );
        }
        const rawCommand = typeof item.command === "string" ? item.command : "";
        const output = typeof item.aggregated_output === "string"
          ? item.aggregated_output
          : "";
        commandOutputChars += output.length;
        if (commandOutputChars > request.budgets.maxCommandOutputChars) {
          throw new AdapterFailure(
            "AGENT_BUDGET_EXCEEDED",
            "Codex command output exceeded its character budget.",
          );
        }
        commands.push({
          sequence: commands.length,
          canonicalCommandFamily: classifyCodexCommand(rawCommand, request),
          providerOperationId: typeof item.id === "string" ? item.id : null,
          status: item.status === "completed"
            ? "completed"
            : item.status === "failed"
            ? "failed"
            : invalidStatus(),
          exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
        });
      }
    } else if (event.type === "turn.completed") {
      if (usage) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "Codex emitted multiple completed turns.",
        );
      }
      const rawUsage = objectValue(event.usage);
      usage = requiredUsage(
        rawUsage?.input_tokens,
        rawUsage?.output_tokens,
        rawUsage?.cached_input_tokens,
      );
      resolvedModel = typeof event.model === "string" ? event.model : null;
    }
  }
  if (finalText === undefined) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Codex did not emit a final assistant message.",
    );
  }
  if (!usage) {
    throw new AdapterFailure(
      "AGENT_USAGE_UNAVAILABLE",
      "Codex did not emit completed-turn usage.",
    );
  }
  return {
    findings: parseFindingsObject(finalText),
    commands,
    usage,
    configuredModel: model ?? null,
    resolvedModel,
  };
}

function classifyCodexCommand(
  command: string,
  request: AgentEvaluationRequest,
): CanonicalCommandFamilyIdentifier {
  const normalized = command.toLowerCase();
  if (
    /(?:^|[;&|\n]\s*|["']\s*)sigil\s+(?!check\b)/.test(normalized) ||
    /\bgit\s+(?:add|apply|checkout|clean|commit|merge|mv|pull|push|rebase|reset|restore|rm|switch)\b/
      .test(normalized) ||
    /(?:^|[;&|\n]\s*|["']\s*)(?:rm|mv|cp|tee|curl|wget|ssh|scp|node|deno|python|perl|ruby)\b/
      .test(normalized)
  ) {
    throw new AdapterFailure(
      "AGENT_CAPABILITY_UNENFORCEABLE",
      "Codex emitted an unauthorized command operation.",
    );
  }
  const candidate = /\brg\s/.test(normalized)
    ? "workspace.grep"
    : /\b(?:sed|nl|head|tail|wc|stat)\s/.test(normalized)
    ? "workspace.read"
    : /\bls\s/.test(normalized)
    ? "workspace.list"
    : /\bfind\s/.test(normalized)
    ? "workspace.glob"
    : normalized.includes("git status")
    ? "git.status"
    : normalized.includes("git diff")
    ? "git.diff"
    : normalized.includes("git show")
    ? "git.show"
    : normalized.includes("git log")
    ? "git.log"
    : normalized.includes("git grep")
    ? "git.grep"
    : normalized.includes("git ls-files")
    ? "git.ls-files"
    : /(?:^|[;&|]\s*|["']\s*)sigil\s+check\b/.test(normalized)
    ? "sigil.check"
    : undefined;
  if (
    !candidate || !request.capabilities.allowedCommands.includes(candidate) ||
    request.capabilities.forbiddenCommands.includes(candidate)
  ) {
    throw new AdapterFailure(
      "AGENT_CAPABILITY_UNENFORCEABLE",
      "Codex emitted an unauthorized command operation.",
    );
  }
  return candidate;
}

function invalidStatus(): never {
  throw new AdapterFailure(
    "AGENT_EVENT_INVALID",
    "Codex command operation has no recognized terminal status.",
  );
}
