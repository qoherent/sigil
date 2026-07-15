import type { CommandRequest, ContextRequest } from "./args.ts";
import { CoreAdapter } from "./core-adapter.ts";
import { installSkills, type InstallSkillsOptions } from "./installer.ts";
import {
  type CommandResult,
  diagnosticCounts,
  workspaceMetadata,
} from "./output-model.ts";

export interface CommandHandlerOptions {
  readonly core?: CoreAdapter;
  readonly install?: InstallSkillsOptions;
}

export async function runCommand(
  request: CommandRequest,
  options: CommandHandlerOptions = {},
): Promise<CommandResult> {
  if (request.command === "install") {
    const result = await installSkills(options.install);
    return { command: "install", ...result, diagnostics: [] };
  }
  const core = options.core ?? new CoreAdapter();
  if (request.command === "init") {
    const result = await core.initConfig(
      request.path,
      request.name,
      request.include,
      request.exclude,
    );
    return {
      command: "init",
      workspaceRoot: result.root,
      configPath: result.configPath,
      sigilVersion: result.config?.sigilVersion ?? null,
      workspaceName: result.config?.workspace.name ?? null,
      config: result.config,
      diagnostics: result.diagnostics,
    };
  }
  if (request.command === "version") {
    const workspace = await core.loadWorkspace(request.path, request.root);
    return {
      command: "version",
      ...core.versions(),
      ...workspaceMetadata(workspace),
      diagnostics: workspace.diagnostics,
    };
  }
  if (request.command === "parse") {
    const parsed = await core.parseFile(request.file, request.root);
    return {
      command: "parse",
      ...workspaceMetadata(parsed.discovery),
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    };
  }
  const resolved = await core.resolveWorkspace(
    request.path ?? (request.command === "context" ? request.file : undefined),
    request.root,
  );
  if (request.command === "check") {
    return {
      command: "check",
      ...workspaceMetadata(resolved.workspace),
      diagnostics: resolved.diagnostics,
      diagnosticCounts: diagnosticCounts(resolved.diagnostics),
    };
  }
  if (request.command === "graph") {
    return {
      command: "graph",
      ...workspaceMetadata(resolved.workspace),
      graph: resolved.graph,
      diagnostics: resolved.diagnostics,
    };
  }
  if (request.command === "context") {
    return contextCommand(request, core, resolved);
  }
  return {
    command: "render",
    ...workspaceMetadata(resolved.workspace),
    markdown: renderMarkdown(resolved, core),
    diagnostics: resolved.diagnostics,
  };
}

function contextCommand(
  request: ContextRequest,
  core: CoreAdapter,
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
): CommandResult {
  const selectedFile = request.file
    ? core.resolveTarget(request.file)
    : undefined;
  const selectedComponents = resolved.components.filter((component) =>
    request.component
      ? component.name === request.component
      : component.filePath === selectedFile
  );
  const selectedNames = new Set(
    selectedComponents.map((component) => component.name),
  );
  const contracts = core.componentContracts(resolved).filter((contract) =>
    selectedNames.has(contract.name)
  );
  const expansions = selectedComponents.map((component) =>
    core.collectedExpansionFor(resolved, component.name)
  ).filter((item) => item !== undefined);
  const relatedFilePaths = [
    ...new Set([
      ...selectedComponents.map((component) => component.filePath),
      ...expansions.flatMap((expansion) =>
        expansion.expands.map((expand) => expand.filePath)
      ),
    ]),
  ].sort();
  return {
    command: "context",
    ...workspaceMetadata(resolved.workspace),
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
  const lines = [
    "# Sigil Workspace",
    "",
    `Workspace root: ${resolved.workspace.root}`,
    `Workspace: ${resolved.workspace.config?.workspace.name ?? "unresolved"}`,
    `Sigil: ${resolved.workspace.config?.sigilVersion ?? "unresolved"}`,
    "",
  ];
  for (const contract of core.componentContracts(resolved)) {
    lines.push(
      `## ${contract.name}`,
      "",
      `Source: ${contract.filePath}`,
      "",
      "### Goal",
      ...formatList(contract.goalLines),
      "",
      "### Interface",
      ...formatList(contract.interfaceLines),
    );
    const expansion = core.collectedExpansionFor(resolved, contract.name);
    if (expansion?.expands.length) {
      lines.push("", "### Expansions");
      for (const item of expansion.expands) {
        lines.push("", `Source: ${item.filePath}`);
        for (const section of item.declaration.sections) {
          lines.push(
            "",
            `#### ${section.name}`,
            ...formatList(section.lines.map((line) => line.text)),
          );
        }
      }
    }
    lines.push("");
  }
  lines.push("## Diagnostics", "");
  if (!resolved.diagnostics.length) lines.push("- none");
  else {for (const item of resolved.diagnostics) {
      lines.push(`- ${item.severity} ${item.code}: ${item.message}`);
    }}
  return `${lines.join("\n")}\n`;
}

function formatList(lines: readonly string[]): string[] {
  return lines.length ? lines.map((line) => `- ${line}`) : ["- none"];
}
