import {
  deepStrictEqual as deepEqual,
  strictEqual as equal,
} from "node:assert/strict";
import { exists } from "./files.ts";
import {
  buildSchedule,
  orchestratorPromptTemplate,
  pendingRecord,
  readBatch,
  runBatch,
  validateSelections,
} from "./batch.ts";

Deno.test("two agent/model combinations across three passes schedule six distinct passes", () => {
  const schedule = buildSchedule([
    { agent: "claude", model: "sonnet" },
    { agent: "codex", model: "gpt-6" },
  ], 3);
  equal(schedule.length, 6);
  equal(new Set(schedule.map((attempt) => attempt.id)).size, 6);
  deepEqual(
    new Set(schedule.map((attempt) => attempt.pass)),
    new Set([1, 2, 3]),
  );
  for (const pass of [1, 2, 3]) {
    equal(schedule.filter((attempt) => attempt.pass === pass).length, 2);
  }
});

Deno.test("one selection and two passes schedule two whole-design passes with no per-source work", () => {
  const schedule = buildSchedule([{ agent: "claude", model: "sonnet" }], 2);
  equal(schedule.length, 2);
  deepEqual(schedule.map((attempt) => attempt.pass), [1, 2]);
  for (const attempt of schedule) {
    equal("sources" in attempt, false);
  }
});

Deno.test("invalid passes, unknown agents, and duplicate selections fail before launch", () => {
  for (const passes of [0, -1, 1.5]) {
    try {
      buildSchedule([{ agent: "pi", model: "provider/model" }], passes);
      throw new Error("accepted invalid pass count");
    } catch (error) {
      if (String(error).includes("accepted invalid")) throw error;
    }
  }
  try {
    validateSelections([
      { agent: "pi", model: "provider/model" },
      { agent: "pi", model: "provider/model" },
    ]);
    throw new Error("accepted duplicate selection");
  } catch (error) {
    if (String(error).includes("accepted duplicate")) throw error;
  }
  try {
    validateSelections([{ agent: "other", model: "model" }]);
    throw new Error("accepted unknown agent");
  } catch (error) {
    if (String(error).includes("accepted unknown")) throw error;
  }
});

Deno.test("frozen batch retains one pending pass record when cancelled before launches", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "slotted-batch-test-" });
  await Deno.remove(outputDir);
  const controller = new AbortController();
  controller.abort();
  try {
    const manifest = await runBatch({
      selections: [{ agent: "claude", model: "unlaunched" }],
      passes: 1,
      outputDir,
      timeoutMs: 1000,
      signal: controller.signal,
    });
    const retained = await readBatch(outputDir);
    equal(manifest.schedule.length, 1);
    equal(retained.records.length, 1);
    equal(manifest.version, 3);
    equal(
      retained.records.every((record) => record.status === "pending"),
      true,
    );
    // The linked check reads every source's private sections, so the
    // ownership problem Rooms states in its state section is scorable.
    deepEqual(
      manifest.preflight.issues.map((issue) => issue.status),
      ["scorable", "scorable", "scorable", "scorable"],
    );
    equal(Object.keys(manifest.input.sourceSha256).length, 7);
    equal(manifest.input.workspaceMemoPresent, false);
    equal(typeof manifest.input.fixtureStateSha256, "string");
    // The staged skills and the prompt template are pinned by hash.
    for (
      const key of [
        "computeSha256",
        "understandSha256",
        "egglogSha256",
        "promptSha256",
        "claimsSha256",
      ] as const
    ) {
      equal(/^[0-9a-f]{64}$/.test(manifest.tools[key]), true, key);
    }
    equal(
      orchestratorPromptTemplate().includes(
        "skills/sigil-compute-design/SKILL.md",
      ),
      true,
    );
    for (
      const skill of [
        "sigil-compute-design",
        "sigil-understand",
        "sigil-egglog",
      ]
    ) {
      await Deno.stat(`${outputDir}/pinned/${skill}/SKILL.md`);
    }

    await Deno.remove(`${outputDir}/records/${manifest.schedule[0].id}.json`);
    const recovered = await readBatch(outputDir);
    equal(recovered.records.length, 1);
    deepEqual(recovered.records[0], pendingRecord(manifest.schedule[0]));
    equal(recovered.records[0].unreadUnits, null);
    equal(recovered.records[0].childEffortVerification, "unverified");
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("existing output directory is refused before the tree read or child launch", async () => {
  const outputDir = await Deno.makeTempDir({
    prefix: "slotted-existing-batch-",
  });
  try {
    let message = "";
    try {
      await runBatch({
        selections: [{ agent: "claude", model: "unlaunched" }],
        passes: 1,
        outputDir,
        timeoutMs: 1000,
        sigilcExecutable: "/missing/sigilc",
      });
    } catch (cause) {
      message = String(cause);
    }
    equal(message.includes("Output directory already exists"), true);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("missing pinned skill fails before scheduling attempts", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-skill-test-" });
  try {
    const missing = `${root}/missing-skill`;
    await Deno.mkdir(`${missing}/references`, { recursive: true });
    let error = "";
    try {
      await runBatch({
        selections: [{ agent: "claude", model: "unlaunched" }],
        passes: 1,
        outputDir: `${root}/batch`,
        timeoutMs: 1000,
        skillDirs: {
          computeDir: "integrations/skills/sigil-compute-design",
          understandDir: missing,
          egglogDir: "integrations/skills/sigil-egglog",
        },
      });
    } catch (cause) {
      error = String(cause);
    }
    equal(error.includes("SKILL.md"), true, error);
    equal(await exists(`${root}/batch/manifest.json`), false);
    equal(await exists(`${root}/batch/records`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a batch written by an older benchmark is refused by name", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-old-batch-" });
  try {
    await Deno.writeTextFile(
      `${root}/manifest.json`,
      JSON.stringify({ version: 1, schedule: [] }),
    );
    let message = "";
    try {
      await readBatch(root);
    } catch (error) {
      message = String(error);
    }
    equal(message.includes("manifest version 1"), true, message);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
