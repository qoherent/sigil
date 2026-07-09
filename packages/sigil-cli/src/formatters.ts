import type { CommandRequest } from "./args.ts";
import type { CommandResult } from "./output-model.ts";

export function formatResult(
  result: CommandResult,
  request: CommandRequest,
): string {
  if (request.quiet) return "";
  if (
    result.command === "render" &&
    (request.format === undefined || request.format === "markdown")
  ) {
    return result.markdown;
  }
  if (request.format === "text" && result.command === "check") {
    return formatCheckText(result);
  }
  return `${JSON.stringify(result, null, request.pretty ? 2 : 0)}\n`;
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
