/**
 * `run` and `reread`.
 *
 * `runBatch` writes a manifest and one record per pass under `.benchmarks/`,
 * then runs each pass's four stages in order: the writer authors a design in
 * its staging directory, the read scan judges whether the pass is valid, and
 * the pinned reader takes a claims reading and a coverage reading of the
 * design. A stage that fails leaves the later stages `unavailable` and keeps
 * the evidence of the earlier ones. A cancelled batch records the active
 * stage as `interrupted`, keeps that pass's staging directory for recovery,
 * and still writes a report.
 *
 * `rereadBatch` and `rereadReference` repeat the claims stage, and with
 * `coverage` the coverage stage, on stored designs. A reread of a batch moves
 * the old readings into the attempt's evidence; a reread of the reference
 * writes a new reference store directory and never touches the committed one.
 */
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  copySkill,
  errorMessage,
  exists,
  fileDigest,
  treeSha256,
  withTempDir,
  writeJson,
} from "../agent-runner/files.ts";
import { parseHostName } from "../agent-runner/hosts.ts";
import { defaultForbiddenRoots } from "../agent-runner/read-scan.ts";
import { PASS_LAYOUT } from "../slotted-benchmark/agents.ts";
import { designDigest, referenceStoreDigest } from "./baseline.ts";
import {
  checkCoverageReader,
  countVerdicts,
  type CoverageFile,
} from "./coverage.ts";
import { measureClaims, requirementInputs } from "./measure.ts";
import {
  COVERAGE_LAYOUT,
  type CoverageHeader,
  coverageHeader,
  loadPinnedReader,
} from "./reader.ts";
import {
  attemptPaths,
  BATCH_VERSION,
  type BatchManifest,
  benchmarkNamed,
  BENCHMARKS,
  canonicalJson,
  defaultSigil,
  defaultSigilc,
  ensureEvidenceRoot,
  INTERPRETATIONS_DIR,
  PACKAGE_DIR,
  type PassRecord,
  readBatch,
  type ReaderIdentity,
  type ReadingsIdentity,
  readJsonFile,
  referenceFor,
  REFERENCES,
  referenceStorePaths,
  REPO_ROOT,
  type RequirementList,
  runningStage,
  sameJson,
  type StageName,
  STAGES,
  type StageState,
  withStage,
  type WriterIdentity,
} from "./records.ts";
import {
  buildReport,
  type ReferenceLocation,
  referenceLocationFor,
} from "./report.ts";
import {
  checkWriterIntegrity,
  copyDesign,
  copyDir,
  type HostOptions,
  launchWriter,
  outcomeOf,
  runClaimsReading,
  runCoverageReading,
  type StageOutcome,
  stageWriter,
} from "./stages.ts";
import {
  measureStructure,
  readDesignTree,
  unparseableReason,
} from "./structure.ts";
import { WRITER_LAYOUT, WRITER_SKILLS } from "./writer.ts";

/** One stage's default bound: an hour. */
const DEFAULT_TIMEOUT_MS = 3_600_000;

/** Where things are and how hosts start; every part can be replaced in tests. */
export interface Environment {
  readonly repoRoot?: string;
  readonly packageDir?: string;
  /** The writer's skills; the repo's `skills/` by default. */
  readonly skillsDir?: string;
  readonly sigil?: string;
  readonly sigilc?: string;
  /** Requirement list name to its reference, replacing `REFERENCES`. */
  readonly references?: Readonly<Record<string, ReferenceLocation>>;
  /**
   * The maintainer's Slotted workspace, forbidden to every pass. Undefined:
   * `~/Workspace/slotted` when it exists. Null: none.
   */
  readonly slottedWorkspace?: string | null;
  readonly home?: string;
  readonly hostFor?: HostOptions["hostFor"];
  readonly codexAuthPath?: string;
  readonly piSubagentsEntry?: string;
  /** Bounds one stage. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Progress lines; nothing by default. */
  readonly log?: (line: string) => void;
}

interface Context {
  readonly repoRoot: string;
  readonly packageDir: string;
  readonly skillsDir: string;
  readonly sigil: string;
  readonly sigilc: string;
  readonly references?: Readonly<Record<string, ReferenceLocation>>;
  readonly host: HostOptions;
  readonly log: (line: string) => void;
}

async function resolveContext(env: Environment): Promise<Context> {
  const repoRoot = await realpath(env.repoRoot ?? REPO_ROOT);
  const home = env.home ?? homedir();
  let slotted = env.slottedWorkspace;
  if (slotted === undefined) {
    const candidate = join(home, "Workspace", "slotted");
    slotted = await exists(candidate) ? candidate : null;
  }
  const forbiddenRoots = defaultForbiddenRoots({
    repoRoot,
    home,
    ...(slotted ? { slottedWorkspace: await realpath(slotted) } : {}),
  });
  return {
    repoRoot,
    packageDir: env.packageDir ?? PACKAGE_DIR,
    skillsDir: env.skillsDir ?? join(repoRoot, "skills"),
    sigil: env.sigil ?? defaultSigil(repoRoot),
    sigilc: env.sigilc ?? defaultSigilc(repoRoot),
    references: env.references,
    host: {
      hostFor: env.hostFor,
      codexAuthPath: env.codexAuthPath,
      piSubagentsEntry: env.piSubagentsEntry,
      forbiddenRoots,
      home,
      timeoutMs: env.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: env.signal,
    },
    log: env.log ?? (() => {}),
  };
}

function referenceLocation(context: Context, list: string): ReferenceLocation {
  return referenceLocationFor(list, context);
}

/** The pinned reader of a reference that has readings to compare against. */
async function requirePinnedReference(
  location: ReferenceLocation,
): Promise<ReaderIdentity> {
  const reader = await loadPinnedReader(location.dir);
  const paths = referenceStorePaths(location.dir);
  const missing: string[] = [];
  for (const path of [paths.store, paths.readings, paths.coverage]) {
    if (!(await exists(path))) missing.push(path);
  }
  if (missing.length > 0) {
    throw new Error(
      `The reference store ${location.dir} has no readings yet (missing ${
        missing.join(", ")
      }). Pin the reference first: reread reference --coverage, then copy its output in (see README.md, "Pin the reference").`,
    );
  }
  checkCoverageReader(await readJsonFile<CoverageFile>(paths.coverage), reader);
  return reader;
}

function checkReaderIndependence(
  writers: readonly WriterIdentity[],
  effort: string,
  reader: ReaderIdentity,
): void {
  for (const writer of writers) {
    if (
      writer.agent === reader.agent && writer.model === reader.model &&
      effort === reader.effort
    ) {
      throw new Error(
        `The writer ${writer.agent}:${writer.model} at ${effort} is the pinned reader; choose a different agent, model or reasoning level for the writer`,
      );
    }
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Stage the writer's skills once, to record what every pass must stage. */
async function writerSkillDigests(
  skillsDir: string,
): Promise<Record<string, string>> {
  return await withTempDir("design-benchmark-skills-", async (scratch) => {
    const out: Record<string, string> = {};
    for (const name of WRITER_SKILLS) {
      const staged = join(scratch, name);
      await copySkill(join(skillsDir, name), staged);
      out[name] = await treeSha256(staged);
    }
    return out;
  });
}

/** Why a design gives no claims or coverage reading, or null when it can. */
async function unreadableDesign(
  sigilc: string,
  root: string,
): Promise<string | null> {
  try {
    return unparseableReason(
      measureStructure(await readDesignTree(sigilc, root)),
    );
  } catch (cause) {
    return errorMessage(cause);
  }
}

// ---------------------------------------------------------- reading helpers

interface ClaimsTaken {
  readonly outcome: StageOutcome;
  readonly handback: string | null;
  readonly readings: ReadingsIdentity | null;
  readonly state: string | null;
  readonly unreadUnits: number | null;
  readonly denials: readonly string[];
}

/**
 * Take a claims reading of `design` into the fresh store `storeOut`, keeping
 * the host evidence and the reader's run directory under `evidenceOut`. The
 * readings are copied even when the stage failed, as evidence; a report uses
 * them only from a `done` stage.
 */
async function takeClaims(
  context: Context,
  reader: ReaderIdentity,
  readerSkillsDir: string,
  input: {
    readonly design: string;
    readonly storeOut: string;
    readonly evidenceOut: string;
    readonly workDir: string;
  },
): Promise<ClaimsTaken> {
  const passDir = join(input.workDir, "claims");
  const evidenceDir = join(input.workDir, "claims-evidence");
  let reading;
  try {
    reading = await runClaimsReading({
      reader,
      readerSkillsDir,
      design: input.design,
      sigilc: context.sigilc,
      sigil: context.sigil,
      passDir,
      evidenceDir,
      host: context.host,
    });
  } finally {
    await copyDir(evidenceDir, input.evidenceOut);
    await copyDir(
      join(passDir, PASS_LAYOUT.run),
      join(input.evidenceOut, PASS_LAYOUT.run),
    );
  }
  await rm(input.storeOut, { recursive: true, force: true });
  await mkdir(join(input.storeOut, INTERPRETATIONS_DIR), { recursive: true });
  await copyDir(
    join(reading.store, INTERPRETATIONS_DIR),
    join(input.storeOut, INTERPRETATIONS_DIR),
  );
  const none = { readings: null, state: null, unreadUnits: null };
  const denials = reading.permissionDenials;
  if (reading.outcome.status !== "done") {
    return { outcome: reading.outcome, handback: reading.handback, ...none, denials };
  }
  // A reader that ends without a usable hand-back did not finish its reading,
  // even though its process completed.
  if (reading.handback === null || reading.handback === "failed") {
    return {
      outcome: {
        status: "failed",
        error: `the claims reader handed back ${
          reading.handback ?? "no state"
        }`,
      },
      handback: reading.handback,
      ...none,
      denials,
    };
  }
  const claims = await measureClaims(
    context.sigilc,
    input.design,
    input.storeOut,
  );
  if (claims.status !== "available") {
    return {
      outcome: { status: "failed", error: claims.reason },
      handback: reading.handback,
      ...none,
      denials,
    };
  }
  return {
    outcome: reading.outcome,
    handback: reading.handback,
    readings: {
      guidanceFingerprint: claims.value.guidanceFingerprint,
      vocabularyGeneration: claims.value.vocabularyGeneration,
    },
    state: claims.value.state,
    unreadUnits: claims.value.unreadUnits,
    denials,
  };
}

interface CoverageTaken {
  readonly outcome: StageOutcome;
  readonly coverage: CoverageFile | null;
}

async function takeCoverage(
  context: Context,
  reader: ReaderIdentity,
  readerSkillsDir: string,
  input: {
    readonly design: string;
    readonly requirementFile: string;
    readonly list: RequirementList;
    readonly header: CoverageHeader;
    readonly coverageOut: string;
    readonly evidenceOut: string;
    readonly workDir: string;
  },
): Promise<CoverageTaken> {
  const passDir = join(input.workDir, "coverage");
  const evidenceDir = join(input.workDir, "coverage-evidence");
  let reading;
  try {
    reading = await runCoverageReading({
      reader,
      readerSkillsDir,
      design: input.design,
      sigilc: context.sigilc,
      sigil: context.sigil,
      passDir,
      evidenceDir,
      host: context.host,
      requirementText: await readFile(input.requirementFile, "utf8"),
      list: input.list,
      header: input.header,
    });
  } finally {
    await copyDir(evidenceDir, input.evidenceOut);
    await copyDir(
      join(passDir, COVERAGE_LAYOUT.answerDir),
      join(input.evidenceOut, COVERAGE_LAYOUT.answerDir),
    );
    if (await exists(join(passDir, COVERAGE_LAYOUT.requirement))) {
      await copyFile(
        join(passDir, COVERAGE_LAYOUT.requirement),
        join(input.evidenceOut, COVERAGE_LAYOUT.requirement),
      );
    }
  }
  if (reading.coverage) await writeJson(input.coverageOut, reading.coverage);
  return reading;
}

/** Every benchmark sharing a list, to the digest of its requirement file. */
async function listRequirementFiles(
  context: Context,
  list: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const benchmark of BENCHMARKS.filter((entry) => entry.list === list)) {
    out[benchmark.name] = await fileDigest(
      join(context.packageDir, benchmark.requirementFile),
    );
  }
  return out;
}

// ----------------------------------------------------------------------- run

export interface RunOptions extends Environment {
  readonly benchmark: string;
  readonly writers: readonly WriterIdentity[];
  readonly effort: string;
  readonly passes: number;
  /** The batch directory; must not exist. Default: a new one in `.benchmarks/`. */
  readonly out?: string;
}

export interface RunResult {
  readonly batchDir: string;
  readonly reportPath: string;
  /** Why the report could not be built, when it could not. */
  readonly reportError: string | null;
  readonly records: readonly PassRecord[];
}

const PENDING: StageState = { status: "pending", error: null };

/** Run one batch of regenerate passes and write its report. */
export async function runBatch(options: RunOptions): Promise<RunResult> {
  const context = await resolveContext(options);
  const definition = benchmarkNamed(options.benchmark);
  if (!Number.isInteger(options.passes) || options.passes < 1) {
    throw new Error("--passes must be a positive whole number");
  }
  if (options.writers.length === 0) {
    throw new Error("run needs at least one --agent AGENT:MODEL");
  }
  const seen = new Set<string>();
  for (const writer of options.writers) {
    parseHostName(writer.agent);
    const key = `${writer.agent}:${writer.model}`;
    if (seen.has(key)) throw new Error(`--agent ${key} is given twice`);
    seen.add(key);
  }
  const location = referenceLocation(context, definition.list);
  const reader = await requirePinnedReference(location);
  checkReaderIndependence(options.writers, options.effort, reader);
  const batchDir = resolve(
    options.out ??
      join(
        await ensureEvidenceRoot(context.repoRoot),
        `${options.benchmark}-${stamp()}`,
      ),
  );
  if (await exists(batchDir)) {
    throw new Error(`${batchDir} already exists; choose a new --out`);
  }

  const requirements = await requirementInputs(
    options.benchmark,
    context.packageDir,
  );
  const readings = await currentReadingsIdentity(context, location);
  const manifest: BatchManifest = {
    version: BATCH_VERSION,
    benchmark: options.benchmark,
    writers: options.writers.map(({ agent, model }) => ({ agent, model })),
    effort: options.effort,
    passes: options.passes,
    skillDigests: await writerSkillDigests(context.skillsDir),
    writerBinaries: {
      sigil: await fileDigest(context.sigil),
      sigilc: await fileDigest(context.sigilc),
    },
    reader,
    requirements: {
      requirementFile: requirements.requirementFileDigest,
      requirementList: requirements.listDigest,
    },
    reference: {
      tree: await designDigest(location.root),
      store: await referenceStoreDigest(location.dir),
    },
    readings,
    timeoutMs: context.host.timeoutMs,
    createdAt: new Date().toISOString(),
  };
  await mkdir(batchDir, { recursive: true });
  await writeJson(join(batchDir, "manifest.json"), manifest);

  const scheduled: PassRecord[] = [];
  for (let pass = 0; pass < options.passes; pass++) {
    for (const writer of manifest.writers) {
      const id = String(scheduled.length + 1).padStart(6, "0");
      const record: PassRecord = {
        version: BATCH_VERSION,
        id,
        agent: writer.agent,
        model: writer.model,
        reader,
        stages: {
          writer: PENDING,
          readScan: PENDING,
          claims: PENDING,
          coverage: PENDING,
        },
        reads: "unverified",
        review: "none",
        stagingPath: null,
        startedAt: null,
        finishedAt: null,
      };
      await writeJson(attemptPaths(batchDir, id).record, record);
      scheduled.push(record);
    }
  }

  const batch: BatchState = {
    dir: batchDir,
    manifest,
    reader,
    readerSkillsDir: referenceStorePaths(location.dir).readerSkills,
    requirementFile: join(context.packageDir, definition.requirementFile),
    list: requirements.list,
    header: coverageHeader(requirements, reader),
    readings,
  };
  for (const record of scheduled) {
    if (context.host.signal?.aborted) break;
    context.log(`pass ${record.id}: ${record.agent}:${record.model}`);
    await runPass(context, batch, record);
  }
  const report = await writeReport(context, batchDir);
  return {
    batchDir,
    ...report,
    records: (await readBatch(batchDir)).records,
  };
}

interface BatchState {
  readonly dir: string;
  readonly manifest: BatchManifest;
  readonly reader: ReaderIdentity;
  readonly readerSkillsDir: string;
  readonly requirementFile: string;
  readonly list: RequirementList;
  readonly header: CoverageHeader;
  /** What every claims reading of the batch must be taken under. */
  readonly readings: ReadingsIdentity;
}

/**
 * The guidance fingerprint and vocabulary generation the pinned `sigilc`
 * gives now, from a check of the reference with an empty store. A batch's
 * claims readings are keyed by it, so it is known before any pass runs, and
 * a reference whose readings were taken under another one is refused: its
 * readings would be unread, and the batch could not be shown beside it.
 */
async function currentReadingsIdentity(
  context: Context,
  location: ReferenceLocation,
): Promise<ReadingsIdentity> {
  const check = await measureClaims(context.sigilc, location.root, null);
  if (check.status !== "available") {
    throw new Error(
      `sigilc cannot check the reference ${location.root}: ${check.reason}`,
    );
  }
  const current: ReadingsIdentity = {
    guidanceFingerprint: check.value.guidanceFingerprint,
    vocabularyGeneration: check.value.vocabularyGeneration,
  };
  const pinned = await readJsonFile<ReadingsIdentity>(
    referenceStorePaths(location.dir).readings,
  );
  if (!sameJson(pinned, current)) {
    throw new Error(
      `The reference readings were taken under ${
        canonicalJson(pinned)
      }, but sigilc now gives ${
        canonicalJson(current)
      } (a law or guidance change). Re-pin the reference first: reread reference, then copy its output in (see README.md, "Pin the reference").`,
    );
  }
  return current;
}

/** Run one pass's four stages, saving its record after each. */
async function runPass(
  context: Context,
  batch: BatchState,
  scheduled: PassRecord,
): Promise<PassRecord> {
  const paths = attemptPaths(batch.dir, scheduled.id);
  const temp = await mkdtemp(
    join(tmpdir(), `design-benchmark-${scheduled.id}-`),
  );
  let record: PassRecord = {
    ...scheduled,
    startedAt: new Date().toISOString(),
    stagingPath: temp,
  };
  const save = () => writeJson(paths.record, record);
  const set = (stage: StageName, state: StageState) => {
    record = withStage(record, stage, state);
  };
  const running = (stage: StageName) => {
    set(stage, { status: "running", error: null });
    return save();
  };
  const unavailableAfter = (stage: StageName, reason: string) => {
    for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) {
      set(later, { status: "unavailable", error: reason });
    }
  };
  /** Settle `stage`; false when the later stages cannot run. */
  const settle = (stage: StageName, outcome: StageOutcome): boolean => {
    set(stage, outcome);
    if (outcome.status === "done") return true;
    unavailableAfter(
      stage,
      `the ${STAGE_LABELS[stage]} stage ${outcome.status}`,
    );
    return false;
  };
  const cancelled = (stage: StageName) =>
    settle(stage, { status: "interrupted", error: "the batch was cancelled" });

  try {
    // 1. Writer.
    await running("writer");
    const writerDir = join(temp, "writer");
    const writerEvidence = join(temp, "writer-evidence");
    const evidence = join(paths.evidence, "writer");
    const benchmarkSources = {
      requirementFile: batch.requirementFile,
      skillsDir: context.skillsDir,
      sigil: context.sigil,
      sigilc: context.sigilc,
    };
    let staged;
    try {
      staged = await stageWriter(writerDir, benchmarkSources);
      const mismatched = [
        ...WRITER_SKILLS.filter((name) =>
          staged!.digests[`skills/${name}`] !==
            batch.manifest.skillDigests[name]
        ).map((name) => `skills/${name}`),
        ...(["sigil", "sigilc"] as const).filter((tool) =>
          staged!.digests[`bin/${tool}`] !== batch.manifest.writerBinaries[tool]
        ).map((tool) => `bin/${tool}`),
      ];
      if (mismatched.length > 0) {
        throw new Error(
          `staged ${mismatched.join(", ")} differ from the batch's manifest`,
        );
      }
    } catch (cause) {
      settle("writer", {
        status: "failed",
        error: `staging failed: ${errorMessage(cause)}`,
      });
      return record;
    }
    if (context.host.signal?.aborted) {
      cancelled("writer");
      return record;
    }
    let launch;
    try {
      launch = await launchWriter({
        agent: parseHostName(record.agent),
        model: record.model,
        effort: batch.manifest.effort,
        dir: writerDir,
        evidenceDir: writerEvidence,
        host: context.host,
      });
    } finally {
      // The design, the host events and the review evidence, whatever happened.
      const design = join(writerDir, WRITER_LAYOUT.design);
      await copyDesign(design, paths.design);
      await copyDir(writerEvidence, evidence);
      await copyDir(design, join(evidence, "design"));
      await copyDir(join(writerDir, WRITER_LAYOUT.run), join(evidence, "run"));
      await copyDir(
        join(writerDir, WRITER_LAYOUT.store),
        join(evidence, "store"),
      );
    }
    record = {
      ...record,
      review: launch.handback?.review ?? "none",
      writer: {
        status: launch.status,
        state: launch.handback?.state ?? null,
        observedModels: launch.observedModels,
        childCount: launch.children.count,
        reviewerStarts: null,
      },
    };
    if (!settle("writer", outcomeOf(launch, "writer"))) return record;
    await save();

    // 2. Read scan.
    await running("readScan");
    const integrity = await checkWriterIntegrity({
      agent: parseHostName(record.agent),
      dir: writerDir,
      evidenceDir: writerEvidence,
      staged,
      forbiddenRoots: context.host.forbiddenRoots,
      home: context.host.home,
    });
    await writeJson(join(paths.evidence, "read-scan.json"), {
      reads: integrity.reads,
      findings: integrity.findings,
      forbidden: integrity.forbidden,
      forbiddenRoots: context.host.forbiddenRoots,
    });
    record = {
      ...record,
      reads: integrity.reads,
      integrity: integrity.findings,
      writer: { ...record.writer!, reviewerStarts: integrity.reviewerStarts },
    };
    if (
      !settle(
        "readScan",
        integrity.invalid === null
          ? { status: "done", error: null }
          : { status: "invalid", error: integrity.invalid },
      )
    ) return record;
    await save();

    // A design that does not parse is still scored structurally.
    const unreadable = await unreadableDesign(context.sigilc, paths.design);
    if (unreadable !== null) {
      unavailableAfter("readScan", unreadable);
      return record;
    }

    // 3. Claims reading.
    if (context.host.signal?.aborted) {
      cancelled("claims");
      return record;
    }
    await running("claims");
    const claims = await takeClaims(
      context,
      batch.reader,
      batch.readerSkillsDir,
      {
        design: paths.design,
        storeOut: paths.store,
        evidenceOut: join(paths.evidence, "claims"),
        workDir: temp,
      },
    );
    record = { ...record, claimsHandback: claims.handback };
    let claimsOutcome = claims.outcome;
    if (claims.readings) {
      if (!sameJson(batch.readings, claims.readings)) {
        claimsOutcome = {
          status: "failed",
          error: `the readings were taken under ${
            canonicalJson(claims.readings)
          }, not the batch's ${canonicalJson(batch.readings)}`,
        };
      }
    }
    if (!settle("claims", claimsOutcome)) return record;
    await save();

    // 4. Coverage reading.
    if (context.host.signal?.aborted) {
      cancelled("coverage");
      return record;
    }
    await running("coverage");
    const coverage = await takeCoverage(
      context,
      batch.reader,
      batch.readerSkillsDir,
      {
        design: paths.design,
        requirementFile: batch.requirementFile,
        list: batch.list,
        header: batch.header,
        coverageOut: paths.coverage,
        evidenceOut: join(paths.evidence, "coverage"),
        workDir: temp,
      },
    );
    settle("coverage", coverage.outcome);
    return record;
  } catch (cause) {
    settle(runningStage(record, "writer"), {
      status: "failed",
      error: errorMessage(cause),
    });
    return record;
  } finally {
    const interrupted = STAGES.some((stage) =>
      record.stages[stage].status === "interrupted"
    );
    // An interrupted pass keeps its staging directory, named in the record,
    // so it can be looked at and then removed by hand.
    if (!interrupted) await rm(temp, { recursive: true, force: true });
    record = {
      ...record,
      stagingPath: interrupted ? temp : null,
      finishedAt: new Date().toISOString(),
    };
    await save();
  }
}

const STAGE_LABELS: Record<StageName, string> = {
  writer: "writer",
  readScan: "read scan",
  claims: "claims",
  coverage: "coverage",
};

async function writeReport(
  context: Context,
  batchDir: string,
): Promise<{ reportPath: string; reportError: string | null }> {
  const reportPath = join(batchDir, "report.md");
  try {
    const text = await buildReport({
      batchDirs: [batchDir],
      sigilc: context.sigilc,
      repoRoot: context.repoRoot,
      packageDir: context.packageDir,
      references: context.references,
    });
    await writeFile(reportPath, text);
    return { reportPath, reportError: null };
  } catch (cause) {
    await writeFile(
      reportPath,
      `# Design-quality report\n\nThe report could not be built: ${
        errorMessage(cause)
      }\n`,
    );
    return { reportPath, reportError: errorMessage(cause) };
  }
}

// -------------------------------------------------------------------- reread

export interface RereadBatchOptions extends Environment {
  readonly batchDir: string;
  /** Retake the coverage readings as well. */
  readonly coverage: boolean;
}

export interface RereadBatchResult {
  readonly batchDir: string;
  /** Attempt ids whose readings were retaken. */
  readonly reread: readonly string[];
  /** Attempt ids left alone, with why. */
  readonly skipped: readonly { id: string; reason: string }[];
  readonly reportPath: string;
  readonly reportError: string | null;
}

/** One attempt's retake: its new record, or why its old readings were kept. */
type RetakeResult =
  | { readonly record: PassRecord; readonly readings: ReadingsIdentity }
  | { readonly reason: string };

/**
 * Retake the claims readings, and with `coverage` the coverage readings, of
 * every scored pass of a batch. While the new readings are taken the old ones
 * sit in the attempt's `evidence/superseded-<time>/`. An attempt whose reading
 * does not finish gets its old readings and record back and is listed as
 * skipped with the reason; only finished attempts are reread. The designs are
 * not touched.
 */
export async function rereadBatch(
  options: RereadBatchOptions,
): Promise<RereadBatchResult> {
  const context = await resolveContext(options);
  const batchDir = resolve(options.batchDir);
  const batch = await readBatch(batchDir);
  const definition = benchmarkNamed(batch.manifest.benchmark);
  const location = referenceLocation(context, definition.list);
  const reader = await loadPinnedReader(location.dir);
  checkReaderIndependence(
    batch.manifest.writers,
    batch.manifest.effort,
    reader,
  );
  if (
    !options.coverage && (
      !sameJson(reader, batch.manifest.reader) ||
      batch.records.some((record) =>
        !sameJson(record.reader ?? batch.manifest.reader, reader)
      )
    )
  ) {
    throw new Error(
      `The pinned reader changed since ${batch.name} was read; its coverage readings were taken by the old reader. Reread it with --coverage.`,
    );
  }
  const readerSkillsDir = referenceStorePaths(location.dir).readerSkills;
  const requirements = await requirementInputs(
    batch.manifest.benchmark,
    context.packageDir,
  );
  const header = coverageHeader(requirements, reader);
  const when = stamp();
  const reread: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let readings: ReadingsIdentity | null = null;
  for (const record of batch.records) {
    if (!record.reader) {
      await writeJson(attemptPaths(batchDir, record.id).record, {
        ...record,
        reader: batch.manifest.reader,
      });
    }
  }
  // Takes one attempt's new readings in a fresh directory.
  const retake = async (
    scheduled: PassRecord,
    paths: ReturnType<typeof attemptPaths>,
  ): Promise<RetakeResult> =>
    await withTempDir(`design-benchmark-reread-${scheduled.id}-`, async (temp) => {
      let record: PassRecord = { ...scheduled, reader };
      const set = (stage: StageName, state: StageState) => {
        record = withStage(record, stage, state);
      };
      try {
        set("claims", { status: "running", error: null });
        await writeJson(paths.record, record);
        const claims = await takeClaims(context, reader, readerSkillsDir, {
          design: paths.design,
          storeOut: paths.store,
          evidenceOut: join(paths.evidence, `reread-${when}`, "claims"),
          workDir: temp,
        });
        set("claims", claims.outcome);
        record = { ...record, claimsHandback: claims.handback };
        if (claims.outcome.status !== "done" || claims.readings === null) {
          return {
            reason: `claims ${claims.outcome.status}: ${
              claims.outcome.error ?? "no readings"
            }`,
          };
        }
        if (options.coverage) {
          set("coverage", { status: "running", error: null });
          await writeJson(paths.record, record);
          const coverage = await takeCoverage(context, reader, readerSkillsDir, {
            design: paths.design,
            requirementFile: join(context.packageDir, definition.requirementFile),
            list: requirements.list,
            header,
            coverageOut: paths.coverage,
            evidenceOut: join(paths.evidence, `reread-${when}`, "coverage"),
            workDir: temp,
          });
          set("coverage", coverage.outcome);
          // A coverage reader that fails still reports `done` with an error and
          // stores every requirement as not read; that is not a finished reading.
          if (coverage.outcome.status !== "done" || coverage.outcome.error !== null) {
            return {
              reason: `coverage ${coverage.outcome.status}: ${
                coverage.outcome.error ?? "no reading"
              }`,
            };
          }
        }
        return { record, readings: claims.readings };
      } catch (cause) {
        return { reason: errorMessage(cause) };
      }
    });
  for (const scheduled of batch.records) {
    if (context.host.signal?.aborted) break;
    const paths = attemptPaths(batchDir, scheduled.id);
    const writer = scheduled.stages.writer.status;
    const scan = scheduled.stages.readScan.status;
    if (writer !== "done" || scan !== "done") {
      skipped.push({
        id: scheduled.id,
        reason: `writer ${writer}, read scan ${scan}`,
      });
      continue;
    }
    const unreadable = await unreadableDesign(context.sigilc, paths.design);
    if (unreadable !== null) {
      skipped.push({ id: scheduled.id, reason: unreadable });
      continue;
    }
    context.log(`reread ${scheduled.id}`);
    const previous: PassRecord = {
      ...scheduled,
      reader: scheduled.reader ?? batch.manifest.reader,
    };
    const superseded = join(paths.evidence, `superseded-${when}`);
    await mkdir(superseded, { recursive: true });
    if (await exists(paths.store)) {
      await rename(paths.store, join(superseded, "store"));
    }
    if (options.coverage && await exists(paths.coverage)) {
      await rename(paths.coverage, join(superseded, "coverage.json"));
    }
    const retaken = await retake(scheduled, paths);
    if ("reason" in retaken) {
      await restoreReadings(paths, superseded, options.coverage);
      await writeJson(paths.record, previous);
      skipped.push({
        id: scheduled.id,
        reason: `reread failed, kept its old readings: ${retaken.reason}`,
      });
      continue;
    }
    await writeJson(paths.record, retaken.record);
    reread.push(scheduled.id);
    readings ??= retaken.readings;
  }
  const manifest: BatchManifest = {
    ...batch.manifest,
    reader: reread.length > 0 ? reader : batch.manifest.reader,
    readings: readings ?? batch.manifest.readings,
    reference: reread.length > 0
      ? {
        tree: await designDigest(location.root),
        store: await referenceStoreDigest(location.dir),
      }
      : batch.manifest.reference,
    rereads: reread.length > 0
      ? [
        ...(batch.manifest.rereads ?? []),
        {
          at: new Date().toISOString(),
          coverage: options.coverage,
          previous: batch.manifest.readings,
        },
      ]
      : batch.manifest.rereads,
  };
  await writeJson(join(batchDir, "manifest.json"), manifest);
  return {
    batchDir,
    reread,
    skipped,
    ...await writeReport(context, batchDir),
  };
}

/**
 * Put the old readings of an attempt back after a reread that did not finish:
 * whatever the reread wrote is dropped, and the superseded copies return.
 */
async function restoreReadings(
  paths: ReturnType<typeof attemptPaths>,
  superseded: string,
  coverage: boolean,
): Promise<void> {
  await rm(paths.store, { recursive: true, force: true });
  if (await exists(join(superseded, "store"))) {
    await rename(join(superseded, "store"), paths.store);
  }
  if (coverage) {
    await rm(paths.coverage, { force: true });
    if (await exists(join(superseded, "coverage.json"))) {
      await rename(join(superseded, "coverage.json"), paths.coverage);
    }
  }
  await rm(superseded, { recursive: true, force: true });
}

export interface RereadReferenceOptions extends Environment {
  /** The requirement list; optional when only one reference exists. */
  readonly list?: string;
  readonly coverage: boolean;
  /** The new store directory; must not exist. Default: one in `.benchmarks/`. */
  readonly out?: string;
}

export interface RereadReferenceResult {
  readonly list: string;
  /** The new reference store directory. */
  readonly outDir: string;
  /** The committed reference store it is meant to replace. */
  readonly referenceDir: string;
  readonly readings: ReadingsIdentity;
  readonly state: string | null;
  readonly unreadUnits: number | null;
  /** Coverage verdict counts, when coverage was read. */
  readonly coverage:
    | { answered: number; none: number; notRead: number }
    | null;
  /** Tool calls the claims reader was refused; its readings were still taken. */
  readonly deniedToolCalls: readonly string[];
}

/**
 * Take new claims readings, and with `coverage` a new coverage reading, of a
 * reference design into a new reference store directory. The committed
 * store is never written; the maintainer reviews the output and copies it in.
 * Works once `reader.json` and `reader-skills/` exist, before any readings.
 */
export async function rereadReference(
  options: RereadReferenceOptions,
): Promise<RereadReferenceResult> {
  const context = await resolveContext(options);
  const list = options.list ??
    (REFERENCES.length === 1 ? REFERENCES[0].list : (() => {
      throw new Error(
        `reread reference needs --list (one of ${
          REFERENCES.map((entry) => entry.list).join(", ")
        })`,
      );
    })());
  const definition = referenceFor(list);
  const location = referenceLocation(context, list);
  const reader = await loadPinnedReader(location.dir);
  const source = referenceStorePaths(location.dir);
  const outDir = resolve(
    options.out ??
      join(
        await ensureEvidenceRoot(context.repoRoot),
        `reference-${list}-${stamp()}`,
      ),
  );
  if (await exists(outDir)) {
    throw new Error(`${outDir} already exists; choose a new --out`);
  }
  if (resolve(outDir) === resolve(location.dir)) {
    throw new Error("reread reference never writes the committed store");
  }
  const out = referenceStorePaths(outDir);
  await mkdir(outDir, { recursive: true });
  return await withTempDir("design-benchmark-reference-", async (temp) => {
    const claims = await takeClaims(context, reader, source.readerSkills, {
      design: location.root,
      storeOut: out.store,
      evidenceOut: join(outDir, "evidence", "claims"),
      workDir: temp,
    });
    if (claims.outcome.status !== "done" || claims.readings === null) {
      throw new Error(
        `The claims reading of ${location.root} ${claims.outcome.status}: ${
          claims.outcome.error ?? "no readings"
        }. Evidence is in ${join(outDir, "evidence")}.`,
      );
    }
    // A reference is the yardstick, so every unit must be read before it is
    // stored; an incomplete reading is refused rather than written.
    if (claims.state === "incomplete" || (claims.unreadUnits ?? 0) > 0) {
      throw new Error(
        `The claims reading of ${location.root} is incomplete: ${
          claims.unreadUnits ?? "unknown"
        } unit(s) unread. Evidence is in ${join(outDir, "evidence")}; readings.json was not written.`,
      );
    }
    let coverage: RereadReferenceResult["coverage"] = null;
    if (options.coverage) {
      const benchmark = benchmarkNamed(definition.coverageBenchmark);
      const inputs = await requirementInputs(
        benchmark.name,
        context.packageDir,
      );
      const taken = await takeCoverage(context, reader, source.readerSkills, {
        design: location.root,
        requirementFile: join(context.packageDir, benchmark.requirementFile),
        list: inputs.list,
        header: {
          listName: list,
          listDigest: inputs.listDigest,
          requirementFiles: await listRequirementFiles(context, list),
          reader,
        },
        coverageOut: out.coverage,
        evidenceOut: join(outDir, "evidence", "coverage"),
        workDir: temp,
      });
      if (taken.coverage === null || taken.outcome.error !== null) {
        throw new Error(
          `The coverage reading ${taken.outcome.status}: ${
            taken.outcome.error ?? "no reading"
          }. Evidence is in ${join(outDir, "evidence")}; readings.json was not written.`,
        );
      }
      coverage = countVerdicts(taken.coverage.entries);
    } else if (await exists(source.coverage)) {
      // Coverage cites Facet ids, so it survives a law-only change.
      await copyFile(source.coverage, out.coverage);
    }
    // Written only once every reading the reference needs has finished.
    await writeJson(out.readings, claims.readings);
    await copyFile(source.reader, out.reader);
    return {
      list,
      outDir,
      referenceDir: location.dir,
      readings: claims.readings,
      state: claims.state,
      unreadUnits: claims.unreadUnits,
      coverage,
      deniedToolCalls: claims.denials,
    };
  });
}

/** Where a reference's store and design are, for `pin-reader`. */
export async function referenceDirFor(
  env: Environment,
  list?: string,
): Promise<{ list: string; dir: string; root: string }> {
  const context = await resolveContext(env);
  const name = list ?? (REFERENCES.length === 1 ? REFERENCES[0].list : null);
  if (name === null) throw new Error("--list is needed");
  referenceFor(name);
  const location = referenceLocation(context, name);
  return { list: name, dir: location.dir, root: location.root };
}
