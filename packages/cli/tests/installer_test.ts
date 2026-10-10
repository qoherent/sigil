import { deepStrictEqual as equal, rejects } from "node:assert/strict";
import { join } from "node:path";
import { installSkills } from "../src/installer.ts";
import { runCli } from "../src/main.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "sigil retired skills Ω " });
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function skill(catalog: string, name: string) {
  await Deno.mkdir(join(catalog, name), { recursive: true });
  await Deno.writeTextFile(join(catalog, name, "SKILL.md"), `${name}\n`);
}

// @sigil tests packages/cli/src/installer.sigil::SkillInstaller::SkillInstallation logic,constraints,cases
Deno.test("install prunes retired manifest-managed links and copies and leaves their sources alone", async () => {
  await fixture(async (root) => {
    const before = join(root, "before");
    const after = join(root, "after");
    await skill(before, "sigil-compute");
    await skill(after, "sigil-compute-design");
    for (const forceCopy of [false, true]) {
      const userHome = join(root, forceCopy ? "copy" : "link");
      const options = { agents: ["codex"] as const, userHome, forceCopy };
      await installSkills({ ...options, sourceDirectory: before });
      const retired = join(userHome, ".agents/skills/sigil-compute");
      const result = await installSkills({
        ...options,
        sourceDirectory: after,
      });
      equal(result.pruned.map((item) => item.name), ["sigil-compute"]);
      await rejects(() => Deno.lstat(retired), Deno.errors.NotFound);
      equal(
        await Deno.readTextFile(join(before, "sigil-compute/SKILL.md")),
        "sigil-compute\n",
      );
      equal(
        await Deno.readTextFile(
          join(userHome, ".agents/skills/sigil-compute-design/SKILL.md"),
        ),
        "sigil-compute-design\n",
      );
      const manifest = JSON.parse(
        await Deno.readTextFile(
          join(userHome, ".agents/skills/.sigil-managed.json"),
        ),
      );
      equal(Object.keys(manifest.entries), ["sigil-compute-design"]);
      equal(
        (await installSkills({ ...options, sourceDirectory: after })).pruned,
        [],
      );
    }
  });
});

Deno.test("install preserves and reports an unmanaged retired skill through the CLI result", async () => {
  await fixture(async (root) => {
    const sourceDirectory = join(root, "catalog");
    const userHome = join(root, "home");
    await skill(sourceDirectory, "sigil-compute-design");
    await skill(join(userHome, ".agents/skills"), "sigil-compute");
    const result = await runCli(["skill", "install", "--agent", "codex"], {
      install: { sourceDirectory, userHome },
    });
    equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    equal(payload.pruned, []);
    equal(payload.unmanaged.map((item: { name: string }) => item.name), [
      "sigil-compute",
    ]);
    equal(
      await Deno.readTextFile(
        join(userHome, ".agents/skills/sigil-compute/SKILL.md"),
      ),
      "sigil-compute\n",
    );
    equal(payload.skills.map((item: { name: string }) => item.name), [
      "sigil-compute-design",
    ]);
  });
});

Deno.test("retirement refuses a manifest path outside the skills directory before installing or deleting", async () => {
  await fixture(async (root) => {
    const sourceDirectory = join(root, "catalog");
    const userHome = join(root, "home");
    const destination = join(userHome, ".agents/skills");
    const outside = join(userHome, "outside");
    await skill(sourceDirectory, "sigil-compute-design");
    await Deno.mkdir(destination, { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(join(outside, "keep.txt"), "unrelated\n");
    await Deno.writeTextFile(
      join(destination, ".sigil-managed.json"),
      JSON.stringify({
        version: 1,
        entries: { "../../outside": { source: "old-catalog", mode: "copy" } },
      }),
    );
    await rejects(
      () => installSkills({ sourceDirectory, userHome, agents: ["codex"] }),
      /Invalid managed skill/,
    );
    equal(await Deno.readTextFile(join(outside, "keep.txt")), "unrelated\n");
    await rejects(
      () => Deno.lstat(join(destination, "sigil-compute-design")),
      Deno.errors.NotFound,
    );
  });
});
