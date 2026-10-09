import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentName,
  type EffortVerification,
  type HandbackState,
  type ModelVerification,
  orchestratorPrompt,
  runOrchestrator,
} from "./agents.ts";
import {
  type ComputedState,
  fixtureStateSha256,
  runPass,
  type StagedSkill,
} from "./claims.ts";
import { copySkill, exists, sha256, treeSha256, writeJson } from "./files.ts";
import {
  designViewFromTrees,
  type FixturePreflight,
  preflightSlottedFixture,
  SLOTTED_FIXTURE,
  type TreeOutput,
} from "./fixture.ts";

export interface BatchSelection {
  readonly agent: AgentName;
  readonly model: string;
}

/** One pass: one orchestrator runs sigil-compute's whole-design action, then the benchmark checks. */
export interface ScheduledAttempt extends BatchSelection {
  readonly id: string;
  readonly pass: number;
}

/** A pass record. Its `state` is the benchmark's own linked check's. */
export interface AttemptRecord extends ScheduledAttempt {
  readonly status:
    | "pending"
    | "running"
    | "valid"
    | "invalid"
    | "failed"
    | "interrupted";
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** The benchmark's own check state; set only on a valid pass. */
  readonly state: ComputedState | null;
  /** What the orchestrator handed back, when it handed back a state. */
  readonly handbackState: HandbackState | null;
  readonly failureStep: string | null;
  readonly error: string | null;
  /** Units the benchmark's own check reports unread, when it ran. */
  readonly unreadUnits: number | null;
  readonly observedModels: readonly string[];
  readonly modelVerification: ModelVerification;
  /** The reasoning effort requested for orchestrator and children. */
  readonly requestedEffort: string | null;
  readonly childCount: number | null;
  readonly childModels: readonly string[];
  readonly childEfforts: readonly string[];
  readonly childEffortVerification: EffortVerification;
  readonly outcomePath: string | null;
}

export interface BatchManifest {
  readonly version: 2;
  readonly createdAt: string;
  readonly fixture: typeof SLOTTED_FIXTURE;
  readonly fixtureSha256: string;
  readonly preflight: FixturePreflight;
  readonly selections: readonly BatchSelection[];
  readonly passes: number;
  /** Bounds each whole pass. */
  readonly timeoutMs: number;
  readonly reasoning?: string;
  readonly schedule: readonly ScheduledAttempt[];
  readonly input: {
    /** Hash of every resolved tree id, as reported by claims `prepare`. */
    readonly workspaceDigest?: string;
    readonly sourceSha256: Readonly<Record<string, string>>;
    readonly workspaceMemoPresent: boolean;
    /** Hash of the fixture's own `.sigil`, which no pass may change. */
    readonly fixtureStateSha256: string;
  };
  readonly tools: {
    readonly claimsPath: string;
    readonly claimsSha256: string;
    readonly sigilcSha256?: string;
    readonly computeSha256: string;
    readonly understandSha256: string;
    readonly egglogSha256: string;
    /** The orchestrator prompt with its per-host parts left as placeholders. */
    readonly promptSha256: string;
    readonly guidanceFingerprint: string;
    readonly vocabularyGeneration: number;
  };
}

export interface BatchOptions {
  readonly selections: readonly BatchSelection[];
  readonly passes: number;
  readonly outputDir: string;
  /** Bounds each whole pass. */
  readonly timeoutMs: number;
  readonly reasoning?: string;
  readonly workspaceDir?: string;
  readonly sigilcExecutable?: string;
  readonly claimsExecutable?: string;
  readonly skillDirs?: {
    readonly computeDir: string;
    readonly understandDir: string;
    readonly egglogDir: string;
  };
  readonly agentExecutables?: Partial<Record<AgentName, string>>;
  /** Codex: the auth file copied into each pass's scratch CODEX_HOME. */
  readonly codexAuthPath?: string;
  /** Pi: the pi-subagents extension entry (untested live). */
  readonly piSubagentsEntry?: string;
  readonly signal?: AbortSignal;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function validateSelections(
  value: readonly { agent: string; model: string }[],
): asserts value is readonly BatchSelection[] {
  if (value.length === 0) {
    throw new Error("Select at least one agent/model combination");
  }
  const seen = new Set<string>();
  for (const selection of value) {
    if (!["claude", "codex", "pi"].includes(selection.agent)) {
      throw new Error(`Unknown agent: ${selection.agent}`);
    }
    if (!selection.model.trim()) {
      throw new Error(`Missing model for ${selection.agent}`);
    }
    const key = JSON.stringify([selection.agent, selection.model]);
    if (seen.has(key)) {
      throw new Error(
        `Duplicate agent/model selection: ${selection.agent}/${selection.model}`,
      );
    }
    seen.add(key);
  }
}

export function buildSchedule(
  selections: readonly BatchSelection[],
  passes: number,
): ScheduledAttempt[] {
  validateSelections(selections);
  if (!Number.isSafeInteger(passes) || passes < 1) {
    throw new Error("Pass count must be a positive integer");
  }
  const schedule: ScheduledAttempt[] = [];
  for (const selection of selections) {
    for (let pass = 1; pass <= passes; pass++) {
      schedule.push({
        id: String(schedule.length + 1).padStart(6, "0"),
        agent: selection.agent,
        model: selection.model,
        pass,
      });
    }
  }
  return schedule;
}

/** What a pass record says before the pass has run. */
export function pendingRecord(planned: ScheduledAttempt): AttemptRecord {
  return {
    ...planned,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    state: null,
    handbackState: null,
    failureStep: null,
    error: null,
    unreadUnits: null,
    observedModels: [],
    modelVerification: "unverified",
    requestedEffort: null,
    childCount: null,
    childModels: [],
    childEfforts: [],
    childEffortVerification: "unverified",
    outcomePath: null,
  };
}

/** The prompt with its per-host and per-model parts left as placeholders. */
export function orchestratorPromptTemplate(): string {
  return orchestratorPrompt({
    spawnInstruction: "{spawn}",
    model: "{model}",
    effort: "{effort}",
  });
}

/** Run the frozen Slotted schedule sequentially, keeping every pass. */
export async function runBatch(options: BatchOptions): Promise<BatchManifest> {
  const schedule = buildSchedule(options.selections, options.passes);
  const outputDir = resolve(options.outputDir);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("Timeout must be a positive number of milliseconds");
  }
  if (await exists(outputDir)) {
    throw new Error(`Output directory already exists: ${outputDir}`);
  }

  const workspaceDir = options.workspaceDir ??
    join(repoRoot, "examples/slotted");
  const sigilc = options.sigilcExecutable ??
    join(repoRoot, "packages/sigilc/target/debug/sigilc");
  const claims = options.claimsExecutable ??
    join(repoRoot, "packages/sigilc/target/debug/sigil-claims");
  const skills = options.skillDirs ?? {
    computeDir: join(repoRoot, "integrations/skills/sigil-compute"),
    understandDir: join(repoRoot, "integrations/skills/sigil-understand"),
    egglogDir: join(repoRoot, "integrations/skills/sigil-egglog"),
  };
  await Deno.mkdir(dirname(outputDir), { recursive: true });
  await Deno.mkdir(outputDir);
  const treeResult = await new Deno.Command(sigilc, {
    args: [
      "tree",
      "--root",
      workspaceDir,
      "--store",
      join(outputDir, "tree-store"),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Promise.all([
    Deno.writeFile(join(outputDir, "tree.json"), treeResult.stdout),
    Deno.writeFile(join(outputDir, "tree.stderr.txt"), treeResult.stderr),
  ]);
  if (treeResult.code !== 0) {
    throw new Error(
      `Slotted tree failed: ${new TextDecoder().decode(treeResult.stderr)}`,
    );
  }
  const trees = JSON.parse(
    new TextDecoder().decode(treeResult.stdout),
  ) as TreeOutput;
  const sourceTexts: Record<string, string> = {};
  for (const tree of trees.trees) {
    sourceTexts[tree.parse.path] = await Deno.readTextFile(
      join(workspaceDir, tree.parse.path),
    );
  }
  const design = designViewFromTrees(trees, sourceTexts);

  const pinned = join(outputDir, "pinned");
  await Deno.mkdir(pinned);
  const pinnedClaims = join(pinned, "sigil-claims");
  await Deno.copyFile(claims, pinnedClaims);
  await Deno.chmod(pinnedClaims, 0o755);
  const pinnedSkills = {
    computeDir: join(pinned, "sigil-compute"),
    understandDir: join(pinned, "sigil-understand"),
    egglogDir: join(pinned, "sigil-egglog"),
  };
  await copySkill(skills.computeDir, pinnedSkills.computeDir);
  await copySkill(skills.understandDir, pinnedSkills.understandDir);
  await copySkill(skills.egglogDir, pinnedSkills.egglogDir);
  const skillSha256: Record<StagedSkill, string> = {
    "sigil-compute": await treeSha256(pinnedSkills.computeDir),
    "sigil-understand": await treeSha256(pinnedSkills.understandDir),
    "sigil-egglog": await treeSha256(pinnedSkills.egglogDir),
  };

  // Preflight: prepare every source once, on a throwaway store, to learn the
  // workspace digest, guidance and vocabulary a pass's check must report.
  let guidanceFingerprint: string | null = null;
  let vocabularyGeneration: number | null = null;
  let workspaceDigest: string | null = null;
  for (const source of SLOTTED_FIXTURE.sources) {
    const prepDir = join(
      outputDir,
      "preflight",
      basename(source.path, ".sigil"),
    );
    const store = join(
      outputDir,
      "preflight-stores",
      basename(source.path, ".sigil"),
    );
    await Deno.mkdir(dirname(prepDir), { recursive: true });
    const prepared = await new Deno.Command(pinnedClaims, {
      args: [
        "prepare",
        "--source",
        source.path,
        "--out",
        prepDir,
        "--root",
        workspaceDir,
        "--store",
        store,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await Deno.writeFile(`${prepDir}.stdout.json`, prepared.stdout);
    await Deno.writeFile(`${prepDir}.stderr.txt`, prepared.stderr);
    if (prepared.code !== 0) {
      throw new Error(
        `Fixture prepare failed for ${source.path}: ${
          new TextDecoder().decode(prepared.stderr)
        }`,
      );
    }
    const preparedResult = JSON.parse(
      new TextDecoder().decode(prepared.stdout),
    );
    if (preparedResult.reusedUnits !== 0) {
      throw new Error(`Fixture prepare reused units for ${source.path}`);
    }
    if (
      workspaceDigest !== null &&
      workspaceDigest !== preparedResult.workspaceDigest
    ) {
      throw new Error("Workspace changed during preflight");
    }
    workspaceDigest = preparedResult.workspaceDigest;
    const binding = JSON.parse(
      await Deno.readTextFile(join(prepDir, "binding.json")),
    );
    if (
      guidanceFingerprint !== null &&
      guidanceFingerprint !== binding.guidanceFingerprint
    ) {
      throw new Error("Guidance changed during preflight");
    }
    if (
      vocabularyGeneration !== null &&
      vocabularyGeneration !== binding.vocabularyGeneration
    ) {
      throw new Error("Vocabulary changed during preflight");
    }
    guidanceFingerprint = binding.guidanceFingerprint;
    vocabularyGeneration = binding.vocabularyGeneration;
  }
  const preflight = preflightSlottedFixture(design);
  if (!preflight.canSchedule) {
    throw new Error(
      `Slotted source drift: ${preflight.sourceDrift.join("; ")}`,
    );
  }
  const sourceSha256: Record<string, string> = {};
  for (const [path, text] of Object.entries(sourceTexts)) {
    sourceSha256[path] = await sha256(new TextEncoder().encode(text));
  }
  const fixtureSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(SLOTTED_FIXTURE)),
  );
  const fixtureState = await fixtureStateSha256(workspaceDir);
  const manifest: BatchManifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    fixture: SLOTTED_FIXTURE,
    fixtureSha256,
    preflight,
    selections: options.selections,
    passes: options.passes,
    timeoutMs: options.timeoutMs,
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    schedule,
    input: {
      workspaceDigest: workspaceDigest!,
      sourceSha256,
      workspaceMemoPresent: await exists(
        join(workspaceDir, ".sigil/claims/interpretations"),
      ),
      fixtureStateSha256: fixtureState,
    },
    tools: {
      claimsPath: "pinned/sigil-claims",
      claimsSha256: await sha256(await Deno.readFile(pinnedClaims)),
      sigilcSha256: await sha256(await Deno.readFile(sigilc)),
      computeSha256: skillSha256["sigil-compute"],
      understandSha256: skillSha256["sigil-understand"],
      egglogSha256: skillSha256["sigil-egglog"],
      promptSha256: await sha256(
        new TextEncoder().encode(orchestratorPromptTemplate()),
      ),
      guidanceFingerprint: guidanceFingerprint!,
      vocabularyGeneration: vocabularyGeneration!,
    },
  };
  await writeJson(join(outputDir, "manifest.json"), manifest);
  for (const planned of schedule) {
    await writeRecord(outputDir, pendingRecord(planned));
  }

  for (const planned of schedule) {
    if (options.signal?.aborted) break;
    const recordPath = join(outputDir, "records", `${planned.id}.json`);
    const running: AttemptRecord = {
      ...JSON.parse(await Deno.readTextFile(recordPath)),
      status: "running",
      requestedEffort: options.reasoning ?? null,
      startedAt: new Date().toISOString(),
    };
    await writeRecord(outputDir, running);
    const attemptDir = join(outputDir, "attempts", planned.id);
    try {
      const outcome = await runPass({
        executable: pinnedClaims,
        fixtureRoot: workspaceDir,
        passDir: join(attemptDir, "pass"),
        evidenceDir: join(attemptDir, "evidence"),
        skillDirs: pinnedSkills,
        expected: {
          workspaceDigest: workspaceDigest!,
          guidanceFingerprint: guidanceFingerprint!,
          vocabularyGeneration,
          fixtureStateSha256: fixtureState,
          skillSha256,
        },
        requestedEffort: options.reasoning ?? null,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        orchestrate: (passDir, binDir, evidenceDir, timeoutMs) =>
          runOrchestrator({
            agent: planned.agent,
            requestedModel: planned.model,
            reasoning: options.reasoning,
            passDir,
            binDir,
            evidenceDir,
            timeoutMs,
            signal: options.signal,
            executable: options.agentExecutables?.[planned.agent],
            codexAuthPath: options.codexAuthPath,
            piSubagentsEntry: options.piSubagentsEntry,
          }),
      });
      const outcomePath = join(attemptDir, "outcome.json");
      await writeJson(outcomePath, outcome);
      await writeRecord(outputDir, {
        ...running,
        status: outcome.status,
        finishedAt: new Date().toISOString(),
        state: outcome.state,
        handbackState: outcome.handbackState,
        failureStep: outcome.failureStep,
        error: outcome.error,
        unreadUnits: outcome.unreadUnits,
        observedModels: outcome.agent?.observedModels ?? [],
        modelVerification: outcome.agent?.modelVerification ?? "unverified",
        childCount: outcome.agent?.children.count ?? null,
        childModels: outcome.agent?.children.models ?? [],
        childEfforts: outcome.agent?.children.efforts ?? [],
        childEffortVerification: outcome.agent?.children.effortVerification ??
          "unverified",
        outcomePath: `attempts/${planned.id}/outcome.json`,
      });
    } catch (cause) {
      await writeRecord(outputDir, {
        ...running,
        status: "failed",
        finishedAt: new Date().toISOString(),
        failureStep: "controller",
        error: String(cause),
      });
    }
  }
  return manifest;
}

export async function readBatch(
  outputDir: string,
): Promise<{ manifest: BatchManifest; records: AttemptRecord[] }> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(outputDir, "manifest.json")),
  ) as BatchManifest;
  if (manifest.version !== 2) {
    throw new Error(
      `${outputDir} was written by an older benchmark (manifest version ${manifest.version}); this one reads version 2 batches`,
    );
  }
  const records: AttemptRecord[] = [];
  for (const planned of manifest.schedule) {
    try {
      records.push(
        JSON.parse(
          await Deno.readTextFile(
            join(outputDir, "records", `${planned.id}.json`),
          ),
        ),
      );
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause;
      records.push(pendingRecord(planned));
    }
  }
  return { manifest, records };
}

async function writeRecord(
  outputDir: string,
  record: AttemptRecord,
): Promise<void> {
  await writeJson(join(outputDir, "records", `${record.id}.json`), record);
}
