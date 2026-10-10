import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { captureStream, settleWithin, signalOwnedProcess } from "./process.ts";
import {
  type AgentRunResult,
  type HandbackState,
  parseHandbackState,
  PASS_LAYOUT,
} from "./agents.ts";
import { copySkill, copyTree, exists, sha256, treeSha256 } from "./files.ts";

type JsonObject = Record<string, unknown>;
/** The linked check's state; ingest and the check share these four. */
export type ComputedState =
  | "coherent"
  | "loose"
  | "disjoint"
  | "incomplete"
  | "closed"
  | "converged"
  | "drift";
/** The report version the pinned `sigilc` writes. */
export const LINKED_REPORT_VERSION = 6;

/** The budget a check keeps even when the orchestrator used the whole pass. */
const CHECK_BUDGET_FLOOR_MS = 30_000;
/** The extra budget the partial-evidence check gets after a timeout. */
const EVIDENCE_CHECK_BUDGET_MS = 60_000;

export interface LinkedEvidenceInput {
  readonly privateStore: string;
  readonly exitCode: number;
  /** The workspace digest the fixture's preflight reported. */
  readonly workspaceDigest: string | null;
  readonly guidanceFingerprint: string;
  readonly vocabularyGeneration: unknown;
  /** The memo keys present in the private store when the check ran. */
  readonly memoKeys: readonly string[];
  readonly result: JsonObject;
  readonly report: JsonObject;
  readonly context: JsonObject;
}

export interface LinkedValidation {
  readonly valid: boolean;
  readonly state: ComputedState | null;
  readonly errors: readonly string[];
}

/** Validates the linked check's identity, exit code and completeness. */
export function validateLinkedEvidence(
  input: LinkedEvidenceInput,
): LinkedValidation {
  const errors: string[] = [];
  const { result, report, context } = input;
  const state = result.state;
  const identity = object(report.identity);
  const contextIdentity = object(context.identity);
  const linked = object(report.linked);
  const unread = array(report.unread);
  const unresolved = array(report.unresolvedImports);
  const expectedExit = state === "disjoint" || state === "incomplete"
    ? 1
    : state === "coherent" || state === "loose"
    ? 0
    : null;
  if (expectedExit === null || input.exitCode !== expectedExit) {
    errors.push("exit code and linked state mismatch");
  }
  if (report.state !== state || report.version !== result.version) {
    errors.push("linked report state or version mismatch");
  }
  if (report.version !== LINKED_REPORT_VERSION) {
    errors.push(`linked report version is not ${LINKED_REPORT_VERSION}`);
  }
  if (
    result.scope !== "workspace" || report.source !== "workspace" ||
    context.source !== "workspace"
  ) {
    errors.push("linked scope is not the workspace");
  }
  if (result.findings !== array(report.findings).length) {
    errors.push("finding count mismatch");
  }
  if (
    result.guidanceFingerprint !== input.guidanceFingerprint ||
    result.vocabularyGeneration !== input.vocabularyGeneration
  ) {
    errors.push("linked guidance identity mismatch");
  }
  for (
    const [name, observed] of [["report", identity], [
      "context",
      contextIdentity,
    ]] as const
  ) {
    if (
      !observed ||
      observed.guidanceFingerprint !== input.guidanceFingerprint ||
      observed.vocabularyGeneration !== input.vocabularyGeneration
    ) {
      errors.push(`linked ${name} identity mismatch`);
    }
  }
  if (
    input.workspaceDigest !== null &&
    (result.workspaceDigest !== input.workspaceDigest ||
      linked?.workspaceDigest !== input.workspaceDigest)
  ) {
    errors.push("linked workspace digest mismatch");
  }
  const keys = array(identity?.interpretations);
  const present = new Set(input.memoKeys);
  if (
    !keys.every((key) => typeof key === "string" && present.has(key)) ||
    [...keys].sort().join("\n") !== keys.join("\n")
  ) {
    errors.push("linked interpretations are not stored sorted memo keys");
  }
  if (
    !sameArray(contextIdentity?.interpretations, keys)
  ) {
    errors.push("linked context interpretations differ from the report");
  }
  const incomplete = unread.length > 0 || unresolved.length > 0;
  if (incomplete && state !== "disjoint" && state !== "incomplete") {
    errors.push(`unread units or unresolved imports reported as ${state}`);
  }
  if (state === "incomplete" && !incomplete) {
    errors.push("incomplete state with nothing unread or unresolved");
  }
  if (
    !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
  ) {
    errors.push("result path outside private root");
  }
  return {
    valid: errors.length === 0,
    state: errors.length === 0 ? state as ComputedState : null,
    errors,
  };
}

/** What the benchmark expects of every pass, fixed when the batch starts. */
export interface PassExpectations {
  /** The workspace digest, guidance and vocabulary the fixture's preflight saw. */
  readonly workspaceDigest: string;
  readonly guidanceFingerprint: string;
  readonly vocabularyGeneration: unknown;
  /** Hash of the fixture's own `.sigil` directory when the batch started. */
  readonly fixtureStateSha256: string;
  /** Hashes of the pinned skill trees every pass stages. */
  readonly skillSha256: Readonly<Record<string, string>>;
}

export const STAGED_SKILLS = [
  "sigil-compute-design",
  "sigil-understand",
  "sigil-egglog",
] as const;
export type StagedSkill = typeof STAGED_SKILLS[number];

export interface PassRequest {
  readonly action?: "design" | "implementation";
  /** The pinned `sigilc`. The orchestrator gets it on PATH; the benchmark runs the check with it. */
  readonly executable: string;
  /** The fixture workspace. It is copied, never exposed in place. */
  readonly fixtureRoot: string;
  /** The pass directory: the orchestrator's working directory, kept as evidence. */
  readonly passDir: string;
  /** Where the host's raw output and the check's output are kept. */
  readonly evidenceDir: string;
  readonly skillDirs: {
    readonly computeDir: string;
    readonly understandDir: string;
    readonly egglogDir: string;
    readonly alignDir?: string;
  };
  readonly expected: PassExpectations;
  /** The effort requested for every child, or null when none was requested. */
  readonly requestedEffort: string | null;
  /** Bounds the whole pass: staging, the orchestrator and, mostly, the check. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly orchestrate: (
    passDir: string,
    binDir: string,
    evidenceDir: string,
    timeoutMs: number,
  ) => Promise<AgentRunResult>;
}

export interface LinkedCheckResult {
  readonly exitCode: number | null;
  readonly result: JsonObject | null;
  readonly report: JsonObject | null;
  readonly context: JsonObject | null;
  readonly validation: LinkedValidation | null;
  readonly error: string | null;
}

export interface PassResult {
  /**
   * valid: the benchmark's own check validated and the orchestrator agreed.
   * invalid: something makes the evidence untrustworthy (see `error`).
   * failed: the pass did not produce a scorable check.
   * interrupted: a timeout or cancellation ended it; the evidence is partial.
   */
  readonly status: "valid" | "invalid" | "failed" | "interrupted";
  readonly failureStep:
    | "setup"
    | "orchestrator"
    | "handback"
    | "check"
    | "validation"
    | "fixture"
    | "effort"
    | null;
  readonly error: string | null;
  /** The benchmark's own check state, once the pass is valid. */
  readonly state: ComputedState | null;
  /** The state the orchestrator handed back, or null when it gave none. */
  readonly handbackState: HandbackState | null;
  /** Units the benchmark's own check reports unread, when it ran. */
  readonly unreadUnits: number | null;
  readonly agent: AgentRunResult | null;
  readonly linked: LinkedCheckResult | null;
  readonly fixture: {
    readonly sha256Before: string | null;
    readonly sha256After: string | null;
  };
  readonly staged: {
    readonly skillSha256: Readonly<Record<string, string>>;
    /** Entries in the private store, and whether the copied root held a claims store, at pass start. */
    readonly storeEntriesAtStart: number;
    readonly rootClaimsAtStart: boolean;
  } | null;
}

/**
 * Build one pass: a copy of the fixture that keeps `.sigil/config.json` and has
 * no `.sigil/claims/` store, the three skills staged as siblings, the pinned
 * `sigilc` behind `bin/`, an empty private store and an empty run
 * directory. A pass directory whose store is not empty is refused.
 */
export async function preparePass(
  input: Pick<
    PassRequest,
    | "executable"
    | "fixtureRoot"
    | "passDir"
    | "skillDirs"
    | "expected"
    | "action"
  >,
): Promise<NonNullable<PassResult["staged"]>> {
  const passDir = resolve(input.passDir);
  const store = join(passDir, PASS_LAYOUT.store);
  await Deno.mkdir(store, { recursive: true });
  const storeEntries: string[] = [];
  for await (const entry of Deno.readDir(store)) storeEntries.push(entry.name);
  if (storeEntries.length > 0) {
    throw new Error("private claims store is not empty");
  }
  const root = join(passDir, PASS_LAYOUT.root);
  if (await exists(root)) throw new Error("pass directory already has a root");
  await copyTree(
    input.fixtureRoot,
    root,
    new Set([".sigil/claims"]),
  );
  if (!await exists(join(root, ".sigil/config.json"))) {
    throw new Error("copied root lacks .sigil/config.json");
  }
  const rootClaimsAtStart = await exists(join(root, ".sigil/claims"));
  if (rootClaimsAtStart) throw new Error("copied root holds a claims store");
  await Deno.mkdir(join(passDir, PASS_LAYOUT.run), { recursive: true });

  const skillSha256: Record<string, string> = {};
  const sources: Record<StagedSkill, string> = {
    "sigil-compute-design": input.skillDirs.computeDir,
    "sigil-understand": input.skillDirs.understandDir,
    "sigil-egglog": input.skillDirs.egglogDir,
  };
  for (const name of STAGED_SKILLS) {
    const staged = join(passDir, "skills", name);
    await copySkill(sources[name], staged);
    skillSha256[name] = await treeSha256(staged);
    if (skillSha256[name] !== input.expected.skillSha256[name]) {
      throw new Error(`staged ${name} differs from the pinned copy`);
    }
  }
  if (input.action === "implementation") {
    if (!input.skillDirs.alignDir) {
      throw new Error("alignment skill is missing");
    }
    const staged = join(passDir, "skills/sigil-compute-align");
    await copySkill(input.skillDirs.alignDir, staged);
    skillSha256["sigil-compute-align"] = await treeSha256(staged);
    if (
      skillSha256["sigil-compute-align"] !==
        input.expected.skillSha256["sigil-compute-align"]
    ) throw new Error("staged alignment skill differs from pinned copy");
  }
  const bin = join(passDir, PASS_LAYOUT.bin);
  await Deno.mkdir(bin, { recursive: true });
  await Deno.symlink(resolve(input.executable), join(bin, "sigilc"));
  return {
    skillSha256,
    storeEntriesAtStart: storeEntries.length,
    rootClaimsAtStart,
  };
}

/**
 * Run one pass: one orchestrator process runs the sigil-compute-design whole-design
 * action in the pass directory, then the benchmark runs the pinned linked check
 * itself and judges the pass from that report, never from the orchestrator's
 * hand-back. The hand-back only has to agree with it.
 */
export async function runPass(input: PassRequest): Promise<PassResult> {
  const deadline = Date.now() + input.timeoutMs;
  const passDir = resolve(input.passDir);
  const evidenceDir = resolve(input.evidenceDir);
  const privateStore = join(passDir, PASS_LAYOUT.store);
  const root = join(passDir, PASS_LAYOUT.root);
  let staged: PassResult["staged"] = null;
  let sha256Before: string | null = null;
  let stagedBefore: string | null = null;
  let originalBefore: string | null = null;
  const early = (
    message: string,
    status: PassResult["status"] = "failed",
  ): PassResult => ({
    status,
    failureStep: "setup",
    error: message,
    state: null,
    handbackState: null,
    unreadUnits: null,
    agent: null,
    linked: null,
    fixture: { sha256Before, sha256After: null },
    staged,
  });
  try {
    await Deno.mkdir(evidenceDir, { recursive: true });
    if (input.signal?.aborted) return early("pass cancelled", "interrupted");
    originalBefore = await workspaceInputsSha256(input.fixtureRoot);
    sha256Before = await fixtureStateSha256(input.fixtureRoot);
    if (sha256Before !== input.expected.fixtureStateSha256) {
      return early("fixture .sigil differs from the batch's snapshot");
    }
    try {
      staged = await preparePass(input);
    } catch (cause) {
      return early(cause instanceof Error ? cause.message : String(cause));
    }
    stagedBefore = await workspaceInputsSha256(root);
    if (Date.now() >= deadline) return early("pass timeout", "interrupted");

    const agent = await input.orchestrate(
      passDir,
      join(passDir, PASS_LAYOUT.bin),
      evidenceDir,
      Math.max(1, deadline - Date.now()),
    );
    const sha256After = await fixtureStateSha256(input.fixtureRoot);
    const stagedAfter = await workspaceInputsSha256(root);
    const originalAfter = await workspaceInputsSha256(input.fixtureRoot);
    const stoppedBy = agent.status === "timeout" || agent.status === "cancelled"
      ? agent.status
      : null;

    // The benchmark's own check. It runs even when the orchestrator failed or
    // timed out, so partial evidence is kept, but only a completed, agreeing
    // orchestrator makes the pass valid.
    let linked: LinkedCheckResult | null = null;
    if (agent.failureStep !== "launch" && stoppedBy !== "cancelled") {
      linked = await runLinkedCheck({
        executable: input.executable,
        root,
        privateStore,
        evidenceDir: `${evidenceDir}/check`,
        timeoutMs: stoppedBy === "timeout"
          ? EVIDENCE_CHECK_BUDGET_MS
          : Math.max(CHECK_BUDGET_FLOOR_MS, deadline - Date.now()),
        signal: input.signal,
        expected: input.expected,
        action: input.action,
      });
    }
    const unreadUnits = typeof linked?.result?.unreadUnits === "number"
      ? linked.result.unreadUnits
      : Array.isArray(linked?.report?.unread)
      ? linked.report.unread.length
      : null;
    const handbackText = agent.finalResponsePath
      ? await Deno.readTextFile(agent.finalResponsePath)
      : null;
    const handbackState = handbackText === null
      ? null
      : parseHandbackState(handbackText);
    const result = (
      status: PassResult["status"],
      failureStep: PassResult["failureStep"],
      error: string | null,
      state: ComputedState | null = null,
    ): PassResult => ({
      status,
      failureStep,
      error,
      state,
      handbackState,
      unreadUnits,
      agent,
      linked,
      fixture: { sha256Before, sha256After },
      staged,
    });

    if (stoppedBy) {
      return result("interrupted", "orchestrator", `agent ${stoppedBy}`);
    }
    if (agent.status !== "completed") {
      return result(
        "failed",
        "orchestrator",
        agent.error ?? `agent ${agent.status}`,
      );
    }
    if (!linked || linked.error || !linked.validation) {
      return result(
        linked?.error?.includes("interrupted") ? "interrupted" : "failed",
        "check",
        linked?.error ?? "the benchmark's own check did not run",
      );
    }
    // Things that make the evidence untrustworthy.
    const invalid: [NonNullable<PassResult["failureStep"]>, string][] = [];
    if (!linked.validation.valid) {
      invalid.push(["validation", linked.validation.errors.join("; ")]);
    }
    if (originalAfter !== originalBefore) {
      invalid.push([
        "fixture",
        "original fixture inputs changed during the pass",
      ]);
    }
    if (stagedAfter !== stagedBefore) {
      invalid.push([
        "fixture",
        "staged selection, code or design inputs changed during the pass",
      ]);
    }
    if (sha256After !== sha256Before) {
      invalid.push(["fixture", "fixture .sigil changed during the pass"]);
    }
    const checkState = linked.validation.state;
    if (
      handbackState !== null && handbackState !== "failed" &&
      checkState !== null && handbackState !== checkState
    ) {
      invalid.push([
        "handback",
        `the agent handed back ${handbackState} but the benchmark's check is ${checkState}`,
      ]);
    }
    const mismatched = input.requestedEffort === null
      ? []
      : agent.children.efforts.filter((effort) =>
        effort.toLowerCase() !== input.requestedEffort!.toLowerCase()
      );
    if (mismatched.length > 0) {
      invalid.push([
        "effort",
        `a child ran at effort ${
          mismatched.join(", ")
        }, not the requested ${input.requestedEffort}`,
      ]);
    }
    if (invalid.length > 0) {
      return result(
        "invalid",
        invalid[0][0],
        invalid.map(([, message]) => message).join("; "),
      );
    }
    if (handbackState === null || handbackState === "failed") {
      return result(
        "failed",
        "handback",
        handbackState === null
          ? "the agent handed back no state"
          : "the agent stopped on a failure",
      );
    }
    return result("valid", null, null, checkState);
  } catch (cause) {
    return early(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The hash of the fixture's own `.sigil` directory, or the empty hash if it has none. */
export async function fixtureStateSha256(fixtureRoot: string): Promise<string> {
  const dir = join(resolve(fixtureRoot), ".sigil");
  return await exists(dir) ? await treeSha256(dir) : "absent";
}

async function runLinkedCheck(input: {
  readonly executable: string;
  readonly root: string;
  readonly privateStore: string;
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly expected: PassExpectations;
  readonly action?: "design" | "implementation";
}): Promise<LinkedCheckResult> {
  const none = (error: string): LinkedCheckResult => ({
    exitCode: null,
    result: null,
    report: null,
    context: null,
    validation: null,
    error,
  });
  await Deno.mkdir(input.evidenceDir, { recursive: true });
  const checked = await invoke(
    input.executable,
    [
      ...(input.action === "implementation" ? ["align"] : []),
      "check",
      "--root",
      input.root,
      "--store",
      input.privateStore,
    ],
    input.evidenceDir,
    "check",
    input.timeoutMs,
    input.signal,
  );
  if (checked.stopReason) {
    return none(`check ${checked.stopReason}: interrupted`);
  }
  if (checked.exitCode !== 0 && checked.exitCode !== 1) {
    return none(checked.stderr || checked.stdout || "check failed");
  }
  let result: JsonObject | null;
  try {
    result = object(JSON.parse(checked.stdout));
  } catch {
    return none(checked.stderr.trim() || "check returned no structured result");
  }
  if (
    !result || !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
  ) {
    return none("check result paths escape private root");
  }
  const report = object(
    JSON.parse(await Deno.readTextFile(result.report as string)),
  );
  const context = object(
    JSON.parse(await Deno.readTextFile(result.judgmentContext as string)),
  );
  if (!report || !context) return none("missing linked report or context");
  const memoKeys: string[] = [];
  try {
    for await (
      const entry of Deno.readDir(
        `${input.privateStore}/claims/interpretations`,
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        memoKeys.push(entry.name.slice(0, -".json".length));
      }
    }
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
  return {
    exitCode: checked.exitCode,
    result,
    report,
    context,
    validation:
      (input.action === "implementation"
        ? validateAlignmentEvidence
        : validateLinkedEvidence)({
          privateStore: input.privateStore,
          exitCode: checked.exitCode,
          workspaceDigest: input.expected.workspaceDigest,
          guidanceFingerprint: input.expected.guidanceFingerprint,
          vocabularyGeneration: input.expected.vocabularyGeneration,
          memoKeys: memoKeys.sort(),
          result,
          report,
          context,
        }),
    error: null,
  };
}

async function invoke(
  executable: string,
  args: string[],
  evidenceDir: string,
  name: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stopReason: "timeout" | "cancelled" | null;
}> {
  const child = new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
    detached: Deno.build.os !== "windows",
  }).spawn();
  const stdoutCapture = captureStream(child.stdout);
  const stderrCapture = captureStream(child.stderr);
  const outputDone = Promise.all([
    stdoutCapture.done,
    stderrCapture.done,
  ]);
  const processState: { status: Deno.CommandStatus | null } = { status: null };
  const processDone = child.status.then((status) => {
    processState.status = status;
  });
  let stopReason: "timeout" | "cancelled" | null = null;
  let resolveStop!: (reason: "timeout" | "cancelled") => void;
  const stopped = new Promise<"timeout" | "cancelled">((resolve) => {
    resolveStop = resolve;
  });
  const stop = (reason: "timeout" | "cancelled") => {
    if (stopReason !== null) return;
    stopReason = reason;
    resolveStop(reason);
    void signalOwnedProcess(child, "SIGTERM");
  };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const onAbort = () => stop("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) stop("cancelled");

  try {
    const first = await Promise.race([
      processDone.then(() => ({ processExited: true as const })),
      stopped.then((reason) => ({ reason })),
    ]);
    if ("reason" in first) {
      const exited = await settleWithin(processDone, 2_250);
      if (!exited) {
        await signalOwnedProcess(child, "SIGKILL");
        await settleWithin(processDone, 1_000);
      }
    }
    const drained = await settleWithin(outputDone, 1_000);
    if (!drained) {
      await signalOwnedProcess(child, "SIGTERM");
      if (!await settleWithin(outputDone, 1_000)) {
        await signalOwnedProcess(child, "SIGKILL");
        await settleWithin(outputDone, 1_000);
      }
    }
    if (!await settleWithin(outputDone, 250)) {
      stdoutCapture.cancel();
      stderrCapture.cancel();
      await settleWithin(outputDone, 250);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  const stdoutBytes = stdoutCapture.read();
  const stderrBytes = stderrCapture.read();
  const stdout = new TextDecoder().decode(stdoutBytes);
  const stderr = new TextDecoder().decode(stderrBytes);
  await Promise.all([
    Deno.writeFile(`${evidenceDir}/${name}.stdout.txt`, stdoutBytes),
    Deno.writeFile(`${evidenceDir}/${name}.stderr.txt`, stderrBytes),
  ]);
  return {
    exitCode: processState.status?.code ?? null,
    stdout,
    stderr,
    stopReason,
  };
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function sameArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}
function inside(root: string, path: unknown): boolean {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const part = relative(resolve(root), resolve(path));
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) &&
    !isAbsolute(part);
}

/** All staged inputs are immutable; claims write-back is the sole allowed change. */
export async function workspaceInputsSha256(root: string): Promise<string> {
  const rows: string[] = [];
  async function visit(dir: string, prefix: string) {
    const entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (name === ".sigil/claims") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory) await visit(path, name);
      else if (entry.isFile) {
        rows.push(`${name}:${await sha256(await Deno.readFile(path))}`);
      } else rows.push(`${name}:link:${await Deno.readLink(path)}`);
    }
  }
  await visit(root, "");
  return sha256(new TextEncoder().encode(rows.join("\n")));
}

/** Alignment has its own state, version and provenance contract. */
export function validateAlignmentEvidence(
  input: LinkedEvidenceInput,
): LinkedValidation {
  const errors: string[] = [];
  const { result, report, context } = input;
  const identity = object(report.identity);
  const state = result.state;
  const exit = state === "closed" || state === "converged"
    ? 0
    : state === "drift" || state === "incomplete"
    ? 1
    : null;
  if (exit === null || input.exitCode !== exit) {
    errors.push("alignment exit code and state mismatch");
  }
  if (
    result.version !== 1 || report.version !== 1 || context.version !== 1 ||
    report.state !== state || report.designState !== result.designState
  ) errors.push("alignment report state/version mismatch");
  if (
    result.scope !== "workspace" || report.source !== "workspace" ||
    context.source !== "workspace"
  ) errors.push("alignment scope mismatch");
  if (
    result.findings !== array(report.findings).length ||
    result.unreadUnits !== array(report.unreadFiles).length ||
    JSON.stringify(result.incompleteReasons) !==
      JSON.stringify(report.incompleteReasons)
  ) errors.push("alignment findings/unread counts or reasons mismatch");
  if (
    !identity || !isDeepStrictEqual(identity, context.identity)
  ) errors.push("alignment context identity mismatch");
  for (
    const key of [
      "workspaceDigest",
      "designBindingDigest",
      "selectionDigest",
      "namesDigest",
      "implementationDigest",
      "guidanceFingerprint",
    ]
  ) {
    if (typeof identity?.[key] !== "string") {
      errors.push(`missing alignment ${key}`);
    }
  }
  if (
    identity?.workspaceDigest !== input.workspaceDigest ||
    result.workspaceDigest !== input.workspaceDigest ||
    identity?.guidanceFingerprint !== input.guidanceFingerprint ||
    result.guidanceFingerprint !== input.guidanceFingerprint ||
    identity?.vocabularyGeneration !== input.vocabularyGeneration ||
    result.vocabularyGeneration !== input.vocabularyGeneration
  ) errors.push("alignment prepared identity mismatch");
  const design = object(context.designCheck);
  if (
    object(design?.identity)?.bindingDigest !== identity?.designBindingDigest ||
    object(design?.linked)?.workspaceDigest !== identity?.workspaceDigest ||
    object(context.selection)?.fingerprint !== identity?.selectionDigest
  ) errors.push("alignment design or selection context mismatch");
  if (
    !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
  ) errors.push("alignment result path outside private root");
  return {
    valid: errors.length === 0,
    state: errors.length === 0 ? state as ComputedState : null,
    errors,
  };
}
