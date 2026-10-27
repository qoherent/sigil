/**
 * Runs one host process and keeps its raw output: the version probe, the
 * spawn with its timeout and cancellation, the output drains, and the final
 * message each host leaves. `launch.ts` builds a whole agent run on these.
 */
import { open, readFile } from "node:fs/promises";
import { asRecord, type HostName, type JsonObject } from "./hosts.ts";
import { isNotFound } from "./files.ts";
import {
  type CapturedStream,
  captureStream,
  type OwnedProcess,
  type ProcessStatus,
  settleWithin,
  signalOwnedProcess,
  spawnProcess,
} from "./process.ts";

export type AgentName = HostName;
export type AgentStatus = "completed" | "failed" | "timeout" | "cancelled";
/** `observed`: one value seen; `mixed`: several; `unverified`: none shown. */
export type Verification = "observed" | "unverified" | "mixed";
export type ModelVerification = Verification;
export type EffortVerification = Verification;

const OUTPUT_DRAIN_GRACE_MS = 500;
const TERMINATION_GRACE_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;

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
  /** Tool calls the host refused during the run; empty where the host shows none. */
  readonly permissionDenials: readonly string[];
}

export interface HostProcessRequest {
  readonly executable: string;
  /** Every argument, including the prompt. */
  readonly args: readonly string[];
  readonly cwd: string;
  /** Added to the inherited environment. */
  readonly env: Readonly<Record<string, string>>;
  /** Files the host's stdout and stderr are written to as they arrive. */
  readonly stdoutPath: string;
  readonly stderrPath: string;
  /** Epoch milliseconds after which the host is stopped as `timeout`. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

export type HostProcessOutcome =
  | { readonly kind: "launch-failed"; readonly error: string }
  | {
    readonly kind: "exited";
    /** Set when the host was stopped before it exited on its own. */
    readonly stopped: "timeout" | "cancelled" | null;
    readonly exitCode: number;
  };

/**
 * Start a host, write its output to the given files, and stop it with its
 * whole process tree on timeout or cancellation. Returns once the host has
 * exited and its output is drained, or a descendant holding the output open
 * has been stopped.
 */
export async function runHostProcess(
  request: HostProcessRequest,
): Promise<HostProcessOutcome> {
  let child: OwnedProcess;
  try {
    child = await spawnProcess(request.executable, {
      args: request.args,
      cwd: request.cwd,
      env: request.env,
      stdout: "piped",
      stderr: "piped",
      // On POSIX this gives the child a process group of its own. The
      // group can then be terminated even if the host exits before one of
      // its descendants closes the captured output streams.
      detached: true,
    });
  } catch (cause) {
    return { kind: "launch-failed", error: String(cause) };
  }
  const stdoutDrain = startDrain(child.stdout!, request.stdoutPath);
  const stderrDrain = startDrain(child.stderr!, request.stderrPath);
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
    Math.max(0, request.deadline - Date.now()),
  );
  const onAbort = () => stop("cancelled");
  request.signal?.addEventListener("abort", onAbort, { once: true });
  if (request.signal?.aborted) onAbort();
  try {
    const result = await child.status;
    await finishDrains(child, [stdoutDrain, stderrDrain], () => stopped);
    return { kind: "exited", stopped, exitCode: result.code };
  } finally {
    clearTimeout(timeout);
    if (forceTimer !== undefined) clearTimeout(forceTimer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The host's `--version` output, or null when it fails, is stopped, or does
 * not finish within the probe limit. `prefixArgs` come before `--version`.
 */
export async function probeVersion(
  executable: string,
  prefixArgs: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let child: OwnedProcess | undefined;
  const state: { status: ProcessStatus | null } = { status: null };
  let stopResolve: (() => void) | undefined;
  try {
    child = await spawnProcess(executable, {
      args: [...prefixArgs, "--version"],
      stdout: "piped",
      stderr: "null",
      detached: true,
    });
    const output = captureStream(child.stdout!, 16_384);
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
    const file = await open(path, "w");
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          offset += (await file.write(value, offset)).bytesWritten;
        }
      }
    } finally {
      reader.releaseLock();
      await file.close();
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
  child: OwnedProcess,
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
  child: OwnedProcess,
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

/**
 * The orchestrator's final message, as each host records it: Codex in its
 * last-message file, Claude Code in its `result` event, Pi in its last
 * assistant `message_end`. `events` are the host's parsed stdout. Null when
 * there is none.
 */
export async function extractFinalResponse(
  agent: AgentName,
  events: readonly JsonObject[],
  codexOutputFile: string,
): Promise<Uint8Array | null> {
  if (agent === "codex") {
    try {
      return new Uint8Array(await readFile(codexOutputFile));
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw cause;
    }
  }
  let final: string | null = null;
  for (const event of events) {
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
