import type { CommandRequest, ContextRequest } from "./args.ts";
import { CoreAdapter } from "./core-adapter.ts";
import { type CommandResult, diagnosticCounts } from "./output-model.ts";

export interface CommandHandlerOptions {
  readonly core?: CoreAdapter;
}

export async function runCommand(
  request: CommandRequest,
  options: CommandHandlerOptions = {},
): Promise<CommandResult> {
  const core = options.core ?? new CoreAdapter();

  if (request.command === "parse") {
    const parsed = await core.parseFile(request.file);
    return {
      command: "parse",
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    };
  }

  if (request.command === "check") {
    const resolved = await core.resolveWorkspace(request.path, request.root);
    return {
      command: "check",
      workspaceRoot: resolved.workspace.root,
      rootInferred: resolved.workspace.rootInferred,
      diagnostics: resolved.diagnostics,
      diagnosticCounts: diagnosticCounts(resolved.diagnostics),
    };
  }

  if (request.command === "graph") {
    const resolved = await core.resolveWorkspace(request.path, request.root);
    return {
      command: "graph",
      workspaceRoot: resolved.workspace.root,
      rootInferred: resolved.workspace.rootInferred,
      graph: resolved.graph,
      diagnostics: resolved.diagnostics,
    };
  }

  if (request.command === "context") {
    return await contextCommand(request, core);
  }

  const resolved = await core.resolveWorkspace(request.path, request.root);
  return {
    command: "render",
    markdown: renderMarkdown(resolved, core),
    diagnostics: resolved.diagnostics,
  };
}

async function contextCommand(
  request: ContextRequest,
  core: CoreAdapter,
): Promise<CommandResult> {
  const resolved = await core.resolveWorkspace(
    request.path ?? request.file,
    request.root,
  );
  const selectedFile = request.file
    ? core.normalizePath(request.file)
    : undefined;
  const selectedComponents = resolved.components.filter((component) => {
    if (request.component) return component.name === request.component;
    if (selectedFile) return component.filePath === selectedFile;
    return false;
  });
  const selectedNames = new Set(
    selectedComponents.map((component) => component.name),
  );
  const contracts = core.componentContracts(resolved)
    .filter((contract) => selectedNames.has(contract.name));
  const expansions = selectedComponents
    .map((component) => core.collectedExpansionFor(resolved, component.name))
    .filter((item) => item !== undefined);
  const relatedFilePaths = [
    ...new Set([
      ...selectedComponents.map((component) => component.filePath),
      ...expansions.flatMap((expansion) =>
        expansion.expands.map((expand) => findExpandFile(resolved, expand.name))
      ),
    ].filter(Boolean)),
  ].sort();

  return {
    command: "context",
    workspaceRoot: resolved.workspace.root,
    rootInferred: resolved.workspace.rootInferred,
    selectedComponents,
    componentContracts: contracts,
    collectedExpansions: expansions,
    relatedFilePaths,
    diagnostics: resolved.diagnostics,
  };
}

function renderMarkdown(
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
  core: CoreAdapter,
): string {
  const lines: string[] = [
    "# Sigil Workspace",
    "",
    `Workspace root: ${resolved.workspace.root}`,
    "",
  ];
  for (const contract of core.componentContracts(resolved)) {
    lines.push(
      `## ${contract.name}`,
      "",
      `Source: ${contract.filePath}`,
      "",
      "### Goal",
    );
    lines.push(...formatList(contract.goalLines));
    lines.push("", "### Interface");
    lines.push(...formatList(contract.interfaceLines));
    const expansion = core.collectedExpansionFor(resolved, contract.name);
    if (expansion && expansion.expands.length > 0) {
      lines.push("", "### Expansions");
      for (const expand of expansion.expands) {
        for (const section of expand.sections) {
          lines.push("", `#### ${section.name}`);
          lines.push(...formatList(section.lines.map((line) => line.text)));
        }
      }
    }
    lines.push("");
  }

  lines.push("## Diagnostics", "");
  if (resolved.diagnostics.length === 0) {
    lines.push("- none");
  } else {
    for (const diagnostic of resolved.diagnostics) {
      lines.push(
        `- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatList(lines: readonly string[]): string[] {
  return lines.length === 0 ? ["- none"] : lines.map((line) => `- ${line}`);
}

function findExpandFile(
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
  name: string,
): string {
  const edge = resolved.graph.componentExpansionEdges.find((item) =>
    item.componentName === name
  );
  return edge?.expandFile ?? "";
}
