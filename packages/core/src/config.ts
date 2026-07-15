import { diagnostic } from "./diagnostics.ts";
import {
  SIGIL_CONFIG_PATH,
  SIGIL_VERSION,
  type SigilConfig,
  type SigilConfigParseResult,
  type SigilDiagnostic,
} from "./model.ts";

export const DEFAULT_SIGIL_INCLUDES = ["**/*.sigil"] as const;
export const DEFAULT_SIGIL_EXCLUDES = [
  ".git/**",
  ".deno/**",
  "node_modules/**",
  "build/**",
  "coverage/**",
] as const;

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSigilConfig(
  source: string,
  filePath: string = SIGIL_CONFIG_PATH,
): SigilConfigParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_CONFIG_PARSE",
        `Unable to parse ${SIGIL_CONFIG_PATH} JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { filePath },
      )],
    };
  }

  const messages: string[] = [];
  if (!isObject(value)) {
    messages.push("Configuration must be a JSON object.");
  } else {
    rejectUnknown(
      value,
      ["sigilVersion", "workspace", "files", "tools"],
      "configuration",
      messages,
    );
    requireSemver(value.sigilVersion, "sigilVersion", messages);
    validateWorkspace(value.workspace, messages);
    validateFiles(value.files, messages);
    validateTools(value.tools, messages);
  }

  if (messages.length > 0) {
    return { diagnostics: invalidDiagnostics(messages, filePath) };
  }

  const raw = value as Record<string, unknown>;
  if (raw.sigilVersion !== SIGIL_VERSION) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_UNSUPPORTED_VERSION",
        `Unsupported sigilVersion ${
          JSON.stringify(raw.sigilVersion)
        }; supported version is ${SIGIL_VERSION}.`,
        { filePath },
      )],
    };
  }

  const workspace = raw.workspace as Record<string, unknown>;
  const files = raw.files as Record<string, unknown>;
  return {
    config: {
      sigilVersion: raw.sigilVersion as string,
      workspace: {
        name: workspace.name as string,
        members: (workspace.members as string[] | undefined) ?? [],
      },
      files: {
        include: files.include as string[],
        exclude: (files.exclude as string[] | undefined) ??
          [...DEFAULT_SIGIL_EXCLUDES],
      },
      tools: (raw.tools as SigilConfig["tools"] | undefined) ?? {},
    },
    diagnostics: [],
  };
}

export function matchesSigilFile(path: string, config: SigilConfig): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return config.files.include.some((pattern) =>
    globMatches(pattern, normalized)
  ) &&
    !config.files.exclude.some((pattern) => globMatches(pattern, normalized));
}

export function excludesSigilSubtree(
  path: string,
  config: SigilConfig,
): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(
    /\/$/,
    "",
  );
  const probe = `${normalized}/__sigil_subtree__`;
  return config.files.exclude.some((pattern) => globMatches(pattern, probe));
}

export function globMatches(pattern: string, path: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "^";
  for (let index = 0; index < normalizedPattern.length; index++) {
    const char = normalizedPattern[index];
    if (char === "*" && normalizedPattern[index + 1] === "*") {
      index++;
      if (normalizedPattern[index + 1] === "/") {
        index++;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`).test(path);
}

function validateWorkspace(value: unknown, messages: string[]): void {
  if (!isObject(value)) {
    messages.push("workspace must be an object.");
    return;
  }
  rejectUnknown(value, ["name", "members"], "workspace", messages);
  if (
    typeof value.name !== "string" || value.name.trim().length === 0 ||
    value.name !== value.name.trim()
  ) {
    messages.push("workspace.name must be a trimmed non-empty string.");
  }
  validateWorkspaceMembers(value.members, messages);
}

function validateWorkspaceMembers(value: unknown, messages: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    messages.push("workspace.members must be an array of strings.");
    return;
  }

  const members = value as string[];
  for (const member of members) {
    if (
      member.length === 0 || member !== member.trim() || member === "." ||
      member.startsWith("/") || /^[A-Za-z]:[\\/]/.test(member) ||
      member.includes("\\") || member.startsWith("./") ||
      member.endsWith("/") || member.includes("//") ||
      member.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      messages.push(
        "workspace.members entries must be normalized, non-root, workspace-relative POSIX directory paths.",
      );
      break;
    }
  }

  if (new Set(members).size !== members.length) {
    messages.push("workspace.members entries must be unique.");
  }
  const sorted = [...new Set(members)].sort();
  for (let index = 0; index < sorted.length; index++) {
    for (let other = index + 1; other < sorted.length; other++) {
      if (sorted[other].startsWith(`${sorted[index]}/`)) {
        messages.push("workspace.members entries must not overlap.");
        return;
      }
    }
  }
}

function validateFiles(value: unknown, messages: string[]): void {
  if (!isObject(value)) {
    messages.push("files must be an object.");
    return;
  }
  rejectUnknown(value, ["include", "exclude"], "files", messages);
  validateStringArray(value.include, "files.include", messages, true);
  if (value.exclude !== undefined) {
    validateStringArray(value.exclude, "files.exclude", messages, false);
  }
}

function validateTools(value: unknown, messages: string[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    messages.push("tools must be an object.");
    return;
  }
  for (const [name, settings] of Object.entries(value)) {
    if (!name || !isObject(settings)) {
      messages.push(`tools.${name || "<empty>"} must be a JSON object.`);
    }
  }
}

function requireSemver(value: unknown, name: string, messages: string[]): void {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    messages.push(`${name} must be a semantic version string.`);
  }
}

function validateStringArray(
  value: unknown,
  name: string,
  messages: string[],
  nonEmpty: boolean,
): void {
  if (
    !Array.isArray(value) || (nonEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    messages.push(
      `${name} must be ${
        nonEmpty ? "a non-empty" : "an"
      } array of non-empty strings.`,
    );
  }
  if (
    Array.isArray(value) && value.some((item) =>
      typeof item === "string" &&
      (item.startsWith("/") || /^[A-Za-z]:[\\/]/.test(item) ||
        item.includes("\\") ||
        item.split("/").includes(".."))
    )
  ) {
    messages.push(`${name} patterns must be workspace-relative POSIX globs.`);
  }
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  owner: string,
  messages: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      messages.push(`${owner} contains unknown key ${JSON.stringify(key)}.`);
    }
  }
}

function invalidDiagnostics(
  messages: readonly string[],
  filePath: string,
): SigilDiagnostic[] {
  return messages.map((message) =>
    diagnostic("SIGIL_CONFIG_INVALID", message, { filePath })
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
