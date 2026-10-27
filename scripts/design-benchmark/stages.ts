/**
 * The four stages of a regenerate pass: writer, read scan, claims
 * reading, coverage reading. Each stage runs in its own directory under the
 * OS temp directory, outside the repository, and returns a status;
 * `batch.ts` strings them together and copies their evidence back.
 *
 * The writer's staging directory:
 *
 * ```
 * requirement.md   the benchmark's requirement file, the writer's only evidence
 * skills/<name>/   the five staged skills
 * bin/             sigil and sigilc, copied
 * design/          the workspace the writer authors, made by `sigil init`
 * run/             the review preparation's run directory
 * store/           the review preparation's private store
 * ```
 *
 * The claims stage stages the evaluation benchmark's pass layout (`root/`,
 * `store/`, `run/`, `bin/`, `skills/`) with the reader's frozen skills; the
 * coverage stage stages `design/`, the requirement file, the requirement list,
 * the Facet list and an `answer/` directory.
 */
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { AgentName, AgentRunResult } from "../agent-runner/agents.ts";
import {
  copySkill,
  copyTree,
  exists,
  fileDigest,
  treeSha256,
  writeJson,
} from "../agent-runner/files.ts";
import {
  analyzeHostStream,
  claudeDenySettings,
  parseHostName,
  parseJsonLines,
} from "../agent-runner/hosts.ts";
import { launchAgent, type LaunchResult } from "../agent-runner/launch.ts";
import { runToCompletion } from "../agent-runner/process.ts";
import {
  type ForbiddenRead,
  type ReadVerdict,
  scanReads,
} from "../agent-runner/read-scan.ts";
import { describeWrite, scanWrites } from "../agent-runner/write-scan.ts";
import {
  type HandbackState,
  INTERPRETER_CHILD,
  ORCHESTRATOR_SHELL,
  parseHandbackState,
  PASS_LAYOUT,
} from "../slotted-benchmark/agents.ts";
import type { CoverageFile } from "./coverage.ts";
import {
  COVERAGE_CHILD,
  benchmarkClaimsPrompt,
  COVERAGE_LAYOUT,
  coverageFromAnswer,
  type CoverageHandback,
  type CoverageHeader,
  coveragePrompt,
  facetsDocument,
  parseCoverageHandback,
  readCoverageAnswer,
  READER_SKILLS,
} from "./reader.ts";
import type {
  IntegrityFindings,
  ReaderIdentity,
  RequirementList,
  StageStatus,
} from "./records.ts";
import { facetHandles, readDesignTree } from "./structure.ts";
import {
  parseWriterHandback,
  REVIEWER_CHILD,
  reviewerChild,
  reviewEvidenceCommand,
  WRITABLE,
  WRITER_CHILDREN,
  WRITER_LAYOUT,
  WRITER_SHELL,
  WRITER_SKILLS,
  type WriterHandback,
  writerPrompt,
} from "./writer.ts";

export type Role = "writer" | "reader";

/** An executable and the arguments before the host's own; for fake hosts. */
export interface HostCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

/** What every launch of a pass shares. */
export interface HostOptions {
  /** Overrides PATH lookup of a host, by role; tests pass fake hosts here. */
  readonly hostFor?: (role: Role, agent: AgentName) => HostCommand | undefined;
  readonly codexAuthPath?: string;
  readonly piSubagentsEntry?: string;
  /** Directories no stage may read. */
  readonly forbiddenRoots: readonly string[];
  readonly home: string;
  /** Bounds one stage. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface StageOutcome {
  readonly status: StageStatus;
  readonly error: string | null;
}

function launchSettings(role: Role, agent: AgentName, host: HostOptions) {
  const command = host.hostFor?.(role, agent);
  return {
    ...(command
      ? { executable: command.executable, executableArgs: command.args }
      : {}),
    codexAuthPath: host.codexAuthPath,
    piSubagentsEntry: host.piSubagentsEntry,
    timeoutMs: host.timeoutMs,
    signal: host.signal,
    // Claude Code denies reads under the forbidden roots. Other hosts
    // have no such setting; their events are scanned after the writer.
    hostArgs: agent === "claude"
      ? ["--settings", JSON.stringify(claudeDenySettings(host.forbiddenRoots))]
      : [],
  };
}

/** A stage's status from how its host run ended. */
export function outcomeOf(result: AgentRunResult, who: string): StageOutcome {
  switch (result.status) {
    case "completed":
      return { status: "done", error: null };
    case "timeout":
      return { status: "failed", error: `the ${who} timed out` };
    case "cancelled":
      return { status: "interrupted", error: `the ${who} was cancelled` };
    default:
      return {
        status: "failed",
        error: result.error ?? `the ${who} failed`,
      };
  }
}

// ------------------------------------------------------------------- copying

/**
 * Copy a directory tree, keeping symbolic links as links and leaving out any
 * other entry that is not a file or directory. `skip` names relative paths
 * (with `/`) left out with everything beneath them. A missing source copies
 * nothing.
 */
export async function copyDir(
  source: string,
  destination: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<void> {
  await copyTree(source, destination, {
    skip,
    symlinks: "keep",
    special: "skip",
    allowMissingRoot: true,
  });
}

/** The claims cache a tool may leave in a design; never part of a design. */
const DESIGN_CLAIMS = ".sigil/claims";

/** Copy a design without the claims readings any tool left in it. */
export async function copyDesign(
  source: string,
  destination: string,
): Promise<void> {
  await copyDir(source, destination, new Set([DESIGN_CLAIMS]));
}

// -------------------------------------------------------------- writer stage

export interface WriterSources {
  /** The benchmark's requirement file. */
  readonly requirementFile: string;
  /** The directory holding the five skills, normally the repo's `skills/`. */
  readonly skillsDir: string;
  readonly sigil: string;
  readonly sigilc: string;
}

/** The digests a pass's staged inputs must keep through the writer. */
export interface StagedInputs {
  /** `requirement.md`, `skills/<name>` and `bin/<tool>` to their digest. */
  readonly digests: Readonly<Record<string, string>>;
  /** Every path outside the writable directories, to its digest. */
  readonly snapshot: ReadonlyMap<string, string>;
}

/** Stage the writer's directory and take its input digests. */
export async function stageWriter(
  dir: string,
  sources: WriterSources,
): Promise<StagedInputs> {
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) {
    throw new Error(`The writer's staging directory ${dir} is not empty`);
  }
  await copyFile(sources.requirementFile, join(dir, WRITER_LAYOUT.requirement));
  for (const name of WRITER_SKILLS) {
    await copySkill(
      join(sources.skillsDir, name),
      join(dir, WRITER_LAYOUT.skills, name),
    );
  }
  const bin = join(dir, WRITER_LAYOUT.bin);
  await mkdir(bin, { recursive: true });
  await copyFile(sources.sigil, join(bin, "sigil"));
  await copyFile(sources.sigilc, join(bin, "sigilc"));
  for (const name of ["review-evidence.mjs", "review-evidence-pi.mjs"]) {
    await copyFile(new URL(`./${name}`, import.meta.url), join(bin, name));
  }
  const design = join(dir, WRITER_LAYOUT.design);
  const init = await runToCompletion(join(bin, "sigil"), [
    "init",
    design,
    "--name",
    "design",
    "--quiet",
  ]);
  if (init.code !== 0 || !(await exists(join(design, ".sigil/config.json")))) {
    throw new Error(
      `sigil init failed in the staging directory (exit ${init.code}): ${
        (init.stderr || init.stdout).trim()
      }`,
    );
  }
  await mkdir(join(dir, WRITER_LAYOUT.run), { recursive: true });
  await mkdir(join(dir, WRITER_LAYOUT.store), { recursive: true });
  return {
    digests: await stagedInputDigests(dir),
    snapshot: await snapshotStaging(dir),
  };
}

/** Digests of the requirement file, each staged skill and each binary. */
async function stagedInputDigests(
  dir: string,
): Promise<Record<string, string>> {
  const digest = async (path: string) =>
    await exists(path) ? await fileDigest(path) : "absent";
  const tree = async (path: string) =>
    await exists(path) ? await treeSha256(path) : "absent";
  const out: Record<string, string> = {
    [WRITER_LAYOUT.requirement]: await digest(
      join(dir, WRITER_LAYOUT.requirement),
    ),
  };
  for (const name of WRITER_SKILLS) {
    out[`skills/${name}`] = await tree(join(dir, WRITER_LAYOUT.skills, name));
  }
  for (
    const tool of [
      "sigil",
      "sigilc",
      "review-evidence.mjs",
      "review-evidence-pi.mjs",
    ]
  ) {
    out[`bin/${tool}`] = await digest(join(dir, WRITER_LAYOUT.bin, tool));
  }
  return out;
}

/**
 * Every entry of the staging directory outside the writable directories, by
 * relative path: a file's digest, a link's target, or `dir`.
 */
async function snapshotStaging(
  dir: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const writable = new Set<string>(WRITABLE);
  const visit = async (path: string, prefix: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (prefix === "" && writable.has(name)) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        out.set(name, "dir");
        await visit(full, name);
      } else if (entry.isSymbolicLink()) {
        out.set(name, `link:${await readlink(full)}`);
      } else if (entry.isFile()) {
        out.set(name, await fileDigest(full));
      } else out.set(name, "other");
    }
  };
  await visit(dir, "");
  return out;
}

/** What changed between two snapshots, as `added`, `changed` or `removed`. */
export function snapshotDifferences(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  ignore: (path: string) => boolean = () => false,
): string[] {
  const out: string[] = [];
  for (const [path, digest] of after) {
    if (ignore(path)) continue;
    if (!before.has(path)) out.push(`added ${path}`);
    else if (before.get(path) !== digest) out.push(`changed ${path}`);
  }
  for (const path of before.keys()) {
    if (!ignore(path) && !after.has(path)) out.push(`removed ${path}`);
  }
  return out.sort();
}

export interface WriterRequest {
  readonly agent: AgentName;
  readonly model: string;
  readonly effort: string;
  /** The staged directory; the writer's working directory. */
  readonly dir: string;
  /** Outside `dir`; launch evidence goes here. */
  readonly evidenceDir: string;
  readonly host: HostOptions;
}

/** Launch `sigil-write` in its staging directory. */
export async function launchWriter(
  request: WriterRequest,
): Promise<LaunchResult<WriterHandback>> {
  const dir = await realpath(request.dir);
  return await launchAgent<WriterHandback>({
    agent: request.agent,
    requestedModel: request.model,
    reasoning: request.effort,
    passDir: request.dir,
    binDir: join(request.dir, WRITER_LAYOUT.bin),
    evidenceDir: request.evidenceDir,
    ...launchSettings("writer", request.agent, request.host),
    prompt: writerPrompt,
    allowedShell: [...WRITER_SHELL, reviewEvidenceCommand(dir)],
    children: WRITER_CHILDREN.map((child) =>
      child.name === REVIEWER_CHILD.name ? reviewerChild(dir) : child
    ),
    parseHandback: parseWriterHandback,
  });
}

// ----------------------------------------------------------- read scan stage

export interface IntegrityResult {
  readonly reads: ReadVerdict;
  readonly findings: IntegrityFindings;
  /** Why the pass is invalid, or null when it is not. */
  readonly invalid: string | null;
  /** Reviewer children the orchestrator started, where the host shows it. */
  readonly reviewerStarts: number | null;
  /** The forbidden reads with the calls that made them, for the evidence. */
  readonly forbidden: readonly ForbiddenRead[];
}

/**
 * The read scan stage: scan the writer's events for forbidden reads and
 * writes outside `design/`, `run/` and `store/`, re-hash the staged inputs,
 * and compare the staging directory with its snapshot.
 */
export async function checkWriterIntegrity(input: {
  readonly agent: AgentName;
  readonly dir: string;
  readonly evidenceDir: string;
  readonly staged: StagedInputs;
  readonly forbiddenRoots: readonly string[];
  readonly home: string;
}): Promise<IntegrityResult> {
  const stdout = join(input.evidenceDir, "stdout.jsonl");
  const events = await exists(stdout)
    ? parseJsonLines(await readFile(stdout, "utf8"))
    : [];
  const analysis = await analyzeHostStream(input.agent, events, {
    childNames: WRITER_CHILDREN.map((child) => child.name),
    codexHome: input.agent === "codex"
      ? join(input.evidenceDir, "codex-home")
      : undefined,
  });
  const scan = scanReads(input.agent, analysis, {
    forbiddenRoots: input.forbiddenRoots,
    home: input.home,
    stagingDir: input.dir,
  });
  const writes = scanWrites(input.agent, analysis.toolCalls, {
    stagingDir: input.dir,
    allowedDirs: WRITABLE.map((name) => join(input.dir, name)),
    home: input.home,
  });
  const after = await stagedInputDigests(input.dir);
  const changedInputs = Object.keys(input.staged.digests).filter((key) =>
    after[key] !== input.staged.digests[key]
  ).sort();
  // Pi's launcher writes its child definitions into the pass directory.
  const piAgents = new Set(
    WRITER_CHILDREN.map((child) => `.pi/agents/${child.name}.md`),
  );
  const ignore = (path: string) =>
    input.agent === "pi" &&
    (path === ".pi" || path === ".pi/agents" || piAgents.has(path));
  const differences = snapshotDifferences(
    input.staged.snapshot,
    await snapshotStaging(input.dir),
    ignore,
  );
  const outsideWrites = [
    ...differences.map((entry) => `staging directory: ${entry}`),
    ...writes.map(describeWrite),
  ];
  const forbiddenReads = scan.forbidden.map((read) =>
    `${read.call.actor} ${read.call.tool} ${
      read.reason === "path" ? "read" : "searched"
    } ${read.path} (forbidden root ${read.root})`
  );
  const reasons: string[] = [];
  if (forbiddenReads.length > 0) {
    reasons.push(`a forbidden read: ${forbiddenReads[0]}`);
  }
  if (changedInputs.length > 0) {
    reasons.push(`staged inputs changed: ${changedInputs.join(", ")}`);
  }
  if (outsideWrites.length > 0) {
    reasons.push(
      `a write outside design/, run/ and store/: ${outsideWrites[0]}`,
    );
  }
  const reviewerStarts = input.agent === "codex"
    ? null
    : analysis.toolCalls.filter((call) => {
      if (call.childSession !== null) return false;
      const args = call.input as Record<string, unknown> | null;
      return (["Agent", "Task"].includes(call.tool) &&
        args?.subagent_type === REVIEWER_CHILD.name) ||
        (call.tool === "subagent" && args?.agent === REVIEWER_CHILD.name);
    }).length;
  return {
    reads: scan.verdict,
    findings: {
      forbiddenReads,
      unverifiedReason: scan.unverifiedReason,
      changedInputs,
      outsideWrites,
    },
    invalid: reasons.length > 0 ? reasons.join("; ") : null,
    reviewerStarts,
    forbidden: scan.forbidden,
  };
}

// --------------------------------------------------------------- claims stage

export interface ReaderRequest {
  readonly reader: ReaderIdentity;
  /** The frozen skills, `reference/<list>/reader-skills`. */
  readonly readerSkillsDir: string;
  /** The design to read; copied, never read in place. */
  readonly design: string;
  readonly sigilc: string;
  /** The pinned `sigil`, staged beside `sigilc` for the reader's version check. */
  readonly sigil: string;
  /** The stage's working directory; must not exist yet or be empty. */
  readonly passDir: string;
  /** Outside `passDir`; launch evidence goes here. */
  readonly evidenceDir: string;
  readonly host: HostOptions;
}

/** Stage the reader's frozen skills and check them against the pin. */
async function stageReaderSkills(
  request: ReaderRequest,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    const staged = join(request.passDir, "skills", name);
    await copySkill(join(request.readerSkillsDir, name), staged);
    const digest = await treeSha256(staged);
    if (request.reader.skillDigests[name] !== digest) {
      throw new Error(
        `The staged reader skill ${name} differs from the pinned reader's (${digest})`,
      );
    }
  }
}

export interface ClaimsReading {
  readonly outcome: StageOutcome;
  readonly handback: HandbackState | null;
  /** The reader's private store; its interpretations are the readings. */
  readonly store: string;
  /** Tool calls the host refused during the reading; the store decides the rest. */
  readonly permissionDenials: readonly string[];
}

/**
 * Take one claims reading: the evaluation benchmark's full-design action, run
 * by the pinned reader on a copy of the design with an empty store.
 */
export async function runClaimsReading(
  request: ReaderRequest,
): Promise<ClaimsReading> {
  const passDir = request.passDir;
  const store = join(passDir, PASS_LAYOUT.store);
  await mkdir(store, { recursive: true });
  if ((await readdir(store)).length > 0) {
    throw new Error("The claims reader's private store is not empty");
  }
  const root = join(passDir, PASS_LAYOUT.root);
  if (await exists(root)) {
    throw new Error("The claims stage directory already has a root");
  }
  await copyDesign(request.design, root);
  if (!(await exists(join(root, ".sigil/config.json")))) {
    throw new Error("The design has no .sigil/config.json");
  }
  await mkdir(join(passDir, PASS_LAYOUT.run), { recursive: true });
  await stageReaderSkills(request, READER_SKILLS);
  const bin = join(passDir, PASS_LAYOUT.bin);
  await mkdir(bin, { recursive: true });
  await copyFile(request.sigilc, join(bin, "sigilc"));
  // The staged skills ask the reader to read `sigil --version`, so the
  // pinned `sigil` is staged and allowed beside `sigilc`.
  await copyFile(request.sigil, join(bin, "sigil"));
  const agent = parseHostName(request.reader.agent);
  const result = await launchAgent<HandbackState>({
    agent,
    requestedModel: request.reader.model,
    reasoning: request.reader.effort,
    passDir,
    binDir: bin,
    evidenceDir: request.evidenceDir,
    ...launchSettings("reader", agent, request.host),
    prompt: (context) => benchmarkClaimsPrompt({ ...context, action: "design" }),
    allowedShell: [...ORCHESTRATOR_SHELL, "sigil"],
    children: [INTERPRETER_CHILD],
    parseHandback: parseHandbackState,
  });
  return {
    outcome: outcomeOf(result, "claims reader"),
    handback: result.handback,
    store,
    permissionDenials: result.permissionDenials,
  };
}

// ------------------------------------------------------------- coverage stage

export interface CoverageRequest extends ReaderRequest {
  /** The requirement file the reader is given, whole. */
  readonly requirementText: string;
  readonly list: RequirementList;
  readonly header: CoverageHeader;
}

export interface CoverageReading {
  readonly outcome: StageOutcome;
  /** The reading to store; null only when the stage was interrupted. */
  readonly coverage: CoverageFile | null;
}

/**
 * Take one coverage reading. A reader that times out, fails or writes
 * no usable answer still gives a stored reading, with every requirement
 * `not-read`; only a cancelled reader gives none.
 */
export async function runCoverageReading(
  request: CoverageRequest,
): Promise<CoverageReading> {
  const passDir = request.passDir;
  await mkdir(passDir, { recursive: true });
  if ((await readdir(passDir)).length > 0) {
    throw new Error("The coverage stage directory is not empty");
  }
  const design = join(passDir, COVERAGE_LAYOUT.design);
  await copyDesign(request.design, design);
  const handles = facetHandles(
    await readDesignTree(request.sigilc, design),
  );
  await writeFile(
    join(passDir, COVERAGE_LAYOUT.requirement),
    request.requirementText,
  );
  await writeJson(join(passDir, COVERAGE_LAYOUT.list), request.list);
  await writeFile(
    join(passDir, COVERAGE_LAYOUT.facets),
    facetsDocument(handles),
  );
  await mkdir(join(passDir, COVERAGE_LAYOUT.answerDir), { recursive: true });
  await stageReaderSkills(request, ["sigil-understand"]);
  const bin = join(passDir, COVERAGE_LAYOUT.bin);
  await mkdir(bin, { recursive: true });
  const agent = parseHostName(request.reader.agent);
  const result = await launchAgent<CoverageHandback>({
    agent,
    requestedModel: request.reader.model,
    reasoning: request.reader.effort,
    passDir,
    binDir: bin,
    evidenceDir: request.evidenceDir,
    ...launchSettings("reader", agent, request.host),
    prompt: coveragePrompt,
    allowedShell: [],
    children: [COVERAGE_CHILD],
    parseHandback: parseCoverageHandback,
  });
  const outcome = outcomeOf(result, "coverage reader");
  if (outcome.status === "interrupted") return { outcome, coverage: null };
  let failure = outcome.status === "done" ? null : outcome.error;
  let answer: unknown = null;
  if (failure === null) {
    const read = await readCoverageAnswer(
      join(passDir, COVERAGE_LAYOUT.answer),
    );
    answer = read.answer;
    failure = read.failure;
  }
  const coverage = coverageFromAnswer({
    answer,
    failure,
    list: request.list,
    handles,
    header: request.header,
  });
  return {
    outcome: {
      status: "done",
      error: failure === null
        ? null
        : `${failure}; every requirement is stored not-read`,
    },
    coverage,
  };
}
