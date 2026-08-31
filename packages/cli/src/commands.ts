import type {
  AgentDependencyContext,
  ComponentContractView,
  OwnedImplementationProjection,
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "@qoherent/sigil-core";
import type { CommandRequest, ContextRequest } from "./args.ts";
import { CoreAdapter } from "./core-adapter.ts";
import {
  installSkills,
  type InstallSkillsOptions,
  listInstalledSkills,
} from "./installer.ts";
import {
  type CommandResult,
  diagnosticCounts,
  workspaceMetadata,
} from "./output-model.ts";
import { renderWorkspaceMarkdown } from "./markdown.ts";

export interface CommandHandlerOptions {
  readonly core?: CoreAdapter;
  readonly install?: InstallSkillsOptions;
}

/**
 * @sigil implements packages/cli/_module.sigil::SigilCli::SkillCatalogCommand interface
 * @sigil implements packages/cli/_module.sigil::SigilCli::SkillCatalog logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::SkillInstallationCommand interface
 * @sigil implements packages/cli/_module.sigil::SigilCli::SkillInstallation logic,constraints,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::GlossaryInspectionCommand interface
 * @sigil implements packages/cli/_module.sigil::SigilCli::GlossaryInspection logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::SourceFormattingCommand interface
 * @sigil implements packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
 */
export async function runCommand(
  request: CommandRequest,
  options: CommandHandlerOptions = {},
): Promise<CommandResult> {
  if (request.command === "skill-list") {
    const result = await listInstalledSkills(options.install?.sourceDirectory);
    return {
      command: "skill-list",
      ...result,
      supportedAgents: ["codex", "claude", "opencode", "pi"],
      diagnostics: [],
    };
  }
  if (request.command === "skill-install") {
    const result = await installSkills({
      ...options.install,
      scope: request.project ? "project" : "global",
      agents: request.agents,
    });
    return { command: "skill-install", ...result, diagnostics: [] };
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
  if (request.command === "fmt") {
    const formatted = await core.formatSources(
      request.path,
      request.root,
      request.check,
    );
    return {
      command: "fmt",
      ...workspaceMetadata(formatted.workspace),
      check: request.check,
      files: formatted.files,
      diagnostics: formatted.diagnostics,
    };
  }
  const resolved = await core.resolveWorkspace(
    request.path ?? (request.command === "context" ? request.file : undefined),
    request.root,
  );
  if (request.command === "check") {
    const implementationSourceDiscovery = await core.implementationSourcesFor(
      resolved,
    );
    const ownershipDiagnostics = core.ownershipDiagnosticsFor(
      resolved,
      implementationSourceDiscovery.sources,
    );
    const diagnostics = [
      ...resolved.diagnostics,
      ...implementationSourceDiscovery.diagnostics,
      ...ownershipDiagnostics,
    ];
    return {
      command: "check",
      ...workspaceMetadata(resolved.workspace),
      diagnostics,
      diagnosticCounts: diagnosticCounts(diagnostics),
    };
  }
  if (request.command === "glossary") {
    return {
      command: "glossary",
      ...workspaceMetadata(resolved.workspace),
      glossaryPath: resolved.glossary.glossaryPath ?? null,
      schemaVersion: resolved.glossary.schemaVersion ?? null,
      terms: resolved.glossary.terms,
      contexts: resolved.glossary.contexts,
      resolvedContexts: resolved.glossary.resolvedContexts,
      occurrences: resolved.glossary.occurrences,
      diagnostics: resolved.diagnostics,
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
    return await contextCommand(request, core, resolved);
  }
  if (request.command === "retrieve") {
    const implementationEvidence = request.purpose === "implementation"
      ? await core.implementationEvidenceFor(resolved)
      : null;
    const target = request.component !== undefined
      ? {
        kind: "component" as const,
        componentName: request.component,
        path: resolved.components.find((item) =>
            item.name === request.component
          )?.filePath
          ? workspaceRelative(
            resolved.workspace.root,
            resolved.components.find((item) =>
              item.name === request.component
            )!.filePath,
          )
          : request.path ?? ".",
      }
      : {
        kind: "file" as const,
        path: workspaceRelative(
          resolved.workspace.root,
          core.resolveTarget(request.file!),
        ),
      };
    const result = await core.retrievePurposeContext(
      resolved,
      target,
      request.purpose,
      implementationEvidence,
      { maxEvidenceBytes: request.maxEvidenceBytes },
    );
    return { command: "retrieve", ...result };
  }
  return {
    command: "render",
    ...workspaceMetadata(resolved.workspace),
    markdown: renderWorkspaceMarkdown(resolved, core),
    diagnostics: resolved.diagnostics,
  };
}

function workspaceRelative(root: string, path: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith(`${normalizedRoot}/`)
    ? normalized.slice(normalizedRoot.length + 1)
    : normalized.replace(/^\.\//, "");
}

/*
 * @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::MarkdownOutput logic,constraints
 * @sigil implements packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
 */
async function contextCommand(
  request: ContextRequest,
  core: CoreAdapter,
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
): Promise<CommandResult> {
  const selectedFile = request.file
    ? core.resolveTarget(request.file)
    : undefined;
  const selectedComponents = resolved.components.filter((component) =>
    request.component
      ? component.name === request.component
      : component.filePath === selectedFile ||
        component.expansions.expands.some((expansion) =>
          expansion.filePath === selectedFile
        )
  );
  const allContracts = core.componentContracts(resolved);
  const contracts = selectedComponents.map((component) =>
    contractForComponent(allContracts, component)
  ).filter((item) => item !== undefined);
  const expansions = selectedComponents.map((component) =>
    component.expansions
  );
  const conceptNamespaces = selectedComponents.map((component) =>
    component.conceptNamespace
  );
  const agentDependencyContexts = selectedComponents.map((component) =>
    agentDependencyContextForComponent(resolved, component, allContracts)
  );
  const agentDependentContexts = request.includeDependents
    ? selectedComponents.map((component) =>
      core.agentDependentContextFor(resolved, component.name)
    ).filter((item) => item !== undefined)
    : undefined;

  const implementationSourceDiscovery = await core.implementationSourcesFor(
    resolved,
  );
  const ownedImplementationProjections = selectedComponents.map((component) =>
    core.ownedImplementationTargetsFor(
      resolved,
      implementationSourceDiscovery.sources,
      { componentName: component.name, declarationPath: component.filePath },
    )
  ).filter((item): item is OwnedImplementationProjection =>
    item !== undefined &&
    selectedComponents.some((component) =>
      componentIdentityMatches(item.owningComponent, component)
    )
  );
  const ownershipDiagnostics = ownedImplementationProjections.flatMap(
    (projection) => projection.diagnostics,
  );
  const relatedFilePaths = [
    ...new Set([
      ...agentDependencyContexts.flatMap((context) => context.relatedFilePaths),
      ...(agentDependentContexts?.flatMap((context) =>
        context.relatedFilePaths
      ) ?? []),
    ]),
  ].sort();
  const glossaryContext = core.glossaryContextForFiles(
    resolved.glossary,
    relatedFilePaths,
  );
  return {
    command: "context",
    ...workspaceMetadata(resolved.workspace),
    selectedComponents,
    componentContracts: contracts,
    conceptNamespaces,
    collectedExpansions: expansions,
    agentDependencyContexts,
    ...(agentDependentContexts ? { agentDependentContexts } : {}),
    ownedImplementationProjections,
    relatedFilePaths,
    glossaryContext: glossaryContext.glossaryPath ? glossaryContext : null,
    diagnostics: [
      ...resolved.diagnostics,
      ...implementationSourceDiscovery.diagnostics,
      ...ownershipDiagnostics,
    ],
  };
}

function agentDependencyContextForComponent(
  resolved: ResolvedSigilWorkspace,
  selectedComponent: ResolvedComponent,
  contracts: readonly ComponentContractView[],
): AgentDependencyContext {
  const dependencies: ResolvedComponent[] = [];
  const seen = new Set<string>();
  for (
    const resolvedImport of resolved.imports.filter((item) =>
      item.sourceFile === selectedComponent.filePath
    )
  ) {
    for (const importedName of resolvedImport.names) {
      if (!importedName.componentFile) continue;
      const key = `${importedName.componentFile}\0${importedName.name}`;
      if (seen.has(key)) continue;
      const dependency = resolved.components.find((component) =>
        component.name === importedName.name &&
        component.filePath === importedName.componentFile
      );
      if (!dependency) continue;
      seen.add(key);
      dependencies.push(dependency);
    }
  }

  const dependencyContracts = dependencies.map((dependency) =>
    contractForComponent(contracts, dependency)
  ).filter((item) => item !== undefined);
  const dependencyDecisions = dependencies.flatMap((dependency) =>
    dependency.expansions.expands.flatMap((expansion) =>
      expansion.declaration.sections
        .filter((section) => section.name === "decisions")
        .map((section) => ({
          componentName: dependency.name,
          filePath: expansion.filePath,
          section,
        }))
    )
  );
  const relatedFilePaths = [
    ...new Set([
      selectedComponent.filePath,
      ...selectedComponent.expansions.expands.map((item) => item.filePath),
      ...dependencyContracts.map((contract) => contract.filePath),
      ...dependencyDecisions.map((decision) => decision.filePath),
    ]),
  ].sort();

  return {
    selectedComponent,
    collectedExpansion: selectedComponent.expansions,
    dependencyContracts,
    dependencyDecisions,
    relatedFilePaths,
  };
}

function contractForComponent(
  contracts: readonly ComponentContractView[],
  component: Pick<ResolvedComponent, "name" | "filePath">,
): ComponentContractView | undefined {
  return contracts.find((contract) =>
    componentIdentityMatches(contract, component)
  );
}

function componentIdentityMatches(
  left: Pick<ResolvedComponent, "name" | "filePath">,
  right: Pick<ResolvedComponent, "name" | "filePath">,
): boolean {
  return left.name === right.name && left.filePath === right.filePath;
}
