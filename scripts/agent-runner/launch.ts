/**
 * Launches one orchestrator in its pass directory and retains its raw
 * evidence: the prompt, the host's events and stderr, and its exact final
 * message. The caller supplies what differs between stages: the prompt, the
 * shell allowlist, the child agent definitions and the hand-back parser.
 * This module does not read or judge what the run produced.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import {
  type AgentName,
  type AgentRunResult,
  type AgentStatus,
  extractFinalResponse,
  probeVersion,
  runHostProcess,
} from "./agents.ts";
import {
  analyzeHostStream,
  buildHostLaunch,
  type ChildAgentDefinition,
  defaultCodexAuthPath,
  defaultPiSubagentsEntry,
  type HostLaunch,
  type JsonObject,
  parseJsonLines,
  prepareCodexHome,
  removeCodexAuth,
} from "./hosts.ts";

/** What a prompt may depend on, known only once the host is chosen. */
export interface PromptContext {
  /** How this host starts a child; from the host's launch settings. */
  readonly spawnInstruction: string;
  readonly model: string;
  readonly effort: string | null;
}

export interface LaunchRequest<H> {
  readonly agent: AgentName;
  /** The model of the orchestrator and every child. */
  readonly requestedModel: string;
  /**
   * Reasoning effort for the orchestrator and every child.
   * Absent: each host's own default applies.
   */
  readonly reasoning?: string;
  /** The prepared pass directory. It is the orchestrator's working directory. */
  readonly passDir: string;
  /** A directory put first on PATH, holding the pinned binaries. */
  readonly binDir: string;
  /** Attempt-specific retained directory outside the pass directory. */
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Overrides PATH lookup, useful for a pinned executable or a fake host. */
  readonly executable?: string;
  /**
   * Arguments placed before the host's own, for the version probe as well:
   * a script path when `executable` is an interpreter running a fake host.
   */
  readonly executableArgs?: readonly string[];
  /** Codex: the auth file copied into the scratch CODEX_HOME for the run. */
  readonly codexAuthPath?: string;
  /** Pi: the pi-subagents extension entry loaded with `-e`. */
  readonly piSubagentsEntry?: string;
  /** Builds the orchestrator prompt once the host's settings are known. */
  readonly prompt: (context: PromptContext) => string;
  /** Claude Code: shell commands the orchestrator may run, by program name. */
  readonly allowedShell: readonly string[];
  /** The child agents the orchestrator may start; at least one. */
  readonly children: readonly ChildAgentDefinition[];
  /**
   * Arguments added after the host's own settings, such as Claude Code's
   * `--settings`. Default: none.
   */
  readonly hostArgs?: readonly string[];
  /** Reads the hand-back from the final message; null when there is none. */
  readonly parseHandback: (finalText: string) => H | null;
}

export interface LaunchResult<H> extends AgentRunResult {
  /** The parsed hand-back of a completed run; null otherwise. */
  readonly handback: H | null;
}

/**
 * Launches one orchestrator process in its pass directory and retains its raw
 * evidence under `evidenceDir`: `prompt.txt`, `stdout.jsonl`, `stderr.txt`
 * and, once the run completes, `final-response.txt`. A Codex run also keeps
 * its scratch `codex-home`, without credentials.
 */
export async function launchAgent<H>(
  request: LaunchRequest<H>,
): Promise<LaunchResult<H>> {
  const deadline = Date.now() + request.timeoutMs;
  const passDir = resolve(request.passDir);
  const evidenceDir = resolve(request.evidenceDir);
  await mkdir(evidenceDir, { recursive: true });
  const promptPath = join(evidenceDir, "prompt.txt");
  const stdoutPath = join(evidenceDir, "stdout.jsonl");
  const stderrPath = join(evidenceDir, "stderr.txt");
  const finalPath = join(evidenceDir, "final-response.txt");
  const codexHome = join(evidenceDir, "codex-home");
  const lastMessagePath = join(evidenceDir, "codex-last-message.txt");
  await writeFile(stdoutPath, new Uint8Array());
  await writeFile(stderrPath, new Uint8Array());

  const executable = request.executable ?? request.agent;
  const prefixArgs = request.executableArgs ?? [];
  const requestedEffort = request.reasoning ?? null;
  let settings: string[] = [];
  let isolationLimits: readonly string[] = [];
  let hostVersion: string | null = null;
  let status: AgentStatus = "failed";
  let failureStep: AgentRunResult["failureStep"] = null;
  let error: string | null = null;
  let exitCode: number | null = null;
  let finalResponsePath: string | null = null;
  let handback: H | null = null;
  // The host's stdout, parsed once it has exited and its output is drained.
  let events: readonly JsonObject[] | null = null;
  const hostEvents = async () =>
    events ??= parseJsonLines(await readFile(stdoutPath, "utf8"));
  try {
    let launch: HostLaunch;
    try {
      if (request.agent === "codex") {
        await prepareCodexHome(
          codexHome,
          request.codexAuthPath ?? defaultCodexAuthPath(),
        );
      }
      launch = await buildHostLaunch({
        host: request.agent,
        model: request.requestedModel,
        effort: request.reasoning,
        childModel: request.requestedModel,
        childEffort: request.reasoning,
        passDir,
        codexHome: request.agent === "codex" ? codexHome : undefined,
        lastMessagePath: request.agent === "codex"
          ? lastMessagePath
          : undefined,
        allowedShell: request.allowedShell,
        children: request.children,
        piSubagentsEntry: request.piSubagentsEntry ??
          defaultPiSubagentsEntry(),
        hostArgs: request.hostArgs,
      });
    } catch (cause) {
      failureStep = "launch";
      error = String(cause);
      await writeFile(promptPath, "");
      return await buildResult();
    }
    settings = launch.args.filter((arg) => arg !== "--");
    isolationLimits = launch.isolationLimits;
    const prompt = request.prompt({
      spawnInstruction: launch.spawnInstruction,
      model: request.requestedModel,
      effort: requestedEffort,
    });
    await writeFile(promptPath, prompt);
    const env = {
      ...launch.env,
      PATH: [resolve(request.binDir), process.env.PATH ?? ""].join(delimiter),
    };
    if (request.signal?.aborted) {
      status = "cancelled";
    } else if (Date.now() >= deadline) {
      status = "timeout";
    } else {
      hostVersion = await probeVersion(
        executable,
        prefixArgs,
        Math.max(0, deadline - Date.now()),
        request.signal,
      );
      if (request.signal?.aborted) {
        status = "cancelled";
      } else if (Date.now() >= deadline) {
        status = "timeout";
      } else {
        const outcome = await runHostProcess({
          executable,
          args: [...prefixArgs, ...launch.args, prompt],
          cwd: passDir,
          env,
          stdoutPath,
          stderrPath,
          deadline,
          signal: request.signal,
        });
        if (outcome.kind === "launch-failed") {
          failureStep = "launch";
          error = outcome.error;
          return await buildResult();
        }
        exitCode = outcome.exitCode;
        if (outcome.stopped) {
          status = outcome.stopped;
        } else if (exitCode !== 0) {
          status = "failed";
          failureStep = "orchestrator";
          error = `Agent exited ${exitCode}`;
        } else {
          const final = await extractFinalResponse(
            request.agent,
            await hostEvents(),
            lastMessagePath,
          );
          if (final === null) {
            status = "failed";
            failureStep = "artifact";
            error = "Agent completed without a final response";
          } else {
            await writeFile(finalPath, final);
            finalResponsePath = finalPath;
            status = "completed";
            handback = request.parseHandback(new TextDecoder().decode(final));
          }
        }
      }
    }
  } finally {
    // Credentials never stay in retained evidence, whatever way the run ended.
    if (request.agent === "codex") await removeCodexAuth(codexHome);
  }
  return await buildResult();

  async function buildResult(): Promise<LaunchResult<H>> {
    const analysis = await analyzeHostStream(
      request.agent,
      await hostEvents(),
      {
        childNames: request.children.map((child) => child.name),
        codexHome: request.agent === "codex" ? codexHome : undefined,
      },
    );
    const effortCount = analysis.childEfforts.length;
    return {
      status,
      failureStep,
      error,
      exitCode,
      agent: request.agent,
      requestedModel: request.requestedModel,
      requestedEffort,
      observedModels: analysis.models,
      modelVerification: analysis.models.length === 0
        ? "unverified"
        : analysis.models.length === 1
        ? "observed"
        : "mixed",
      children: {
        count: analysis.childCount,
        models: analysis.childModels,
        efforts: analysis.childEfforts,
        effortVerification: effortCount === 0
          ? "unverified"
          : effortCount === 1
          ? "observed"
          : "mixed",
        freshEvidence: analysis.freshEvidence,
        observedFrom: analysis.observedFrom,
      },
      hostVersion,
      executable,
      settings,
      isolationLimits,
      passDir,
      promptPath,
      stdoutPath,
      stderrPath,
      finalResponsePath,
      permissionDenials: analysis.permissionDenials,
      handback,
    };
  }
}
