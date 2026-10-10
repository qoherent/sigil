import {
  deepStrictEqual as equal,
  ok as assert,
  rejects,
} from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { FOUNDATION_SKILLS, validateFoundation } from "./validate-skill.ts";
import {
  documentaryLinks,
  LANGUAGE_PACK_PATH,
  LANGUAGE_SOURCES,
  syncLanguagePack,
  validateBundledLanguagePack,
  validateLanguagePack,
} from "./sync-skill-language.ts";

const root = resolve(import.meta.dirname!, "..");
const revision = "0123456789012345678901234567890123456789";

async function copyTree(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (entry.isDirectory) {
      await copyTree(join(source, entry.name), join(target, entry.name));
    } else if (entry.isFile) {
      await Deno.copyFile(join(source, entry.name), join(target, entry.name));
    }
  }
}

Deno.test("foundation validates relocated catalog and rejects broken dependencies and documentary links", async () => {
  const catalog = await Deno.makeTempDir({
    prefix: "sigil foundation catalog 空 ",
  });
  try {
    await copyTree(join(root, "integrations/skills"), catalog);
    await validateFoundation(catalog);
    const entry = join(catalog, "sigil-write/SKILL.md");
    const original = await Deno.readTextFile(entry);
    await Deno.writeTextFile(
      entry,
      original +
        "\n`[literal](absent.md)`\n```text\n[example](absent.md)\n```\n",
    );
    await validateFoundation(catalog);
    await Deno.writeTextFile(
      entry,
      original + "\n[Missing reference](references/absent.md)\n",
    );
    await rejects(() => validateFoundation(catalog), /Missing local reference/);
    await Deno.writeTextFile(
      entry,
      original + "\n[Legacy](../sigil/SKILL.md)\n",
    );
    await rejects(
      () => validateFoundation(catalog),
      /outside declared foundation dependencies/,
    );
    await Deno.writeTextFile(entry, original);
    const metadataPath = join(catalog, "sigil-write/compatibility.json");
    const metadata = await Deno.readTextFile(metadataPath);
    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({ sigilVersion: "0.9.0", requiredSkills: [] }),
    );
    await rejects(() => validateFoundation(catalog), /Required skills/);
    await Deno.writeTextFile(metadataPath, metadata);
    const computeEntry = join(catalog, "sigil-compute-design/SKILL.md");
    const computeOriginal = await Deno.readTextFile(computeEntry);
    await Deno.writeTextFile(
      computeEntry,
      computeOriginal + "\n[Advisory](../sigil-evaluate/SKILL.md)\n",
    );
    await rejects(
      () => validateFoundation(catalog),
      /outside declared foundation dependencies/,
    );
    await Deno.writeTextFile(computeEntry, computeOriginal);
    const computeMetadataPath = join(
      catalog,
      "sigil-compute-design/compatibility.json",
    );
    const computeMetadata = await Deno.readTextFile(computeMetadataPath);
    await Deno.writeTextFile(
      computeMetadataPath,
      JSON.stringify({ sigilVersion: "0.9.0", requiredSkills: [] }),
    );
    await rejects(() => validateFoundation(catalog), /Required skills/);
    await Deno.writeTextFile(computeMetadataPath, computeMetadata);
    await Deno.rename(
      join(catalog, "sigil-egglog"),
      join(catalog, "unavailable-dialect"),
    );
    await rejects(
      () => validateFoundation(catalog),
      /Missing foundation skill/,
    );
    await Deno.rename(
      join(catalog, "unavailable-dialect"),
      join(catalog, "sigil-egglog"),
    );
    await Deno.rename(
      join(catalog, "sigil-evaluate"),
      join(catalog, "unavailable-evaluator"),
    );
    await rejects(
      () => validateFoundation(catalog),
      /Missing foundation skill/,
    );
  } finally {
    await Deno.remove(catalog, { recursive: true });
  }
});

Deno.test("alignment skill validates declared siblings and local links in a relocated catalog", async () => {
  const catalog = await Deno.makeTempDir({
    prefix: "sigil alignment catalog 空 ",
  });
  try {
    await copyTree(join(root, "integrations/skills"), catalog);
    await validateFoundation(catalog);

    const entry = join(catalog, "sigil-align/SKILL.md");
    const original = await Deno.readTextFile(entry);
    await Deno.writeTextFile(
      entry,
      original + "\n[Broken local link](references/absent.md)\n",
    );
    await rejects(
      () => validateFoundation(catalog),
      /Missing local reference: .*sigil-align/,
    );
    await Deno.writeTextFile(entry, original);

    await Deno.rename(
      join(catalog, "sigil-write"),
      join(catalog, "unavailable-writer"),
    );
    await rejects(
      () => validateFoundation(catalog),
      /Missing foundation skill dependency: .*sigil-write\/SKILL\.md/,
    );
  } finally {
    await Deno.remove(catalog, { recursive: true });
  }
});

Deno.test("computed alignment declares its composed loop dependencies and validates relocated metadata", async () => {
  equal(FOUNDATION_SKILLS["sigil-compute-align"], [
    "sigil-compute-design",
    "sigil-understand",
    "sigil-egglog",
  ]);
  const catalog = await Deno.makeTempDir({
    prefix: "sigil computed alignment 空 ",
  });
  try {
    await copyTree(join(root, "integrations/skills"), catalog);
    await validateFoundation(catalog);
    const directory = join(catalog, "sigil-compute-align");
    for (
      const [file, content, error] of [
        ["VERSION", "invalid", /Invalid artifact version/],
        [
          "compatibility.json",
          JSON.stringify({ sigilVersion: "0.9.0", requiredSkills: [] }),
          /Required skills/,
        ],
        [
          "compatibility.json",
          JSON.stringify({
            sigilVersion: "0.7.0",
            requiredSkills: FOUNDATION_SKILLS["sigil-compute-align"],
          }),
          /Language version/,
        ],
        [
          "compatibility.json",
          JSON.stringify({
            sigilVersion: "0.9.0",
            requiredSkills: FOUNDATION_SKILLS["sigil-compute-align"],
            nativeVersion: "*",
          }),
          /Unexpected compatibility fields/,
        ],
        [
          "agents/openai.yaml",
          'interface:\n  display_name: "Align"\n  short_description: "Computed alignment"\n  default_prompt: "Run alignment"\n',
          /Adapter must invoke/,
        ],
      ] as const
    ) {
      const path = join(directory, file);
      const original = await Deno.readTextFile(path);
      await Deno.writeTextFile(path, content);
      await rejects(() => validateFoundation(catalog), error);
      await Deno.writeTextFile(path, original);
    }
    const entry = join(directory, "SKILL.md");
    const original = await Deno.readTextFile(entry);
    for (
      const [link, error] of [
        ["[Missing](references/absent.md)", /Missing local reference/],
        [
          "[Advisory](../sigil-align/SKILL.md)",
          /outside declared foundation dependencies/,
        ],
      ] as const
    ) {
      await Deno.writeTextFile(entry, original + "\n" + link + "\n");
      await rejects(() => validateFoundation(catalog), error);
      await Deno.writeTextFile(entry, original);
    }
    await Deno.rename(
      join(catalog, "sigil-compute-design"),
      join(catalog, "unavailable-compute-design"),
    );
    await rejects(
      () => validateFoundation(catalog),
      /Missing foundation skill/,
    );
  } finally {
    await Deno.remove(catalog, { recursive: true });
  }
});

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await Deno.makeTempDir({ prefix: "sigil foundation 空 " });
  try {
    for (const source of LANGUAGE_SOURCES) {
      await Deno.mkdir(dirname(join(directory, source)), { recursive: true });
      await Deno.copyFile(join(root, source), join(directory, source));
    }
    await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("language pack rejects source/output drift and explicit sync restores it", async () => {
  await fixture(async (directory) => {
    const original = await syncLanguagePack(directory, { revision });
    equal(await validateLanguagePack(directory), original);
    const output = join(directory, LANGUAGE_PACK_PATH, "sigil-reference.md");
    const expected = await Deno.readTextFile(output);
    await Deno.writeTextFile(output, expected + "\nDrift.\n");
    await rejects(
      () => validateLanguagePack(directory),
      /Bundled output drift/,
    );
    equal(await syncLanguagePack(directory), original);
    equal(await Deno.readTextFile(output), expected);
    const source = join(directory, "spec/sigil-reference.md");
    await Deno.writeTextFile(
      source,
      await Deno.readTextFile(source) + "\nChanged authority.\n",
    );
    await rejects(() => validateLanguagePack(directory), /Source drift/);
    const updated = await syncLanguagePack(directory);
    equal(await validateLanguagePack(directory), updated);
    assert(
      updated.sources[0].sourceSha256 !== original.sources[0].sourceSha256,
    );
    equal(updated.upstreamRevision, revision);
    equal(await syncLanguagePack(directory), updated);
  });
});

Deno.test("documentary links ignore fenced and inline code and retain destination offsets", () => {
  const source = [
    '[Core](sigil-reference.md#tags) and [background](../notes/design.md "Title").',
    "`[example](missing.md)` and ``[other](absent.md)``.",
    "```sigil",
    "[payload](payload.md)",
    "```",
    "~~~~text",
    "[payload](second.md)",
    "~~~~",
    "[angle](<name%20with%20spaces.md>) [paren](notes/a(b).md)",
    '[ref]: background.md "Background"',
  ].join("\n");
  const links = documentaryLinks(source);
  equal(links.map((link) => link.destination), [
    "sigil-reference.md#tags",
    "../notes/design.md",
    "name%20with%20spaces.md",
    "notes/a(b).md",
    "background.md",
  ]);
  for (const link of links) {
    equal(source.slice(link.start, link.end), link.destination);
  }
});

Deno.test("language sync changes only documentary background destinations", async () => {
  await fixture(async (directory) => {
    const source = join(directory, "spec/sigil-reference.md");
    const input =
      "[Core](sigil-language.md#examples)\n[Background](../docs/note.md#why)\n`[literal](missing.md)`\n```sigil\n[linked payload](./schema.yaml)\n```\n";
    await Deno.writeTextFile(source, input);
    await syncLanguagePack(directory, { revision });
    const output = await Deno.readTextFile(
      join(directory, LANGUAGE_PACK_PATH, "sigil-reference.md"),
    );
    equal(
      output,
      input.replace(
        "../docs/note.md#why",
        `https://github.com/farhoud/sigil/blob/${revision}/docs/note.md#why`,
      ),
    );
    await validateLanguagePack(directory);
  });
});

Deno.test("relocated language authority resolves core references offline and preserves multiword Tags", async () => {
  await fixture(async (directory) => {
    await syncLanguagePack(directory, { revision });
    await Deno.remove(join(directory, "spec"), { recursive: true });
    const pack = join(directory, LANGUAGE_PACK_PATH);
    await validateBundledLanguagePack(pack);
    for (
      const name of LANGUAGE_SOURCES.map((source) =>
        source.slice("spec/".length)
      )
    ) {
      const body = await Deno.readTextFile(join(pack, name));
      for (const { destination } of documentaryLinks(body)) {
        if (
          /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
          destination.startsWith("#")
        ) continue;
        assert((await Deno.stat(join(pack, destination.split("#")[0]))).isFile);
      }
    }
    const normative = await Deno.readTextFile(join(pack, "sigil-reference.md"));
    assert(normative.includes("  search results,"));
    assert(normative.includes("Names cannot cross a physical line."));
  });
});

Deno.test("installed language pack rejects corrupt metadata and undeclared content", async () => {
  await fixture(async (directory) => {
    const manifest = await syncLanguagePack(directory, { revision });
    const pack = join(directory, LANGUAGE_PACK_PATH);
    const manifestPath = join(pack, "manifest.json");
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify({ ...manifest, upstreamRevision: "main" }),
    );
    await rejects(
      () => validateBundledLanguagePack(pack),
      /Invalid language pack manifest/,
    );
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));
    await Deno.writeTextFile(
      join(pack, "untracked.md"),
      "Unexpected language authority",
    );
    await rejects(
      () => validateBundledLanguagePack(pack),
      /Unexpected language pack entry/,
    );
    await Deno.remove(join(pack, "untracked.md"));
    await validateBundledLanguagePack(pack);
  });
});
