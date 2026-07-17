import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS = ["codex", "claude", "opencode", "pi"] as const;
const MANIFEST_NAME = ".sigil-managed.json";
const GITIGNORE_MARKER = "# Managed by sigil skill install";
const LEGACY_GITIGNORE_MARKER = "# Managed by sigil install";

export type SkillAgent = typeof AGENTS[number];
export type SkillInstallScope = "global" | "project";
export type SkillInstallStatus =
  | "installed"
  | "updated"
  | "existing"
  | "copied"
  | "conflicted";

export interface InstallSkillsOptions {
  readonly scope?: SkillInstallScope;
  readonly agents?: readonly SkillAgent[];
  readonly sourceDirectory?: string;
  readonly targetRoot?: string;
  readonly userHome?: string;
  readonly forceCopy?: boolean;
}

export interface InstalledSkill {
  readonly name: string;
  readonly agents: readonly SkillAgent[];
  readonly source: string;
  readonly target: string;
  readonly status: SkillInstallStatus;
}

export interface InstallSkillsResult {
  readonly scope: SkillInstallScope;
  readonly agents: readonly SkillAgent[];
  readonly sourceDirectory: string;
  readonly skills: readonly InstalledSkill[];
}

interface ManagedEntry {
  readonly source: string;
  readonly mode: "link" | "copy";
}

interface ManagedManifest {
  readonly version: 1;
  readonly entries: Record<string, ManagedEntry>;
}

interface Destination {
  readonly directory: string;
  readonly agents: readonly SkillAgent[];
  readonly project: boolean;
  readonly manifest: ManagedManifest;
}

interface PlannedInstall {
  readonly destination: Destination;
  readonly name: string;
  readonly source: string;
  readonly target: string;
  readonly action: "install" | "update" | "existing";
}

export async function listInstalledSkills(
  sourceDirectory?: string,
): Promise<
  { readonly sourceDirectory: string; readonly skills: readonly string[] }
> {
  const source = resolve(
    sourceDirectory ?? await resolveInstalledSkillsDirectory(),
  );
  const skills = await skillDirectories(source);
  if (skills.length === 0) {
    throw new Error(`No valid skill directories found in ${source}.`);
  }
  return { sourceDirectory: source, skills };
}

export async function installSkills(
  options: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const scope = options.scope ?? "global";
  const agents = normalizeAgents(options.agents ?? AGENTS);
  const sourceDirectory = resolve(
    options.sourceDirectory ?? await resolveInstalledSkillsDirectory(),
  );
  const sourceEntries = await skillDirectories(sourceDirectory);
  if (sourceEntries.length === 0) {
    throw new Error(`No valid skill directories found in ${sourceDirectory}.`);
  }
  const base = scope === "global"
    ? resolve(options.userHome ?? homeDirectory())
    : resolve(options.targetRoot ?? Deno.cwd());
  const destinations = await installationDestinations(base, scope, agents);
  const planned: PlannedInstall[] = [];
  for (const destination of destinations) {
    for (const name of sourceEntries) {
      const source = join(sourceDirectory, name);
      const target = join(destination.directory, name);
      planned.push({
        destination,
        name,
        source,
        target,
        action: await plannedAction(destination, name, source, target),
      });
    }
  }

  const results: InstalledSkill[] = [];
  for (const item of planned) {
    await Deno.mkdir(item.destination.directory, { recursive: true });
    if (item.action === "existing") {
      results.push(skillResult(item, "existing"));
      ensureManagedEntry(item, await installedMode(item.target));
      continue;
    }
    if (item.action === "update") {
      await Deno.remove(item.target, { recursive: true });
    }
    let mode: ManagedEntry["mode"] = "link";
    if (options.forceCopy) {
      await copyDirectory(item.source, item.target);
      mode = "copy";
    } else {
      try {
        const linkTarget = relative(dirname(item.target), item.source);
        await Deno.symlink(linkTarget, item.target, { type: "dir" });
      } catch (error) {
        if (!linkFallbackAllowed(error)) throw error;
        await copyDirectory(item.source, item.target);
        mode = "copy";
      }
    }
    ensureManagedEntry(item, mode);
    results.push(skillResult(
      item,
      item.action === "update"
        ? "updated"
        : mode === "copy"
        ? "copied"
        : "installed",
    ));
  }

  for (const destination of destinations) {
    await writeManifest(destination);
    if (destination.project) {
      await updateGitignore(
        join(destination.directory, ".gitignore"),
        [`/${MANIFEST_NAME}`, ...sourceEntries.map((name) => `/${name}`)],
      );
    }
  }
  return { scope, agents, sourceDirectory, skills: results };
}

export async function resolveInstalledSkillsDirectory(
  moduleUrl = import.meta.url,
  executablePath = Deno.execPath(),
): Promise<string> {
  const executableDirectory = dirname(executablePath);
  const moduleDirectory = new URL(moduleUrl).protocol === "file:"
    ? dirname(fileURLToPath(moduleUrl))
    : undefined;
  const candidates = unique([
    resolve(executableDirectory, "../integrations/skills"),
    resolve(executableDirectory, "integrations/skills"),
    ...(moduleDirectory
      ? [
        resolve(moduleDirectory, "../integrations/skills"),
        resolve(moduleDirectory, "../../../integrations/skills"),
      ]
      : []),
  ]);
  for (const candidate of candidates) {
    try {
      if ((await Deno.stat(candidate)).isDirectory) return candidate;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  throw new Error(
    `Unable to locate installed integrations/skills. Checked: ${
      candidates.join(", ")
    }`,
  );
}

async function installationDestinations(
  base: string,
  scope: SkillInstallScope,
  agents: readonly SkillAgent[],
): Promise<Destination[]> {
  const definitions = [
    {
      directory: join(base, ".agents", "skills"),
      agents: agents.filter((agent) => agent !== "claude"),
    },
    {
      directory: join(base, ".claude", "skills"),
      agents: agents.filter((agent) => agent === "claude"),
    },
  ].filter((item) => item.agents.length > 0);
  return await Promise.all(definitions.map(async (item) => ({
    ...item,
    project: scope === "project",
    manifest: await readManifest(join(item.directory, MANIFEST_NAME)),
  })));
}

async function plannedAction(
  destination: Destination,
  name: string,
  source: string,
  target: string,
): Promise<PlannedInstall["action"]> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(target);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "install";
    throw error;
  }
  const managed = destination.manifest.entries[name];
  if (managed) {
    if (
      managed.source === source &&
      await targetMatches(info, target, source, managed.mode)
    ) {
      return "existing";
    }
    return "update";
  }
  if (
    info.isSymlink && samePath(
      resolve(dirname(target), await Deno.readLink(target)),
      source,
    )
  ) return "existing";
  if (info.isSymlink && await isLegacyManaged(destination.directory, name)) {
    return "update";
  }
  throw new Error(`Refusing to replace unmanaged skill path ${target}.`);
}

async function targetMatches(
  info: Deno.FileInfo,
  target: string,
  source: string,
  mode: ManagedEntry["mode"],
): Promise<boolean> {
  if (mode === "copy") return info.isDirectory;
  return info.isSymlink && samePath(
    resolve(dirname(target), await Deno.readLink(target)),
    source,
  );
}

async function isLegacyManaged(
  directory: string,
  name: string,
): Promise<boolean> {
  try {
    const source = await Deno.readTextFile(join(directory, ".gitignore"));
    return (source.includes(GITIGNORE_MARKER) ||
      source.includes(LEGACY_GITIGNORE_MARKER)) &&
      source.split(/\r?\n/).includes(`/${name}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function ensureManagedEntry(
  item: PlannedInstall,
  mode: ManagedEntry["mode"],
): void {
  item.destination.manifest.entries[item.name] = {
    source: item.source,
    mode,
  };
}

async function installedMode(target: string): Promise<ManagedEntry["mode"]> {
  return (await Deno.lstat(target)).isSymlink ? "link" : "copy";
}

async function readManifest(path: string): Promise<ManagedManifest> {
  try {
    const value = JSON.parse(await Deno.readTextFile(path));
    if (
      value?.version === 1 && value.entries && typeof value.entries === "object"
    ) {
      return value as ManagedManifest;
    }
    throw new Error(`Invalid managed skill manifest ${path}.`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { version: 1, entries: {} };
    }
    throw error;
  }
}

async function writeManifest(destination: Destination): Promise<void> {
  await Deno.writeTextFile(
    join(destination.directory, MANIFEST_NAME),
    `${JSON.stringify(destination.manifest, null, 2)}\n`,
  );
}

async function skillDirectories(sourceDirectory: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(sourceDirectory)) {
    if (entry.name.startsWith(".") || !entry.isDirectory || entry.isSymlink) {
      continue;
    }
    try {
      if (
        (await Deno.stat(join(sourceDirectory, entry.name, "SKILL.md"))).isFile
      ) {
        names.push(entry.name);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return names.sort();
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

function linkFallbackAllowed(error: unknown): boolean {
  return error instanceof Deno.errors.PermissionDenied ||
    error instanceof Deno.errors.NotSupported;
}

function normalizeAgents(agents: readonly SkillAgent[]): SkillAgent[] {
  const result = unique(agents);
  if (result.length === 0) {
    throw new Error("At least one skill agent is required.");
  }
  for (const agent of result) {
    if (!AGENTS.includes(agent)) {
      throw new Error(`Unsupported skill agent ${agent}.`);
    }
  }
  return AGENTS.filter((agent) => result.includes(agent));
}

function homeDirectory(): string {
  const value = Deno.env.get(
    Deno.build.os === "windows" ? "USERPROFILE" : "HOME",
  );
  if (!value) throw new Error("Unable to resolve the user home directory.");
  return value;
}

function skillResult(
  item: PlannedInstall,
  status: SkillInstallStatus,
): InstalledSkill {
  return {
    name: item.name,
    agents: item.destination.agents,
    source: item.source,
    target: item.target,
    status,
  };
}

async function updateGitignore(path: string, entries: readonly string[]) {
  let source = "";
  try {
    source = await Deno.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const existing = new Set(source.split(/\r?\n/));
  const missing = entries.filter((entry) => !existing.has(entry));
  if (missing.length === 0) return;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const prefix = source.length === 0
    ? `${GITIGNORE_MARKER}${newline}`
    : source.endsWith("\n")
    ? ""
    : newline;
  await Deno.writeTextFile(
    path,
    `${source}${prefix}${missing.join(newline)}${newline}`,
  );
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return Deno.build.os === "windows"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
