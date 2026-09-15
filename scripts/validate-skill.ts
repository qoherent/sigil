import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  documentaryLinks,
  validateBundledLanguagePack,
  validateLanguagePack,
} from "./sync-skill-language.ts";

export const FOUNDATION_SKILLS: Readonly<Record<string, readonly string[]>> = {
  "sigil-understand": [],
  "sigil-evaluate": ["sigil-understand"],
  "sigil-write": ["sigil-understand", "sigil-evaluate"],
};

async function requiredFile(path: string, label: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${label}: ${path}`);
    }
    throw error;
  }
}

async function markdownFiles(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) paths.push(...await markdownFiles(path));
    else if (entry.isFile && entry.name.endsWith(".md")) paths.push(path);
  }
  return paths;
}

/** Validate an installed catalog without source checkout, compiler, subprocesses or network.
 * Supplying repoRoot additionally checks exact reproduction from original specifications.
 */
export async function validateFoundation(
  catalog: string,
  options: { repoRoot?: string } = {},
): Promise<void> {
  catalog = resolve(catalog);
  for (const [name, dependencies] of Object.entries(FOUNDATION_SKILLS)) {
    const directory = join(catalog, name);
    const skill = await requiredFile(
      join(directory, "SKILL.md"),
      "Missing foundation skill",
    );
    const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
      ?.[1];
    assert(frontmatter, `Missing frontmatter: ${name}`);
    assert(
      frontmatter.split(/\r?\n/).includes(`name: ${name}`),
      `Incorrect skill name: ${name}`,
    );
    assert(
      /^description: \S.+$/m.test(frontmatter),
      `Missing description: ${name}`,
    );
    const version =
      (await requiredFile(join(directory, "VERSION"), "Missing skill version"))
        .trim();
    assert(
      /^\d+\.\d+\.\d+$/.test(version),
      `Invalid artifact version: ${name}`,
    );
    const compatibility = JSON.parse(
      await requiredFile(
        join(directory, "compatibility.json"),
        "Missing compatibility metadata",
      ),
    );
    equal(
      Object.keys(compatibility).sort(),
      ["requiredSkills", "sigilVersion"],
      `Unexpected compatibility fields: ${name}`,
    );
    equal(compatibility.sigilVersion, "0.8.0", `Language version: ${name}`);
    equal(
      compatibility.requiredSkills,
      dependencies,
      `Required skills: ${name}`,
    );
    for (const dependency of dependencies) {
      await requiredFile(
        join(catalog, dependency, "SKILL.md"),
        "Missing foundation skill dependency",
      );
    }
    const adapter = await requiredFile(
      join(directory, "agents/openai.yaml"),
      "Missing host adapter",
    );
    for (
      const field of ["display_name", "short_description", "default_prompt"]
    ) {
      assert(
        new RegExp(`^  ${field}: "[^"\\r\\n]+"$`, "m").test(adapter),
        `Missing adapter ${field}: ${name}`,
      );
    }
    const prompt = adapter.match(/^ {2}default_prompt: "(.*)"$/m)?.[1] ?? "";
    assert(prompt.includes(`$${name}`), `Adapter must invoke $${name}`);
    const permitted = new Set([name, ...dependencies]);
    for (const path of await markdownFiles(directory)) {
      for (
        const { destination } of documentaryLinks(await Deno.readTextFile(path))
      ) {
        if (
          /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
          destination.startsWith("#") || destination.startsWith("//")
        ) continue;
        const targetPath = decodeURIComponent(destination.split(/[?#]/)[0])
          .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, "$1");
        if (!targetPath) continue;
        const target = resolve(dirname(path), targetPath);
        const catalogPath = relative(catalog, target);
        const owner = catalogPath.split(/[\\/]/)[0];
        assert(
          !isAbsolute(targetPath) && permitted.has(owner),
          `Reference outside declared foundation dependencies: ${path}: ${destination}`,
        );
        try {
          assert(
            (await Deno.stat(target)).isFile,
            `Missing local reference: ${path}: ${destination}`,
          );
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            throw new Error(`Missing local reference: ${path}: ${destination}`);
          }
          throw error;
        }
      }
    }
  }
  const pack = join(catalog, "sigil-understand/references/language");
  if (options.repoRoot) await validateLanguagePack(options.repoRoot, pack);
  else await validateBundledLanguagePack(pack);
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname!, "..");
  if (Deno.args.length) throw new Error("Usage: deno task test:skill");
  await validateFoundation(join(root, "integrations/skills"), {
    repoRoot: root,
  });
  console.log(
    "Validated three Sigil 0.8 foundation skills: metadata, dependencies, documentary links and reproducible language authority (offline; no compiler or model behavior claim).",
  );
}
