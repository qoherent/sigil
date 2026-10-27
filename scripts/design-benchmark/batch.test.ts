import { beforeAll, describe, expect, test } from "bun:test";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exists, treeSha256, writeJson } from "../agent-runner/files.ts";
import { rereadBatch, rereadReference, runBatch } from "./batch.ts";
import {
  copyPinnedReference,
  fakeHosts,
  fakeReader,
  type FakeReaderOptions,
  fakeWriter,
  type FakeWriterOptions,
  type PinnedReference,
  pinnedReference,
} from "./fakes.ts";
import { pinReader } from "./reader.ts";
import { copyDir } from "./stages.ts";
import {
  attemptPaths,
  type PassRecord,
  readBatch,
  readJsonFile,
  referenceStorePaths,
  REPO_ROOT,
} from "./records.ts";
import { buildReport } from "./report.ts";
import { SIGILC, tempDir, TWO_COMPONENTS, writeDesign } from "./testing.ts";

const LONG = 120_000;
let reference: PinnedReference;
let reader: Awaited<ReturnType<typeof fakeReader>>;

beforeAll(async () => {
  const scratch = await tempDir();
  reader = await fakeReader(scratch);
  reference = await pinnedReference({
    root: await writeDesign(join(scratch, "reference-design"), TWO_COMPONENTS),
    dir: join(scratch, "reference-store"),
    scratch,
    reader,
  });
});

/** Run one pass of `slotted-with-split` with a fake writer and reader. */
async function onePass(
  writerOptions: FakeWriterOptions,
  extra: {
    readerOptions?: FakeReaderOptions;
    timeoutMs?: number;
    agent?: "claude" | "pi";
    passes?: number;
    signal?: AbortSignal;
  } = {},
) {
  const scratch = await tempDir();
  const writer = await fakeWriter(scratch, writerOptions);
  const passReader = extra.readerOptions
    ? await fakeReader(scratch, extra.readerOptions)
    : reader;
  const batchDir = join(scratch, "batch");
  const result = await runBatch({
    ...reference.environment,
    hostFor: fakeHosts(writer, passReader),
    timeoutMs: extra.timeoutMs ?? 60_000,
    signal: extra.signal,
    benchmark: "slotted-with-split",
    writers: [{ agent: extra.agent ?? "claude", model: "writer-model" }],
    effort: "high",
    passes: extra.passes ?? 1,
    out: batchDir,
  });
  const record = result.records[0]!;
  return {
    scratch,
    batchDir,
    result,
    record,
    paths: attemptPaths(batchDir, record.id),
  };
}

const status = (record: PassRecord) =>
  Object.fromEntries(
    Object.entries(record.stages).map((
      [stage, state],
    ) => [stage, state.status]),
  );

describe("regenerate passes", () => {
  test(
    "a writer that writes a valid design gives four done stages and every measure",
    async () => {
      const { record, paths, result } = await onePass({
        design: TWO_COMPONENTS,
      });
      expect(status(record)).toEqual({
        writer: "done",
        readScan: "done",
        claims: "done",
        coverage: "done",
      });
      expect(record.reads).toBe("clean");
      expect(await readFile(join(paths.design, "a.sigil"), "utf8")).toBe(
        TWO_COMPONENTS["a.sigil"],
      );
      expect(await exists(join(paths.design, ".sigil", "config.json")))
        .toBe(true);
      expect(
        (await readdir(join(paths.store, "claims", "interpretations"))).length,
      ).toBeGreaterThan(0);
      expect(await exists(paths.coverage)).toBe(true);
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toMatch(/\| Design: state \| coherent \| coherent \|/);
      expect(report).toMatch(/\| Design: answered \| 0 \| 0 \(=\) \|/);
    },
    LONG,
  );

  test(
    "a child that reads examples/slotted makes the pass invalid and names the read",
    async () => {
      const offending = join(REPO_ROOT, "examples", "slotted", "booking.sigil");
      const { record, paths, result } = await onePass({
        design: TWO_COMPONENTS,
        childRead: offending,
      });
      expect(status(record)).toEqual({
        writer: "done",
        readScan: "invalid",
        claims: "unavailable",
        coverage: "unavailable",
      });
      expect(record.reads).toBe("forbidden");
      expect(record.integrity!.forbiddenReads.join("\n")).toContain(offending);
      expect(record.stages.readScan.error).toContain("forbidden read");
      const scan = await readJsonFile<
        {
          forbidden: {
            call: { actor: string; input: { file_path: string } };
          }[];
        }
      >(join(paths.evidence, "read-scan.json"));
      expect(scan.forbidden[0]!.call.actor).toBe("reviewer");
      expect(scan.forbidden[0]!.call.input.file_path).toBe(offending);
      // The design is still kept, and the report leaves the pass out.
      expect(await exists(join(paths.design, "a.sigil"))).toBe(true);
      expect(await readFile(result.reportPath, "utf8")).toMatch(
        /not measured: invalid: a forbidden read/,
      );
    },
    LONG,
  );

  test(
    "a writer that edits the staged requirement file makes the pass invalid",
    async () => {
      const { record } = await onePass({
        design: TWO_COMPONENTS,
        editRequirement: true,
      });
      expect(record.stages.readScan.status).toBe("invalid");
      expect(record.integrity!.changedInputs).toEqual(["requirement.md"]);
      expect(record.integrity!.outsideWrites).toEqual([
        "staging directory: changed requirement.md",
      ]);
    },
    LONG,
  );

  test(
    "a writer that writes under the OS temp directory outside its staging directory is invalid",
    async () => {
      const outside = join(
        tmpdir(),
        `design-benchmark-outside-${crypto.randomUUID()}.txt`,
      );
      const { record } = await onePass({
        design: TWO_COMPONENTS,
        writeOutside: outside,
      });
      expect(record.stages.readScan.status).toBe("invalid");
      expect(record.integrity!.outsideWrites.join("\n")).toContain(
        "design-benchmark-outside-",
      );
      expect(record.integrity!.changedInputs).toEqual([]);
      await rm(outside, { force: true });
    },
    LONG,
  );

  test(
    "a design that does not parse is scored with claims and coverage unavailable",
    async () => {
      const { record, result } = await onePass({
        design: { "bad.sigil": "component Broken {{{ goal\n" },
      });
      expect(status(record)).toEqual({
        writer: "done",
        readScan: "done",
        claims: "unavailable",
        coverage: "unavailable",
      });
      expect(record.stages.claims.error).toMatch(/does not parse: bad.sigil/);
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toMatch(
        /\| Design: sources that do not parse \| none \| bad\.sigil \|/,
      );
    },
    LONG,
  );

  test(
    "a hand-back without a delegated review is a valid pass with review none",
    async () => {
      const { record } = await onePass({
        design: TWO_COMPONENTS,
        review: "none",
      });
      expect(record.stages.readScan.status).toBe("done");
      expect(record.review).toBe("none");
      expect(record.writer!.reviewerStarts).toBe(0);
      expect(record.writer!.state).toBe("written");
    },
    LONG,
  );

  test(
    "review records under run/ and a private store under store/ give a valid delegated pass",
    async () => {
      const { record, paths } = await onePass({
        design: TWO_COMPONENTS,
        review: "delegated",
      });
      expect(status(record)).toEqual({
        writer: "done",
        readScan: "done",
        claims: "done",
        coverage: "done",
      });
      expect(record.review).toBe("delegated");
      expect(record.integrity!.outsideWrites).toEqual([]);
      expect(
        await exists(
          join(paths.evidence, "writer", "run", "review", "report.md"),
        ),
      ).toBe(true);
    },
    LONG,
  );

  test(
    "the claims reader starts with an empty store although the writer left readings in the design",
    async () => {
      const { record, paths } = await onePass({
        design: TWO_COMPONENTS,
        leaveClaims: true,
      });
      expect(record.stages.claims.status).toBe("done");
      const start = await readJsonFile<
        { storeEntries: string[]; rootClaims: boolean; skills: string[] }
      >(join(paths.evidence, "claims", "run", "start-state.json"));
      expect(start).toEqual({
        storeEntries: [],
        rootClaims: false,
        skills: ["sigil-compute-design", "sigil-egglog", "sigil-understand"],
      });
      // The writer's own claims cache is kept as evidence, not as the design.
      expect(await exists(join(paths.design, ".sigil", "claims"))).toBe(false);
      expect(
        await exists(
          join(paths.evidence, "writer", "design", ".sigil", "claims"),
        ),
      ).toBe(true);
    },
    LONG,
  );

  test(
    "a claims reader timeout keeps the design and leaves claims and coverage unavailable, not missed",
    async () => {
      const { record, paths, result } = await onePass(
        { design: TWO_COMPONENTS },
        { readerOptions: { claimsSleepMs: 20_000 }, timeoutMs: 2_000 },
      );
      expect(status(record)).toEqual({
        writer: "done",
        readScan: "done",
        claims: "failed",
        coverage: "unavailable",
      });
      expect(record.stages.claims.error).toBe("the claims reader timed out");
      expect(await exists(join(paths.design, "a.sigil"))).toBe(true);
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toMatch(/unavailable: claims stage failed/);
      expect(report).toMatch(/unavailable: coverage stage unavailable/);
    },
    LONG,
  );

  test("a Pi writer pass is scored with reads unverified", async () => {
    const { record, scratch } = await onePass(
      { design: TWO_COMPONENTS, host: "pi", review: "delegated" },
      { agent: "pi" },
    );
    expect(status(record)).toEqual({
      writer: "done",
      readScan: "done",
      claims: "done",
      coverage: "done",
    });
    expect(record.reads).toBe("unverified");
    expect(record.integrity!.unverifiedReason).toMatch(/Pi/);
    expect(record.writer!.reviewerStarts).toBe(1);
    void scratch;
  }, LONG);

  test(
    "run refuses an existing --out and a reference that is not pinned",
    async () => {
      const scratch = await tempDir();
      const writer = await fakeWriter(scratch, { design: TWO_COMPONENTS });
      const options = {
        ...reference.environment,
        hostFor: fakeHosts(writer, reader),
        benchmark: "slotted-with-split",
        writers: [{ agent: "claude" as const, model: "writer-model" }],
        effort: "high",
        passes: 1,
      };
      await expect(runBatch({ ...options, out: scratch })).rejects.toThrow(
        /already exists/,
      );
      const bare = join(scratch, "bare-reference");
      await expect(
        runBatch({
          ...options,
          out: join(scratch, "batch"),
          references: { slotted: { root: reference.root, dir: bare } },
        }),
      ).rejects.toThrow(/Pin the reference first/);
      await pinReader({
        referenceDir: bare,
        skillsDir: join(REPO_ROOT, "skills"),
        agent: "claude",
        model: "reader-model",
        effort: "high",
      });
      await expect(
        runBatch({
          ...options,
          out: join(scratch, "batch"),
          references: { slotted: { root: reference.root, dir: bare } },
        }),
      ).rejects.toThrow(/has no readings yet/);
      expect(await exists(join(scratch, "batch"))).toBe(false);
    },
    LONG,
  );
});

describe("interruption and reread", () => {
  test(
    "a changed pin refuses stale reference readings before starting a writer",
    async () => {
      const scratch = await tempDir();
      const pinned = await copyPinnedReference(reference, scratch);
      await pinReader({
        referenceDir: pinned.dir,
        skillsDir: join(REPO_ROOT, "skills"),
        agent: "claude",
        model: "new-reader",
        effort: "high",
        force: true,
      });
      let launches = 0;
      await expect(runBatch({
        ...pinned.environment,
        hostFor: () => {
          launches++;
          return reader;
        },
        benchmark: "slotted-with-split",
        writers: [{ agent: "claude", model: "writer-model" }],
        effort: "high",
        passes: 1,
        out: join(scratch, "batch"),
      })).rejects.toThrow(/reader-model.*new-reader/);
      expect(launches).toBe(0);
    },
    LONG,
  );

  test(
    "reread refuses a pinned reader identical to a batch writer before changing evidence",
    async () => {
      const { batchDir, scratch } = await onePass({ design: TWO_COMPONENTS });
      const pinned = await copyPinnedReference(reference, scratch);
      await pinReader({
        referenceDir: pinned.dir,
        skillsDir: join(REPO_ROOT, "skills"),
        agent: "claude",
        model: "writer-model",
        effort: "high",
        force: true,
      });
      const before = await treeSha256(batchDir);
      await expect(rereadBatch({
        ...pinned.environment,
        batchDir,
        coverage: true,
      })).rejects.toThrow(/is the pinned reader/);
      expect(await treeSha256(batchDir)).toBe(before);
    },
    LONG,
  );

  test(
    "a partial changed-reader reread preserves untouched legacy pass provenance",
    async () => {
      const { batchDir, scratch } = await onePass({ design: TWO_COMPONENTS }, {
        passes: 2,
      });
      // Legacy records have only the batch-wide reader identity.
      for (const record of (await readBatch(batchDir)).records) {
        const { reader: _reader, ...legacy } = record;
        await writeJson(attemptPaths(batchDir, record.id).record, legacy);
      }
      const pinned = await copyPinnedReference(reference, scratch);
      await pinReader({
        referenceDir: pinned.dir,
        skillsDir: join(REPO_ROOT, "skills"),
        agent: "claude",
        model: "new-reader",
        effort: "high",
        force: true,
      });
      const out = join(scratch, "new-reference-readings");
      await rereadReference({ ...pinned.environment, coverage: true, out });
      const paths = referenceStorePaths(pinned.dir);
      await copyDir(join(out, "store"), paths.store);
      await copyFile(join(out, "readings.json"), paths.readings);
      await copyFile(join(out, "coverage.json"), paths.coverage);

      const stopped = new AbortController();
      stopped.abort();
      const empty = await rereadBatch({
        ...pinned.environment,
        batchDir,
        coverage: true,
        signal: stopped.signal,
      });
      expect(empty.reread).toEqual([]);
      expect(empty.reportError).toContain("report refuses to compare them");
      expect((await readBatch(batchDir)).manifest.reader.model).toBe(
        "reader-model",
      );

      const controller = new AbortController();
      const result = await rereadBatch({
        ...pinned.environment,
        batchDir,
        coverage: true,
        signal: controller.signal,
        log: (line) => {
          if (line === "reread 000002") controller.abort();
        },
      });
      expect(result.reread).toEqual(["000001"]);
      expect(result.reportError).toBeNull();
      const after = await readBatch(batchDir);
      expect(after.manifest.reader.model).toBe("new-reader");
      expect(after.records[0]!.reader!.model).toBe("new-reader");
      expect(after.records[1]!.reader!.model).toBe("reader-model");
      expect(after.records[1]!.stages.claims.status).toBe("done");
      expect(after.records[1]!.stages.coverage.status).toBe("done");
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain(
        "unavailable: readings were taken by a different reader",
      );
      await expect(rereadBatch({
        ...pinned.environment,
        batchDir,
        coverage: false,
      })).rejects.toThrow(/Reread it with --coverage/);
    },
    LONG,
  );

  test(
    "a cancelled batch records the active stage as interrupted, keeps its staging directory and writes a report",
    async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1_000);
      const { record, result, batchDir } = await onePass(
        { design: TWO_COMPONENTS, sleepMs: 20_000 },
        { signal: controller.signal, passes: 2 },
      );
      expect(status(record)).toEqual({
        writer: "interrupted",
        readScan: "unavailable",
        claims: "unavailable",
        coverage: "unavailable",
      });
      expect(record.stagingPath).not.toBeNull();
      expect(
        await exists(join(record.stagingPath!, "writer", "requirement.md")),
      )
        .toBe(true);
      expect(result.records[1]!.stages.writer.status).toBe("pending");
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toMatch(/writer interrupted/);

      // A batch killed outright leaves its active record running; the report
      // rebuilt from the files shows it as interrupted.
      const paths = attemptPaths(batchDir, record.id);
      await writeJson(paths.record, {
        ...record,
        stages: {
          ...record.stages,
          writer: { status: "running", error: null },
        },
      });
      const rebuilt = await buildReport({
        batchDirs: [batchDir],
        sigilc: SIGILC,
        references: reference.environment.references,
      });
      expect(rebuilt).toMatch(/writer interrupted/);
      expect(rebuilt).not.toMatch(/writer running/);
      await rm(record.stagingPath!, { recursive: true, force: true });
    },
    LONG,
  );

  test(
    "reread on a finished batch takes new claims readings and leaves designs and coverage alone",
    async () => {
      const { batchDir, paths } = await onePass({ design: TWO_COMPONENTS });
      const designBefore = await treeSha256(paths.design);
      const coverageBefore = await readFile(paths.coverage, "utf8");
      const manifestBefore = (await readBatch(batchDir)).manifest;
      const result = await rereadBatch({
        ...reference.environment,
        batchDir,
        coverage: false,
      });
      expect(result.reread).toEqual(["000001"]);
      expect(result.reportError).toBeNull();
      expect(await treeSha256(paths.design)).toBe(designBefore);
      expect(await readFile(paths.coverage, "utf8")).toBe(coverageBefore);
      const evidence = await readdir(paths.evidence);
      const superseded = evidence.find((name) =>
        name.startsWith("superseded-")
      )!;
      const reread = evidence.find((name) => name.startsWith("reread-"))!;
      expect(
        await exists(join(paths.evidence, superseded, "store", "claims")),
      ).toBe(true);
      expect(
        await exists(
          join(paths.evidence, reread, "claims", "run", "start-state.json"),
        ),
      ).toBe(true);
      expect(
        (await readdir(join(paths.store, "claims", "interpretations"))).length,
      ).toBeGreaterThan(0);
      const after = await readBatch(batchDir);
      expect(after.records[0]!.stages.claims.status).toBe("done");
      expect(after.manifest.readings).toEqual(manifestBefore.readings);
      expect(after.manifest.rereads).toHaveLength(1);
      expect(after.manifest.rereads![0]!.coverage).toBe(false);
    },
    LONG,
  );

  test(
    "reread without --coverage refuses a batch read by another reader",
    async () => {
      const { batchDir } = await onePass({ design: TWO_COMPONENTS });
      const manifestPath = join(batchDir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      await writeFile(
        manifestPath,
        JSON.stringify({
          ...manifest,
          reader: { ...manifest.reader, model: "old" },
        }),
      );
      await expect(
        rereadBatch({ ...reference.environment, batchDir, coverage: false }),
      ).rejects.toThrow(/Reread it with --coverage/);
    },
    LONG,
  );
});

describe("reread that does not finish", () => {
  const failingHosts = (role: string) =>
    role === "reader" ? { executable: "sh", args: ["-c", "exit 1"] } : undefined;

  test(
    "a reread whose claims reader fails keeps the old readings, record and manifest",
    async () => {
      const { batchDir, paths } = await onePass({ design: TWO_COMPONENTS });
      const storeBefore = await treeSha256(paths.store);
      const before = await readBatch(batchDir);
      const result = await rereadBatch({
        ...reference.environment,
        hostFor: failingHosts,
        batchDir,
        coverage: false,
      });
      expect(result.reread).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          id: "000001",
          reason: expect.stringContaining("reread failed, kept its old readings"),
        }),
      ]);
      expect(await treeSha256(paths.store)).toBe(storeBefore);
      const after = await readBatch(batchDir);
      expect(after.records[0]).toEqual(before.records[0]);
      expect(after.manifest.reader).toEqual(before.manifest.reader);
      expect(after.manifest.readings).toEqual(before.manifest.readings);
      expect(after.manifest.rereads ?? []).toEqual([]);
      const evidence = await readdir(paths.evidence);
      expect(evidence.some((name) => name.startsWith("superseded-"))).toBe(
        false,
      );
    },
    LONG,
  );

  test(
    "a pass whose claims reader hands back failed has a failed claims stage",
    async () => {
      const { record } = await onePass(
        { design: TWO_COMPONENTS },
        { readerOptions: { handback: "failed" } },
      );
      expect(status(record).claims).toBe("failed");
    },
    LONG,
  );
});

describe("reference reread refusals", () => {
  test(
    "a claims reading handed back failed is refused and writes no readings",
    async () => {
      const scratch = await tempDir();
      const reader = await fakeReader(scratch, { handback: "failed" });
      const out = join(scratch, "out");
      await expect(rereadReference({
        ...reference.environment,
        hostFor: fakeHosts(null, reader),
        coverage: false,
        out,
      })).rejects.toThrow(/handed back failed/);
      expect(await exists(join(out, "readings.json"))).toBe(false);
    },
    LONG,
  );

  test(
    "a claims reading with unread units is refused and writes no readings",
    async () => {
      const scratch = await tempDir();
      const reader = await fakeReader(scratch, { skipClaims: true });
      const out = join(scratch, "out");
      await expect(rereadReference({
        ...reference.environment,
        hostFor: fakeHosts(null, reader),
        coverage: false,
        out,
      })).rejects.toThrow(/is incomplete/);
      expect(await exists(join(out, "readings.json"))).toBe(false);
    },
    LONG,
  );
});

describe("coverage that does not finish", () => {
  test(
    "a reread whose coverage reader fails keeps the old coverage and readings",
    async () => {
      const { batchDir, paths } = await onePass({ design: TWO_COMPONENTS });
      const coverageBefore = await readFile(paths.coverage, "utf8");
      const storeBefore = await treeSha256(paths.store);
      const before = await readBatch(batchDir);
      const reader = await fakeReader(await tempDir(), { skipCoverage: true });
      const result = await rereadBatch({
        ...reference.environment,
        hostFor: (role: string) => (role === "reader" ? reader : undefined),
        batchDir,
        coverage: true,
      });
      expect(result.reread).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          id: "000001",
          reason: expect.stringContaining("coverage done"),
        }),
      ]);
      expect(await readFile(paths.coverage, "utf8")).toBe(coverageBefore);
      expect(await treeSha256(paths.store)).toBe(storeBefore);
      const after = await readBatch(batchDir);
      expect(after.records[0]).toEqual(before.records[0]);
      expect(after.manifest.reader).toEqual(before.manifest.reader);
    },
    LONG,
  );
});

describe("reference coverage refusal", () => {
  test(
    "a reference whose coverage reader fails is refused and writes no readings",
    async () => {
      const scratch = await tempDir();
      const reader = await fakeReader(scratch, { skipCoverage: true });
      const out = join(scratch, "out");
      await expect(rereadReference({
        ...reference.environment,
        hostFor: fakeHosts(null, reader),
        coverage: true,
        out,
      })).rejects.toThrow(/coverage reading done/);
      expect(await exists(join(out, "readings.json"))).toBe(false);
    },
    LONG,
  );
});
