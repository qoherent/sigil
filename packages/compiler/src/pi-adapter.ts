import type {
  AgentAdapter,
  AgentCommandTrace,
  AgentEvaluationRequest,
  AgentEvaluationResult,
  CanonicalCommandFamilyIdentifier,
} from "./types.ts";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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

// @sigil implements packages/compiler/src/pi-adapter.sigil::SigilPiAdapter::PiAdapter interface
export class PiAdapter implements AgentAdapter {
  readonly provider = "pi" as const;
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    approvalEscalation: false,
    ephemeral: true,
  } as const;
  private readonly useInstalledCredentials: boolean;

  constructor(
    readonly model?: string,
    private readonly runner: ProviderRunner = defaultProviderRunner,
    readonly id = "pi",
  ) {
    this.useInstalledCredentials = runner === defaultProviderRunner;
  }

  // @sigil implements packages/compiler/src/pi-adapter.sigil::SigilPiAdapter::PiInvocation logic,constraints
  async evaluate(
    request: AgentEvaluationRequest,
  ): Promise<AgentEvaluationResult> {
    const prompt = preflightAgentRequest(this, request);
    const stateRoot = await Deno.makeTempDir({ prefix: "sigil-pi-" });
    try {
      const isolatedStateRoot = await Deno.realPath(stateRoot);
      const authPath = this.useInstalledCredentials
        ? await linkInstalledPiCredentials(isolatedStateRoot)
        : undefined;
      await Deno.writeTextFile(
        `${isolatedStateRoot}/settings.json`,
        JSON.stringify({
          retry: { enabled: false, provider: { maxRetries: 0 } },
          telemetry: false,
        }),
      );
      const enabledTools = piTools(request);
      const profile = sandboxProfile(
        await Deno.realPath(request.workspaceAccess.agentRoot),
        isolatedStateRoot,
        await trustedRuntimeRoots(),
        authPath,
      );
      const result = await this.runner({
        command: "sandbox-exec",
        args: [
          "-p",
          profile,
          "pi",
          "--mode",
          "json",
          "--print",
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--no-approve",
          "--offline",
          "--tools",
          enabledTools.join(","),
          ...(this.model ? ["--model", this.model] : []),
          prompt,
        ],
        input: "",
        cwd: request.workspaceAccess.agentRoot,
        env: {
          PI_CODING_AGENT_DIR: isolatedStateRoot,
          PI_CODING_AGENT_SESSION_DIR: `${isolatedStateRoot}/sessions`,
          PI_OFFLINE: "1",
          PI_TELEMETRY: "0",
        },
        signal: providerSignal(request),
      });
      assertProviderExit("pi", result);
      return validateSettledResult(
        parsePiEvents(decodeProviderOutput(result.stdout), request, this.model),
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
        "Pi evaluation failed.",
        { cause: error },
      );
    } finally {
      await removeTemporaryPath(stateRoot);
    }
  }
}

function piTools(request: AgentEvaluationRequest): readonly string[] {
  const tools: string[] = [];
  for (const nativeTool of ["read", "grep", "find", "ls"]) {
    try {
      commandFamily(request.capabilities, nativeTool);
      tools.push(nativeTool);
    } catch (error) {
      if (!(error instanceof AdapterFailure)) throw error;
    }
  }
  return tools;
}

function sandboxProfile(
  workspaceRoot: string,
  stateRoot: string,
  runtimeRoots: readonly string[],
  authPath?: string,
): string {
  const readableSystemRoots = [
    "/System",
    "/Library",
    "/private",
    "/dev",
    "/usr",
    "/bin",
    "/sbin",
    "/opt/homebrew",
    "/Applications",
    Deno.execPath().replace(/\/[^/]+$/, ""),
    ...runtimeRoots,
  ];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow network-outbound)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    ...(authPath
      ? [`(allow file-read* (literal ${JSON.stringify(authPath)}))`]
      : []),
    ...[workspaceRoot, stateRoot, ...readableSystemRoots].map((path) =>
      `(allow file-read* (subpath ${JSON.stringify(path)}))`
    ),
    `(allow file-write* (subpath ${JSON.stringify(stateRoot)}))`,
    '(allow file-write* (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/null"))',
  ].join(" ");
}

async function linkInstalledPiCredentials(
  stateRoot: string,
): Promise<string | undefined> {
  let home: string | undefined;
  try {
    home = Deno.env.get("HOME");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotCapable)) throw error;
  }
  if (!home) return undefined;
  const authPath = resolve(home, ".pi", "agent", "auth.json");
  try {
    if (!(await Deno.stat(authPath)).isFile) return undefined;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  await Deno.symlink(authPath, resolve(stateRoot, "auth.json"));
  return authPath;
}

async function trustedRuntimeRoots(): Promise<readonly string[]> {
  const roots = new Set<string>();
  for (const executable of ["node", "pi"]) {
    const resolved = await findExecutable(executable);
    if (!resolved) continue;
    const real = await Deno.realPath(resolved).catch(() => resolved);
    roots.add(dirname(resolved));
    let current = dirname(real);
    while (current !== dirname(current)) {
      try {
        if ((await Deno.stat(`${current}/bin/node`)).isFile) {
          roots.add(current);
          break;
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      current = dirname(current);
    }
  }
  return [...roots];
}

async function findExecutable(name: string): Promise<string | undefined> {
  const result = await new Deno.Command("/usr/bin/which", {
    args: [name],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) return undefined;
  const path = new TextDecoder().decode(result.stdout).trim();
  return path || undefined;
}

function parsePiEvents(
  raw: string,
  request: AgentEvaluationRequest,
  model: string | undefined,
): AgentEvaluationResult {
  const commands: AgentCommandTrace[] = [];
  const started = new Map<string, CanonicalCommandFamilyIdentifier>();
  let finalText: string | undefined;
  let usage: ReturnType<typeof requiredUsage> | undefined;
  let resolvedModel: string | null = null;
  let sawAgentStart = false;
  let sawAgentEnd = false;
  let commandStarts = 0;
  let commandOutputChars = 0;
  for (const value of providerEventLines(raw, "Pi")) {
    const event = objectValue(value);
    if (!event || typeof event.type !== "string") {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        "Pi emitted an invalid event shape.",
      );
    }
    if (event.type === "session") continue;
    if (event.type === "agent_start") {
      if (sawAgentStart) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "Pi emitted duplicate agent_start.",
        );
      }
      sawAgentStart = true;
    } else if (event.type === "agent_end") {
      if (!sawAgentStart || sawAgentEnd) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "Pi agent lifecycle is invalid.",
        );
      }
      sawAgentEnd = true;
    } else if (event.type === "tool_execution_start") {
      const id = typeof event.toolCallId === "string"
        ? event.toolCallId
        : undefined;
      const tool = typeof event.toolName === "string"
        ? event.toolName
        : undefined;
      if (!id || !tool || started.has(id)) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "Pi tool start event is invalid.",
        );
      }
      if (commandStarts >= request.budgets.maxCommands) {
        throw new AdapterFailure(
          "AGENT_BUDGET_EXCEEDED",
          "Pi exceeded its command budget.",
        );
      }
      validatePiToolArguments(
        tool,
        event.args,
        request.workspaceAccess.agentRoot,
      );
      commandStarts++;
      started.set(id, commandFamily(request.capabilities, tool));
    } else if (event.type === "tool_execution_end") {
      const id = typeof event.toolCallId === "string"
        ? event.toolCallId
        : undefined;
      const family = id ? started.get(id) : undefined;
      if (!id || !family) {
        throw new AdapterFailure(
          "AGENT_EVENT_INVALID",
          "Pi tool end event has no matching start.",
        );
      }
      const output = normalizedPiToolOutput(event.result);
      commandOutputChars += output.length;
      if (commandOutputChars > request.budgets.maxCommandOutputChars) {
        throw new AdapterFailure(
          "AGENT_BUDGET_EXCEEDED",
          "Pi tool output exceeded its character budget.",
        );
      }
      commands.push({
        sequence: commands.length,
        canonicalCommandFamily: family,
        providerOperationId: id,
        status: event.isError === true ? "failed" : "completed",
        exitCode: null,
      });
      started.delete(id);
    } else if (event.type === "message_end") {
      const message = objectValue(event.message);
      if (message?.role === "assistant") {
        finalText = assistantText(message.content);
        const rawUsage = objectValue(message.usage);
        usage = requiredUsage(
          rawUsage?.input,
          rawUsage?.output,
          rawUsage?.cacheRead,
        );
        const eventModel = message.model ?? message.modelId;
        if (typeof eventModel === "string") resolvedModel = eventModel;
      }
    } else if (
      ![
        "turn_start",
        "turn_end",
        "message_start",
        "message_update",
        "tool_execution_update",
      ].includes(event.type)
    ) {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        `Pi emitted unsupported event ${JSON.stringify(event.type)}.`,
      );
    }
  }
  if (!sawAgentEnd || started.size) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Pi did not settle its agent and tool lifecycle.",
    );
  }
  if (finalText === undefined) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Pi emitted no final assistant message.",
    );
  }
  if (!usage) {
    throw new AdapterFailure(
      "AGENT_USAGE_UNAVAILABLE",
      "Pi emitted no final usage.",
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

function validatePiToolArguments(
  tool: string,
  value: unknown,
  workspaceRoot: string,
): void {
  const args = objectValue(value);
  if (!args) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Pi tool start event has invalid arguments.",
    );
  }
  for (const key of ["path", "cwd", "directory"]) {
    const path = args[key];
    if (path === undefined) continue;
    if (typeof path !== "string" || !workspacePath(path, workspaceRoot)) {
      throw new AdapterFailure(
        "AGENT_CAPABILITY_UNENFORCEABLE",
        `Pi ${tool} attempted to inspect a path outside the workspace.`,
      );
    }
  }
}

function workspacePath(path: string, workspaceRoot: string): boolean {
  const absolute = isAbsolute(path)
    ? resolve(path)
    : resolve(workspaceRoot, path);
  const rel = relative(resolve(workspaceRoot), absolute);
  return rel === "" || (rel !== ".." && !rel.startsWith("../"));
}

function assistantText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Pi assistant content is malformed.",
    );
  }
  return value.map((part) => {
    const object = objectValue(part);
    return object?.type === "text" && typeof object.text === "string"
      ? object.text
      : "";
  }).join("");
}

function normalizedPiToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  const object = objectValue(value);
  if (typeof object?.content === "string") return object.content;
  if (Array.isArray(object?.content)) {
    return object.content.map((part) => {
      const item = objectValue(part);
      return typeof item?.text === "string" ? item.text : "";
    }).join("");
  }
  return "";
}
