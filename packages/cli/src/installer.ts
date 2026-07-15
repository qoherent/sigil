import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALLED_SKILLS_PATH = join(".agents", "skills");
const GITIGNORE_MARKER = "# Managed by sigil install";

export interface InstallSkillsOptions {
  readonly sourceDirectory?: string;
  readonly targetRoot?: string;
}

export interface InstalledSkill {
  readonly name: string;
  readonly source: string;
  readonly link: string;
  readonly status: "created" | "existing";
}

export interface InstallSkillsResult {
  readonly sourceDirectory: string;
  readonly targetDirectory: string;
  readonly skills: readonly InstalledSkill[];
}

export async function installSkills(
  options: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const sourceDirectory = resolve(
    options.sourceDirectory ?? await resolveInstalledSkillsDirectory(),
  );
  const targetRoot = resolve(options.targetRoot ?? Deno.cwd());
  const targetDirectory = join(targetRoot, INSTALLED_SKILLS_PATH);
  const sourceEntries = await skillDirectories(sourceDirectory);
  if (sourceEntries.length === 0) {
    throw new Error(`No skill directories found in ${sourceDirectory}.`);
  }

  const planned = await Promise.all(sourceEntries.map(async (name) => {
    const source = join(sourceDirectory, name);
    const link = join(targetDirectory, name);
    const status = await existingLinkStatus(link, source);
    return { name, source, link, status };
  }));

  await Deno.mkdir(targetDirectory, { recursive: true });
  const skills: InstalledSkill[] = [];
  for (const item of planned) {
    if (item.status === "created") {
      const linkTarget = relative(dirname(item.link), item.source);
      await Deno.symlink(linkTarget, item.link, { type: "dir" });
    }
    skills.push(item);
  }

  await updateGitignore(
    join(targetDirectory, ".gitignore"),
    skills.map((skill) => `/${skill.name}`),
  );
  return { sourceDirectory, targetDirectory, skills };
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

async function skillDirectories(sourceDirectory: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(sourceDirectory)) {
    if (!entry.name.startsWith(".") && entry.isDirectory) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

async function existingLinkStatus(
  link: string,
  source: string,
): Promise<"created" | "existing"> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(link);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "created";
    throw error;
  }
  if (!info.isSymlink) {
    throw new Error(`Refusing to replace existing path ${link}.`);
  }
  const currentTarget = resolve(dirname(link), await Deno.readLink(link));
  if (!samePath(currentTarget, source)) {
    throw new Error(
      `Refusing to replace symlink ${link}; it targets ${currentTarget}.`,
    );
  }
  return "existing";
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
