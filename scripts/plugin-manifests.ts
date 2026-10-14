import { join } from "node:path";
import { FOUNDATION_SKILLS } from "./validate-skill.ts";

export const PLUGIN_NAME = "sigil";

export const VERSIONED_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
  "plugin.json",
  "package.json",
] as const;
export const MARKETPLACES = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  ".cursor-plugin/marketplace.json",
] as const;
/** The skill reference that tells users which installer matches the skills. */
export const INSTALLER_PIN_FILE =
  "skills/sigil-compute-design/references/computed-evaluation.md";
const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

type Json = Record<string, unknown>;

/**
 * Checks every plugin manifest against the CLI release version and the shared
 * skills folder. Returns one message per mismatch, each naming its file.
 */
export async function checkPluginManifests(root: string): Promise<string[]> {
  const errors: string[] = [];
  const read = async (file: string): Promise<Json | undefined> => {
    try {
      const value = JSON.parse(await Deno.readTextFile(join(root, file)));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Json;
      }
      errors.push(`${file}: expected a JSON object`);
    } catch (error) {
      errors.push(
        `${file}: ${
          error instanceof Deno.errors.NotFound
            ? "missing"
            : `cannot be parsed (${(error as Error).message})`
        }`,
      );
    }
    return undefined;
  };

  const cli = await read("packages/cli/deno.json");
  const version = typeof cli?.version === "string" ? cli.version : undefined;
  if (!version) errors.push("packages/cli/deno.json: missing version");

  const manifests = new Map<string, Json>();
  for (const file of VERSIONED_MANIFESTS) {
    const manifest = await read(file);
    if (!manifest) continue;
    manifests.set(file, manifest);
    if (manifest.name !== PLUGIN_NAME) {
      errors.push(
        `${file}: name is ${
          JSON.stringify(manifest.name)
        }, expected "${PLUGIN_NAME}"`,
      );
    }
    if (version && manifest.version !== version) {
      errors.push(
        `${file}: version is ${
          JSON.stringify(manifest.version)
        }, expected ${version} from packages/cli/deno.json`,
      );
    }
  }

  for (const file of MARKETPLACES) {
    const marketplace = await read(file);
    if (!marketplace) continue;
    if (marketplace.name !== PLUGIN_NAME) {
      errors.push(
        `${file}: marketplace name is ${
          JSON.stringify(marketplace.name)
        }, expected "${PLUGIN_NAME}"`,
      );
    }
    const plugins = Array.isArray(marketplace.plugins)
      ? marketplace.plugins as Json[]
      : [];
    if (plugins.length !== 1) {
      errors.push(`${file}: expected exactly one plugin entry`);
    }
    for (const [index, entry] of plugins.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`${file}: plugin entry ${index + 1} is not an object`);
        continue;
      }
      if (entry.name !== PLUGIN_NAME) {
        errors.push(
          `${file}: plugin entry name is ${
            JSON.stringify(entry.name)
          }, expected "${PLUGIN_NAME}"`,
        );
      }
      if (file === ".claude-plugin/marketplace.json" && "version" in entry) {
        errors.push(
          `${file}: plugin entry must not carry a version; .claude-plugin/plugin.json owns it`,
        );
      }
    }
  }

  const codex = manifests.get(".codex-plugin/plugin.json");
  if (codex && codex.skills !== "./skills") {
    errors.push(`.codex-plugin/plugin.json: skills must be "./skills"`);
  }
  const rootPlugin = manifests.get("plugin.json");
  if (rootPlugin && "$schema" in rootPlugin) {
    errors.push(
      "plugin.json: must not declare $schema (it changes how Codex and Copilot read the root manifest)",
    );
  }
  const pkg = manifests.get("package.json");
  if (pkg) {
    if (pkg.private !== true) errors.push("package.json: must be private");
    for (const field of DEPENDENCY_FIELDS) {
      const value = pkg[field];
      if (value && Object.keys(value as Json).length > 0) {
        errors.push(`package.json: must have no ${field}`);
      }
    }
    const piSkills = (pkg.pi as Json | undefined)?.skills;
    if (JSON.stringify(piSkills) !== JSON.stringify(["./skills"])) {
      errors.push(`package.json: pi.skills must be ["./skills"]`);
    }
    if (typeof pkg.main !== "string" || !(await exists(join(root, pkg.main)))) {
      errors.push(`package.json: main does not point at an existing file`);
    }
  }
  for (const lockfile of LOCKFILES) {
    if (await exists(join(root, lockfile))) {
      errors.push(`${lockfile}: plugin installs must not ship a lockfile`);
    }
  }

  if (version) {
    const pin = await Deno.readTextFile(join(root, INSTALLER_PIN_FILE)).catch(
      () => undefined,
    );
    if (pin === undefined) {
      errors.push(`${INSTALLER_PIN_FILE}: missing`);
    } else {
      errors.push(...checkInstallerPin(pin, version));
    }
  }

  const expected = Object.keys(FOUNDATION_SKILLS).sort();
  const actual: string[] = [];
  try {
    for await (const entry of Deno.readDir(join(root, "skills"))) {
      if (entry.isDirectory) actual.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    errors.push("skills: missing");
  }
  actual.sort();
  for (const name of actual.filter((item) => !expected.includes(item))) {
    errors.push(`skills/${name}: unexpected skill folder`);
  }
  for (const name of expected.filter((item) => !actual.includes(item))) {
    errors.push(`skills/${name}: missing skill folder`);
  }
  return errors;
}

/** Every pinned installer URL must name the CLI release; none may float. */
function checkInstallerPin(text: string, version: string): string[] {
  const errors: string[] = [];
  const pins = [
    ...text.matchAll(
      /releases\/download\/cli-v([^/\s]+)\/install\.(?:sh|ps1)/g,
    ),
  ];
  if (pins.length === 0) {
    errors.push(
      `${INSTALLER_PIN_FILE}: has no releases/download/cli-v${version}/install.sh or install.ps1 reference`,
    );
  }
  for (const [reference, pinned] of pins) {
    if (pinned !== version) {
      errors.push(
        `${INSTALLER_PIN_FILE}: ${reference} names cli-v${pinned}, expected cli-v${version} from packages/cli/deno.json`,
      );
    }
  }
  if (text.includes("releases/latest/download")) {
    errors.push(
      `${INSTALLER_PIN_FILE}: must pin the installer to cli-v${version}, not releases/latest/download`,
    );
  }
  return errors;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

if (import.meta.main) {
  const root = join(import.meta.dirname!, "..");
  const errors = await checkPluginManifests(root);
  for (const error of errors) console.error(error);
  if (errors.length > 0) Deno.exit(1);
}
