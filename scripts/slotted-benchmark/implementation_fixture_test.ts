import {
  cannedCode,
  cannedDesign,
  native,
} from "./implementation_test_support.ts";
import { readBatch, runBatch } from "./batch.ts";
import { writeReport } from "./report.ts";
import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { join } from "node:path";
import { copyTree } from "./files.ts";
import {
  applyImplementationPlants,
  implementationPlants,
  preflightImplementationFixture,
} from "./implementation.ts";

const fixture =
  new URL("../../examples/slotted-implementation/", import.meta.url).pathname;

Deno.test("repaired Slotted clean code and each independent plant replay deterministically", async () => {
  const plants = await implementationPlants();
  equal(plants.length, 6);
  for (const plant of [null, ...plants]) {
    const scratch = await Deno.makeTempDir({
      prefix: "slotted-implementation-",
    });
    try {
      const root = join(scratch, "root"), store = join(scratch, "store");
      await copyTree(fixture, root);
      if (plant) await applyImplementationPlants(root, [plant.id]);
      const design = await cannedDesign(root, store, scratch);
      assert(["coherent", "loose"].includes(design.state));
      await cannedCode(root, store, scratch);
      const summary = await native(
        root,
        store,
        ["align", "check"],
        plant ? 1 : 0,
      );
      const report = JSON.parse(await Deno.readTextFile(summary.report));
      if (plant) {
        equal(summary.state, "drift");
        assert(
          report.findings.some((f: { law: string }) =>
            plant.laws.includes(f.law)
          ),
          plant.id,
        );
      } else {
        assert(["closed", "converged"].includes(summary.state));
        equal(report.undesignedFiles, []);
        equal(report.undesignedElements, []);
      }
      if (!plant) {
        await Deno.writeTextFile(
          join(root, "src/aux.sigil"),
          "component Auxiliary {\n goal {\n Name a context boundary.\n }\n interface {\n State context without a delivery promise.\n }\n}\n",
        );
        // Discover and read the new design source; it must never become a code unit.
        const config = JSON.parse(
          await Deno.readTextFile(join(root, ".sigil/config.json")),
        );
        delete config.tools.sigilc.implementation.design;
        await Deno.writeTextFile(
          join(root, ".sigil/config.json"),
          JSON.stringify(config),
        );
        const out = join(scratch, "aux");
        await native(root, store, [
          "prepare",
          "--source",
          "src/aux.sigil",
          "--out",
          out,
        ]);
        const req = JSON.parse(
          await Deno.readTextFile(join(out, "request.json")),
        );
        const answer = join(out, "answer.egg");
        await Deno.writeTextFile(
          answer,
          req.rows.filter((f: { context?: boolean }) => !f.context).map((
            f: { facet: string },
          ) => `(reading ${JSON.stringify(f.facet)} "no-commitment")`).join(
            "\n",
          ),
        );
        await native(root, store, [
          "ingest",
          "--binding",
          join(out, "binding.json"),
          "--claims",
          answer,
        ]);
        const checked = await native(root, store, ["align", "check"]);
        equal(checked.state, summary.state);
        const r = JSON.parse(await Deno.readTextFile(checked.report));
        equal(r.selection.implementation.autoExcludedDesign, ["src/aux.sigil"]);
      }
    } finally {
      await Deno.remove(scratch, { recursive: true });
    }
  }
  const scratch = await Deno.makeTempDir();
  try {
    await copyTree(fixture, scratch);
    await applyImplementationPlants(scratch);
    equal(
      (await preflightImplementationFixture(scratch, "planted")).canSchedule,
      true,
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("an implementation pass stages the composed skill and accepts only matching native hand-back evidence", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "alignment-action-" });
  try {
    const host = join(scratch, "host");
    const support =
      new URL("./implementation_test_support.ts", import.meta.url).href;
    await Deno.writeTextFile(
      host,
      `#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
import {cannedDesign,cannedCode,native} from ${JSON.stringify(support)};
if(Deno.args.includes("--version")){console.log("fake-alignment 1.0");Deno.exit(0);}
await cannedDesign("root","store","run");await cannedCode("root","store","run");
const check=await native("root","store",["align","check"]);
console.log(JSON.stringify({type:"result",result:"Hand-back state: "+check.state}));
`,
    );
    await Deno.chmod(host, 0o755);
    const batch = join(scratch, "batch");
    await runBatch({
      action: "implementation",
      variant: "clean",
      selections: [{ agent: "claude", model: "fake" }],
      passes: 1,
      timeoutMs: 60000,
      outputDir: batch,
      agentExecutables: { claude: host },
    });
    const { manifest, records } = await readBatch(batch);
    equal(manifest.action, "implementation");
    equal(records[0].status, "valid", records[0].error ?? "");
    equal(records[0].state, "closed");
    assert(
      (await Deno.readTextFile(await writeReport(batch))).includes(
        "Action: implementation",
      ),
    );
    await Deno.stat(
      join(batch, "attempts/000001/pass/skills/sigil-compute-align/SKILL.md"),
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});
