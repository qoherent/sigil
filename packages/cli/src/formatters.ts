import type { CommandRequest } from "./args.ts";
import type { CommandResult } from "./output-model.ts";

export function formatResult(
  result: CommandResult,
  request: CommandRequest,
): string {
  if (request.quiet) return "";
  result = normalizeResultPaths(result, request);
  if (
    result.command === "render" &&
    (request.format === undefined || request.format === "markdown")
  ) {
    return result.markdown;
  }
  if (
    result.command === "version" &&
    (request.format === undefined || request.format === "text")
  ) {
    const lines = [
      `CLI: ${result.cliVersion}`,
      `Core: ${result.coreVersion}`,
      `Supported config: ${result.supportedConfigVersions.join(", ")}`,
      `Supported language: ${result.supportedLanguageVersions.join(", ")}`,
      `Workspace: ${result.workspaceRoot}`,
      `Workspace name: ${result.workspaceName ?? "unresolved"}`,
      `Configured config: ${result.configVersion ?? "unresolved"}`,
      `Configured language: ${result.languageVersion ?? "unresolved"}`,
    ];
    for (const item of result.diagnostics) {
      lines.push(`${item.severity} ${item.code}: ${item.message}`);
    }
    return `${lines.join("\n")}\n`;
  }
  if (request.format === "text" && result.command === "check") {
    return formatCheckText(result);
  }
  return `${JSON.stringify(result, null, request.pretty ? 2 : 0)}\n`;
}

function normalizeResultPaths(
  result: CommandResult,
  request: CommandRequest,
): CommandResult {
  const supplied = request.root ?? controllingPath(request);
  if (supplied && isAbsolute(supplied)) return result;
  const workspaceRoot = "workspaceRoot" in result
    ? result.workspaceRoot
    : undefined;
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) return result;
  const displayRoot = relativeFrom(
    normalizePath(Deno.cwd()),
    normalizePath(workspaceRoot),
  );
  return replaceStrings(result, workspaceRoot, displayRoot) as CommandResult;
}

function controllingPath(request: CommandRequest): string | undefined {
  if (request.command === "parse") return request.file;
  if (request.command === "context") return request.path ?? request.file;
  return "path" in request ? request.path : undefined;
}

function replaceStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    const prefix = to === "." ? "" : `${to}/`;
    return value.replaceAll(`${from}/`, prefix).replaceAll(from, to);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, from, to));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, replaceStrings(item, from, to)]),
    );
  }
  return value;
}

function relativeFrom(root: string, path: string): string {
  if (root === path) return ".";
  const rootParts = root.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  let common = 0;
  while (
    common < rootParts.length && common < pathParts.length &&
    rootParts[common] === pathParts[common]
  ) common++;
  return [
    ...Array(rootParts.length - common).fill(".."),
    ...pathParts.slice(common),
  ].join("/") || ".";
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
}
function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function formatCheckText(
  result: Extract<CommandResult, { command: "check" }>,
): string {
  const counts = result.diagnosticCounts;
  const lines = [
    `Workspace root: ${result.workspaceRoot}`,
    `Diagnostics: ${counts.error} error, ${counts.warning} warning, ${counts.info} info`,
  ];
  for (const diagnostic of result.diagnostics) {
    lines.push(
      `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
