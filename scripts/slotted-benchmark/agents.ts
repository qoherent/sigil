import { delimiter, join, resolve } from "node:path";
import {
  analyzeHostStream,
  asRecord,
  buildHostLaunch,
  DEFAULT_CHILD_PROMPT,
  defaultCodexAuthPath,
  defaultPiSubagentsEntry,
  type HostName,
  parseJsonLines,
  prepareCodexHome,
  removeCodexAuth,
} from "./hosts.ts";
import {
  type CapturedStream,
  captureStream,
  settleWithin,
  signalOwnedProcess,
} from "./process.ts";

export type AgentName = HostName;
export type AgentStatus = "completed" | "failed" | "timeout" | "cancelled";
export type ModelVerification = "observed" | "unverified" | "mixed";

const OUTPUT_DRAIN_GRACE_MS = 500;
const TERMINATION_GRACE_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;

/** Shell programs the orchestrator may run on Claude Code; what the skill needs. */
export const ORCHESTRATOR_SHELL = [
  "sigil-claims",
  "mkdir",
  "cp",
  "mv",
  "ls",
  "cat",
  "test",
] as const;

/** Where each part of a pass lives, relative to the pass directory. */
export const PASS_LAYOUT = {
  skill: "skills/sigil-compute/SKILL.md",
  root: "root",
  store: "store",
  run: "run",
  bin: "bin",
} as const;

export interface AgentRunRequest {
  readonly agent: AgentName;
  readonly requestedModel: string;
  /**
   * Reasoning effort for the orchestrator and every child (codex: low..xhigh).
   * Absent: each host's own default applies and no child effort is checked.
   */
  readonly reasoning?: string;
  /** The prepared pass directory. It is the orchestrator's working directory. */
  readonly passDir: string;
  /** The directory the pinned `sigil-claims` is put on PATH from. */
  readonly binDir: string;
  /** Attempt-specific retained directory outside the pass directory. */
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Overrides PATH lookup, useful for a pinned executable or a fake host. */
  readonly executable?: string;
  /** Codex: the auth file copied into the scratch CODEX_HOME for the run. */
  readonly codexAuthPath?: string;
  /** Pi: the pi-subagents extension entry loaded with `-e`. */
  readonly piSubagentsEntry?: string;
}

export type EffortVerification = "observed" | "unverified" | "mixed";

/** What the host showed about the children the orchestrator started. */
export interface ChildObservation {
  /** Child sessions seen, or null when the host does not show them. */
  readonly count: number | null;
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  /** `unverified` when the host exposes no child effort. */
  readonly effortVerification: EffortVerification;
  /** Evidence about whether each child began without the parent's context. */
  readonly freshEvidence: readonly string[];
  readonly observedFrom: string | null;
}

export interface AgentRunResult {
  readonly status: AgentStatus;
  readonly failureStep: "launch" | "orchestrator" | "artifact" | null;
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly agent: AgentName;
  readonly requestedModel: string;
  /** The reasoning effort requested for orchestrator and children, if any. */
  readonly requestedEffort: string | null;
  readonly observedModels: readonly string[];
  readonly modelVerification: ModelVerification;
  readonly children: ChildObservation;
  readonly hostVersion: string | null;
  readonly executable: string;
  /** Effective CLI flags, excluding the prompt (retained separately). */
  readonly settings: readonly string[];
  readonly isolationLimits: readonly string[];
  readonly passDir: string;
  readonly promptPath: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  /** Exact final message bytes. Null when the orchestrator never completed one. */
  readonly finalResponsePath: string | null;
}

export interface OrchestratorPromptInput {
  /** How the host starts a child; from the host's launch settings. */
  readonly spawnInstruction: string;
  readonly model: string;
  readonly effort: string | null;
}

/** The states an orchestrator may hand back; `failed` means it stopped on a failure. */
export const HANDBACK_STATES = [
  "coherent",
  "loose",
  "disjoint",
  "incomplete",
  "failed",
] as const;
export type HandbackState = typeof HANDBACK_STATES[number];

/**
 * The orchestrator prompt. The child instructions (return nothing for context
 * rows, write the answer to a file) live in the sigil-compute skill's handoff,
 * not here: this names the staged skill, where everything is, and what the
 * benchmark requires.
 */
export function orchestratorPrompt(input: OrchestratorPromptInput): string {
  const effort = input.effort
    ? `reasoning effort ${input.effort}`
    : "the host's default reasoning effort";
  const { skill, root, store, run } = PASS_LAYOUT;
  return [
    "Run the sigil-compute skill's full-design action on the Sigil design in this directory, end to end.",
    "",
    `Read ${skill} first, then the orchestration contract it names, skills/sigil-compute/references/computed-evaluation.md. Use only these staged copies: skills/sigil-compute, skills/sigil-understand and skills/sigil-egglog sit beside each other here, and the reading children load the last two from there. Do not use a copy of any of these skills installed elsewhere on this machine.`,
    "",
    `- The workspace root is \`${root}\`. Pass \`--root ${root}\` to every sigil-claims command. The workspace has no stored readings, so the seed the skill takes from its store is empty.`,
    `- The private store is \`${store}\`, not a directory inside \`${run}\`: this replaces the contract's default location. It starts empty. Pass \`--store ${store}\` to every sigil-claims command, including the final check.`,
    `- Keep the run directory, preparations, seeds and every answer file under \`${run}\`. A child writes its answer to a file under \`${run}\` named \`<source>-answer-<round>.egg\`, which is plain egglog text with one claim row per line — never JSON. The child writes each row from reading the prose and never drops rows in bulk. You pass that exact file to ingest and never set an answer aside yourself: ingest decides.`,
    `- Run the tool as \`./bin/sigil-claims\` wherever the skill writes \`sigil-claims\`. A \`sigil-claims\` found elsewhere on this machine is a different version and must not be used. Never edit the design files.`,
    "",
    `Every reading, including each re-ask, comes from a fresh child that inherits none of your conversation. ${input.spawnInstruction} Children run with model ${input.model} at ${effort}; the host is already set to that, so do not pass a model or effort override when starting a child. Never write, edit or repair rows yourself.`,
    "",
    "Do not read anything outside this directory except the tool and the files it names. There is no answer key to look for. Finish the whole action, including the write-back and the final check, then stop.",
    "",
    `Your final message must report the final check's state, its unread units and the findings it lists, and must end with exactly one line of the form \`Hand-back state: STATE\`, where STATE is coherent, loose, disjoint or incomplete (the check's state), or failed if you stopped on a failure.`,
    "",
  ].join("\n");
}

/** Read the state an orchestrator handed back from its final message. */
export function parseHandbackState(text: string): HandbackState | null {
  let state: HandbackState | null = null;
  for (
    const match of text.matchAll(
      /^[\s*_`>-]*Hand-back state:\s*[*_`]*\s*([A-Za-z]+)/gim,
    )
  ) {
    const word = match[1].toLowerCase();
    state = (HANDBACK_STATES as readonly string[]).includes(word)
      ? word as HandbackState
      : null;
  }
  return state;
}

/**
 * Launches one orchestrator process in its pass directory and retains its raw
 * evidence. The process runs the whole sigil-compute action; this function does
 * not read or judge what it produced.
 */
export async function runOrchestrator(
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  const deadline = Date.now() + request.timeoutMs;
  const passDir = resolve(request.passDir);
  const evidenceDir = resolve(request.evidenceDir);
  await Deno.mkdir(evidenceDir, { recursive: true });
  const promptPath = join(evidenceDir, "prompt.txt");
  const stdoutPath = join(evidenceDir, "stdout.jsonl");
  const stderrPath = join(evidenceDir, "stderr.txt");
  const finalPath = join(evidenceDir, "final-response.txt");
  const codexHome = join(evidenceDir, "codex-home");
  const lastMessagePath = join(evidenceDir, "codex-last-message.txt");
  await Deno.writeFile(stdoutPath, new Uint8Array());
  await Deno.writeFile(stderrPath, new Uint8Array());

  const executable = request.executable ?? request.agent;
  const requestedEffort = request.reasoning ?? null;
  let settings: string[] = [];
  let isolationLimits: readonly string[] = [];
  let hostVersion: string | null = null;
  let status: AgentStatus = "failed";
  let failureStep: AgentRunResult["failureStep"] = null;
  let error: string | null = null;
  let exitCode: number | null = null;
  let finalResponsePath: string | null = null;
  try {
    let launch;
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
        allowedShell: ORCHESTRATOR_SHELL,
        childPrompt: DEFAULT_CHILD_PROMPT,
        piSubagentsEntry: request.piSubagentsEntry ??
          defaultPiSubagentsEntry(),
      });
    } catch (cause) {
      failureStep = "launch";
      error = String(cause);
      await Deno.writeTextFile(promptPath, "");
      return await buildResult();
    }
    settings = launch.args.filter((arg) => arg !== "--");
    isolationLimits = launch.isolationLimits;
    const prompt = orchestratorPrompt({
      spawnInstruction: launch.spawnInstruction,
      model: request.requestedModel,
      effort: requestedEffort,
    });
    await Deno.writeTextFile(promptPath, prompt);
    const env = {
      ...launch.env,
      PATH: [resolve(request.binDir), Deno.env.get("PATH") ?? ""].join(
        delimiter,
      ),
    };
    if (request.signal?.aborted) {
      status = "cancelled";
    } else if (Date.now() >= deadline) {
      status = "timeout";
    } else {
      hostVersion = await probeVersion(
        executable,
        Math.max(0, deadline - Date.now()),
        request.signal,
      );
      if (request.signal?.aborted) {
        status = "cancelled";
      } else if (Date.now() >= deadline) {
        status = "timeout";
      } else {
        let child: Deno.ChildProcess;
        try {
          child = new Deno.Command(executable, {
            args: [...launch.args, prompt],
            cwd: passDir,
            env,
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            // On POSIX this gives the child a process group of its own. The
            // group can then be terminated even if the host exits before one of
            // its descendants closes the captured output streams.
            detached: true,
          }).spawn();
        } catch (cause) {
          failureStep = "launch";
          error = String(cause);
          return await buildResult();
        }
        const stdoutDrain = startDrain(child.stdout, stdoutPath);
        const stderrDrain = startDrain(child.stderr, stderrPath);
        let stopped: "timeout" | "cancelled" | null = null;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        const stop = (reason: "timeout" | "cancelled") => {
          if (stopped) return;
          stopped = reason;
          void signalOwnedProcess(child, "SIGTERM");
          forceTimer = setTimeout(() => {
            void signalOwnedProcess(child, "SIGKILL");
          }, TERMINATION_GRACE_MS);
        };
        const timeout = setTimeout(
          () => stop("timeout"),
          Math.max(0, deadline - Date.now()),
        );
        const onAbort = () => stop("cancelled");
        request.signal?.addEventListener("abort", onAbort, { once: true });
        if (request.signal?.aborted) onAbort();
        try {
          const result = await child.status;
          exitCode = result.code;
          await finishDrains(child, [stdoutDrain, stderrDrain], () => stopped);
        } finally {
          clearTimeout(timeout);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          request.signal?.removeEventListener("abort", onAbort);
        }
        if (stopped) {
          status = stopped;
        } else if (exitCode !== 0) {
          status = "failed";
          failureStep = "orchestrator";
          error = `Agent exited ${exitCode}`;
        } else {
          const final = await extractFinalResponse(
            request.agent,
            stdoutPath,
            lastMessagePath,
          );
          if (final === null) {
            status = "failed";
            failureStep = "artifact";
            error = "Agent completed without a final response";
          } else {
            await Deno.writeFile(finalPath, final);
            finalResponsePath = finalPath;
            status = "completed";
          }
        }
      }
    }
  } finally {
    // Credentials never stay in retained evidence, whatever way the run ended.
    if (request.agent === "codex") await removeCodexAuth(codexHome);
  }
  return await buildResult();

  async function buildResult(): Promise<AgentRunResult> {
    const analysis = await analyzeHostStream(
      request.agent,
      parseJsonLines(await Deno.readTextFile(stdoutPath)),
      request.agent === "codex" ? codexHome : undefined,
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
    };
  }
}

async function probeVersion(
  executable: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let child: Deno.ChildProcess | undefined;
  const state: { status: Deno.CommandStatus | null } = { status: null };
  let stopResolve: (() => void) | undefined;
  try {
    child = new Deno.Command(executable, {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
      detached: true,
    }).spawn();
    const output = captureStream(child.stdout, 16_384);
    const statusDone = child.status.then((result) => {
      state.status = result;
    });
    const stopPromise = new Promise<void>((resolve) => {
      stopResolve = resolve;
    });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      void signalOwnedProcess(child!, "SIGTERM");
      stopResolve?.();
      forceTimer = setTimeout(() => {
        void signalOwnedProcess(child!, "SIGKILL");
      }, OUTPUT_DRAIN_GRACE_MS);
    };
    const timer = setTimeout(
      stop,
      Math.max(0, Math.min(timeoutMs, PROBE_TIMEOUT_MS)),
    );
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    try {
      await Promise.race([statusDone, stopPromise]);
      if (state.status === null) {
        await settleWithin(statusDone, TERMINATION_GRACE_MS + 250);
        if (state.status === null) {
          await signalOwnedProcess(child, "SIGKILL");
          await settleWithin(statusDone, OUTPUT_DRAIN_GRACE_MS);
        }
      }
      const outputFinished = await finishProbeOutput(
        child,
        output,
        () => stopped,
      );
      const probeStatus = state.status;
      return !stopped && outputFinished && probeStatus?.success
        ? new TextDecoder().decode(output.read()).trim()
        : null;
    } finally {
      clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      signal?.removeEventListener("abort", stop);
    }
  } catch {
    if (child) {
      try {
        await signalOwnedProcess(child, "SIGKILL");
      } catch { /* Best effort cleanup after a failed probe. */ }
    }
    return null;
  }
}

interface StreamDrain {
  readonly done: Promise<void>;
  cancel(): void;
}

function startDrain(
  stream: ReadableStream<Uint8Array>,
  path: string,
): StreamDrain {
  const reader = stream.getReader();
  const done = (async () => {
    const file = await Deno.open(path, { write: true, truncate: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          offset += await file.write(value.subarray(offset));
        }
      }
    } finally {
      reader.releaseLock();
      file.close();
    }
  })();
  return {
    done,
    cancel() {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* The reader may have completed between the check and cancel. */
      }
    },
  };
}

async function finishDrains(
  child: Deno.ChildProcess,
  drains: readonly StreamDrain[],
  wasStopped: () => "timeout" | "cancelled" | null,
): Promise<void> {
  const allDone = Promise.all(drains.map((drain) => drain.done));
  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) {
    await allDone;
    return;
  }

  // A host can exit while a descendant still owns stdout or stderr. Signal
  // the detached process group even though the host status promise has ended.
  if (wasStopped() === null) {
    await signalOwnedProcess(child, "SIGTERM");
    const forceTimer = setTimeout(
      () => void signalOwnedProcess(child, "SIGKILL"),
      OUTPUT_DRAIN_GRACE_MS,
    );
    const ended = await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS + 100);
    if (!ended) await signalOwnedProcess(child, "SIGKILL");
    clearTimeout(forceTimer);
  } else {
    // Let the timeout/cancellation's existing SIGKILL grace elapse, but never
    // wait indefinitely for a descendant to close an inherited pipe.
    const ended = await settleWithin(allDone, TERMINATION_GRACE_MS + 250);
    if (!ended) await signalOwnedProcess(child, "SIGKILL");
  }

  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) {
    await allDone;
    return;
  }
  for (const drain of drains) drain.cancel();
  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) await allDone;
}

async function finishProbeOutput(
  child: Deno.ChildProcess,
  output: CapturedStream,
  wasStopped: () => boolean,
): Promise<boolean> {
  const ended = await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
  if (ended) return true;
  if (!wasStopped()) await signalOwnedProcess(child, "SIGTERM");
  await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
  if (!output.isDone()) await signalOwnedProcess(child, "SIGKILL");
  if (await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS)) return true;
  output.cancel();
  return await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
}

async function extractFinalResponse(
  agent: AgentName,
  stdoutPath: string,
  codexOutputFile: string,
): Promise<Uint8Array | null> {
  if (agent === "codex") {
    try {
      return await Deno.readFile(codexOutputFile);
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound) return null;
      throw cause;
    }
  }
  let final: string | null = null;
  for (const event of parseJsonLines(await Deno.readTextFile(stdoutPath))) {
    if (
      agent === "claude" && event.type === "result" &&
      typeof event.result === "string"
    ) {
      final = event.result;
    }
    if (agent === "pi" && event.type === "message_end") {
      const message = asRecord(event.message);
      if (message?.role !== "assistant" || !Array.isArray(message.content)) {
        continue;
      }
      final = message.content.map((part) => {
        const block = asRecord(part);
        return block?.type === "text" && typeof block.text === "string"
          ? block.text
          : "";
      }).join("");
    }
  }
  return final === null ? null : new TextEncoder().encode(final);
}
