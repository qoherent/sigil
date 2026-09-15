import {
  deepStrictEqual as equal,
  ok as assert,
  rejects,
} from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
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

Deno.test("installed understanding skill has a self-contained reference graph", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "sigil installed understanding ",
  });
  async function copy(source: string, target: string): Promise<void> {
    await Deno.mkdir(target, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      if (entry.isDirectory) {
        await copy(join(source, entry.name), join(target, entry.name));
      } else {await Deno.copyFile(
          join(source, entry.name),
          join(target, entry.name),
        );}
    }
  }
  async function check(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory) {
        await check(path);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      for (
        const { destination } of documentaryLinks(await Deno.readTextFile(path))
      ) {
        if (
          /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
          destination.startsWith("#")
        ) continue;
        assert(
          (await Deno.stat(
            resolve(
              directory,
              decodeURIComponent(destination.split(/[?#]/)[0]),
            ),
          )).isFile,
          `Missing installed reference: ${path}: ${destination}`,
        );
      }
    }
  }
  try {
    await copy(join(root, "integrations/skills/sigil-understand"), directory);
    await check(directory);
    await validateBundledLanguagePack(join(directory, "references/language"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
