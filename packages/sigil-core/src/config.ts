import { diagnostic } from "./diagnostics.ts";
import {
  SIGIL_CONFIG_VERSION,
  SIGIL_LANGUAGE_VERSION,
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
  filePath = "sigil.config",
): SigilConfigParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_CONFIG_PARSE",
        `Unable to parse sigil.config JSON: ${
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
      ["configVersion", "languageVersion", "project", "files", "tools"],
      "configuration",
      messages,
    );
    requireSemver(value.configVersion, "configVersion", messages);
    requireSemver(value.languageVersion, "languageVersion", messages);
    validateProject(value.project, messages);
    validateFiles(value.files, messages);
    validateTools(value.tools, messages);
  }

  if (messages.length > 0) {
    return { diagnostics: invalidDiagnostics(messages, filePath) };
  }

  const raw = value as Record<string, unknown>;
  if (raw.configVersion !== SIGIL_CONFIG_VERSION) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_UNSUPPORTED_CONFIG_VERSION",
        `Unsupported configVersion ${
          JSON.stringify(raw.configVersion)
        }; supported version is ${SIGIL_CONFIG_VERSION}.`,
        { filePath },
      )],
    };
  }
  if (raw.languageVersion !== SIGIL_LANGUAGE_VERSION) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_UNSUPPORTED_LANGUAGE_VERSION",
        `Unsupported languageVersion ${
          JSON.stringify(raw.languageVersion)
        }; supported version is ${SIGIL_LANGUAGE_VERSION}.`,
        { filePath },
      )],
    };
  }

  const project = raw.project as Record<string, unknown>;
  const files = raw.files as Record<string, unknown>;
  return {
    config: {
      configVersion: raw.configVersion as string,
      languageVersion: raw.languageVersion as string,
      project: { name: project.name as string },
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

function validateProject(value: unknown, messages: string[]): void {
  if (!isObject(value)) {
    messages.push("project must be an object.");
    return;
  }
  rejectUnknown(value, ["name"], "project", messages);
  if (
    typeof value.name !== "string" || value.name.trim().length === 0 ||
    value.name !== value.name.trim()
  ) {
    messages.push("project.name must be a trimmed non-empty string.");
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
