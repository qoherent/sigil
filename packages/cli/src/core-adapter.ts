import {
  type AgentDependencyContext,
  agentDependencyContextFor,
  type AgentDependentContext,
  agentDependentContextFor,
  compareScalarText,
  componentContracts,
  type ComponentContractView,
  type ComponentIdentity,
  DEFAULT_SIGIL_EXCLUDES,
  DEFAULT_SIGIL_INCLUDES,
  type DesignInputResult,
  diagnostic,
  discoverSigilWorkspace,
  formatSigilDocument,
  glossaryContextForFiles,
  type GlossaryContextProjection,
  type GlossaryProjection,
  type ImplementationEvidenceInput,
  type ImplementationSection,
  type ImplementationSource,
  isExcludedPath,
  isSupportedImplementationSource,
  joinPath,
  loadDesignInput,
  loadSigilWorkspace,
  normalizePath,
  orderDiagnostics,
  type OwnedImplementationProjection,
  ownedImplementationTargetsFor as coreOwnedImplementationTargetsFor,
  ownershipDiagnosticsFor as coreOwnershipDiagnosticsFor,
  parseSigilDocument,
  type PurposeRetrievalOptions,
  type PurposeRetrievalResult,
  type PurposeRetrievalTarget,
  relativePath,
  type ResolvedSigilWorkspace,
  resolveSigilWorkspace,
  type RetrievalPurpose,
  retrievePurposeContext,
  SIGIL_CONFIG_PATH,
  SIGIL_CORE_VERSION,
  SIGIL_GLOSSARY_PATH,
  SIGIL_VERSION,
  type SigilConfig,
  type SigilDiagnostic,
  type SigilDocument,
  type SigilFileSystem,
  type SigilWorkspace,
  type TagNamespace,
  tagNamespaceFor,
  type WorkspaceDiscoveryResult,
} from "@qoherent/sigil-core";
import { DenoSigilFileSystem } from "./fs-adapter.ts";
import metadata from "../deno.json" with { type: "json" };
export const SIGIL_CLI_VERSION = metadata.version;

interface WritableSigilFileSystem extends SigilFileSystem {
  makeDirectory(path: string): Promise<void>;
  writeTextFile(path: string, source: string): Promise<void>;
  replaceTextFile(path: string, source: string): Promise<void>;
}

export interface CoreAdapterOptions {
  readonly fs?: SigilFileSystem;
  readonly currentDirectory?: string;
}

export interface ParseFileResult {
  readonly discovery: WorkspaceDiscoveryResult;
  readonly document: SigilDocument | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface InitConfigResult {
  readonly root: string;
  readonly configPath: string;
  readonly glossaryPath: string;
  readonly config: SigilConfig | null;
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface VersionInfo {
  readonly cliVersion: string;
  readonly coreVersion: string;
}

export interface FormatSourcesResult {
  readonly workspace: SigilWorkspace;
  readonly files: readonly {
    readonly filePath: string;
    readonly status: "formatted" | "unchanged" | "noncanonical" | "failed";
  }[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

// @sigil implements packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
interface ImplementationSourceDiscoveryResult {
  readonly sources: readonly ImplementationSource[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export class CoreAdapter {
  readonly #fs: SigilFileSystem;
  readonly #currentDirectory: string;

  constructor(options: CoreAdapterOptions = {}) {
    this.#fs = options.fs ?? new DenoSigilFileSystem();
    this.#currentDirectory = normalizePath(
      options.currentDirectory ?? Deno.cwd(),
    );
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
  async parseFile(
    path: string,
    explicitRoot?: string,
  ): Promise<ParseFileResult> {
    const filePath = this.resolveTarget(path);
    const discovery = await discoverSigilWorkspace(this.#fs, {
      startPath: filePath,
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
    if (!discovery.config) {
      return { discovery, document: null, diagnostics: discovery.diagnostics };
    }
    const source = await this.#fs.readSourceFile(filePath);
    const parsed = parseSigilDocument(filePath, source, {
      sigilVersion: discovery.config.sigilVersion,
    });
    return {
      discovery,
      document: parsed.document,
      diagnostics: orderDiagnostics([
        ...discovery.diagnostics,
        ...parsed.diagnostics,
      ]),
    };
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
  async loadWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<SigilWorkspace> {
    return await loadSigilWorkspace(this.#fs, {
      startPath: this.resolveTarget(path ?? this.#currentDirectory),
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::DesignExport interface
  async exportDesign(
    path?: string,
    explicitRoot?: string,
  ): Promise<DesignInputResult> {
    return await loadDesignInput(this.#fs, {
      startPath: this.resolveTarget(path ?? this.#currentDirectory),
      explicitRoot: explicitRoot ? this.resolveTarget(explicitRoot) : undefined,
      currentDirectory: this.#currentDirectory,
    });
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
  async resolveWorkspace(
    path?: string,
    explicitRoot?: string,
  ): Promise<ResolvedSigilWorkspace> {
    return resolveSigilWorkspace(await this.loadWorkspace(path, explicitRoot));
  }

  /*
   * @sigil implements packages/cli/_module.sigil::SigilCli::SourceFormattingCommand interface
   * @sigil implements packages/cli/_module.sigil::SigilCli::SourceFormatting logic,constraints,cases
   */
  async formatSources(
    paths: readonly string[],
    explicitRoot: string | undefined,
    check: boolean,
  ): Promise<FormatSourcesResult> {
    const targets = [
      ...new Set(
        (paths.length ? paths : [this.#currentDirectory]).map((path) =>
          this.resolveTarget(path)
        ),
      ),
    ];
    const workspace = await this.loadWorkspace(targets[0], explicitRoot);
    const selectedPaths = new Set<string>();
    for (const target of targets) {
      const prefix = `${target.replace(/\/$/, "")}/`;
      const matches = workspace.files.filter((file) =>
        target.endsWith(".sigil")
          ? normalizePath(file.path) === target
          : normalizePath(file.path).startsWith(prefix) ||
            target === normalizePath(workspace.root)
      );
      if (matches.length === 0) {
        throw new Error(`No Sigil source matched ${target}.`);
      }
      // An explicit root retains directory selection from its ancestors.
      if (!(explicitRoot && workspace.root.startsWith(prefix))) {
        const discovery = await discoverSigilWorkspace(this.#fs, {
          startPath: target,
          currentDirectory: this.#currentDirectory,
        });
        if (normalizePath(discovery.root) !== normalizePath(workspace.root)) {
          throw new Error(
            `Formatting target ${target} belongs to a different workspace than ${workspace.root}.`,
          );
        }
      }
      for (const file of matches) selectedPaths.add(file.path);
    }
    const selected = workspace.files.filter((file) =>
      selectedPaths.has(file.path)
    );
    const resolved = resolveSigilWorkspace(workspace);
    if (
      resolved.diagnostics.some((item) =>
        item.severity === "error" && item.code !== "SIGIL_LINE_TOO_LONG"
      )
    ) {
      return {
        workspace,
        files: selected.map((file) => ({
          filePath: file.path,
          status: "failed" as const,
        })),
        diagnostics: resolved.diagnostics,
      };
    }

    const prepared = selected.map((file) => ({
      file,
      formatted: formatSigilDocument(
        file.document,
        file.source ?? "",
        resolved,
      ),
    }));
    let diagnostics: readonly SigilDiagnostic[] = orderDiagnostics(
      prepared.flatMap((item) => item.formatted.diagnostics),
    );
    if (
      prepared.every((item) => item.formatted.formattedSource !== undefined)
    ) {
      const replacements = new Map(
        prepared.filter((item) => item.formatted.changed).map((item) => {
          const source = item.formatted.formattedSource!;
          return [item.file.path, {
            path: item.file.path,
            source,
            document: parseSigilDocument(item.file.path, source, {
              sigilVersion: workspace.config!.sigilVersion,
            }).document,
          }];
        }),
      );
      const files = workspace.files.map((file) =>
        replacements.get(file.path) ?? file
      );
      diagnostics = resolveSigilWorkspace({
        ...workspace,
        files,
        diagnostics: [
          ...workspace.diagnostics.filter((d) =>
            !d.filePath || !replacements.has(d.filePath)
          ),
          ...[...replacements.values()].flatMap((file) =>
            file.document.diagnostics
          ),
        ],
      }).diagnostics;
    }
    if (
      diagnostics.some((item) => item.severity === "error") ||
      prepared.some((item) => item.formatted.formattedSource === undefined)
    ) {
      return {
        workspace,
        files: prepared.map(({ file }) => ({
          filePath: file.path,
          status: "failed" as const,
        })),
        diagnostics,
      };
    }
    if (!check) {
      const writable = this.#fs as Partial<WritableSigilFileSystem>;
      if (!writable.replaceTextFile) {
        throw new Error("Filesystem does not support replacing Sigil source.");
      }
      for (const item of prepared) {
        if (!item.formatted.changed) continue;
        await writable.replaceTextFile(
          item.file.path,
          item.formatted.formattedSource!,
        );
      }
    }
    return {
      workspace,
      files: prepared.map(({ file, formatted }) => ({
        filePath: file.path,
        status: formatted.changed
          ? check ? "noncanonical" as const : "formatted" as const
          : "unchanged" as const,
      })),
      diagnostics,
    };
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInitialization interface,logic,cases
  async initConfig(
    path: string | undefined,
    name: string | undefined,
    include: readonly string[],
    exclude: readonly string[],
  ): Promise<InitConfigResult> {
    const root = this.resolveTarget(path ?? this.#currentDirectory);
    const configPath = joinPath(root, SIGIL_CONFIG_PATH);
    const glossaryPath = joinPath(root, SIGIL_GLOSSARY_PATH);
    if (await this.#fs.exists(configPath)) {
      return {
        root,
        configPath,
        glossaryPath,
        config: null,
        diagnostics: [
          diagnostic(
            "SIGIL_CONFIG_EXISTS",
            `Refusing to overwrite existing ${configPath}.`,
            { filePath: configPath },
          ),
        ],
      };
    }
    const config = {
      sigilVersion: SIGIL_VERSION,
      workspace: {
        name: name?.trim() || basename(root),
        members: [],
      },
      files: {
        include: include.length ? [...include] : [...DEFAULT_SIGIL_INCLUDES],
        exclude: exclude.length ? [...exclude] : [...DEFAULT_SIGIL_EXCLUDES],
      },
      tools: {},
    };
    const writable = this.#fs as Partial<WritableSigilFileSystem>;
    if (!writable.makeDirectory || !writable.writeTextFile) {
      throw new Error(
        `Filesystem does not support writing ${SIGIL_CONFIG_PATH}.`,
      );
    }
    await writable.makeDirectory(joinPath(root, ".sigil"));
    await writable.writeTextFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    if (!(await this.#fs.exists(glossaryPath))) {
      await writable.writeTextFile(
        glossaryPath,
        `${JSON.stringify(seedGlossary(), null, 2)}\n`,
      );
    }
    return { root, configPath, glossaryPath, config, diagnostics: [] };
  }

  // @sigil implements packages/cli/_module.sigil::SigilCli::WorkspaceInspection interface,logic,cases
  versions(): VersionInfo {
    return {
      cliVersion: SIGIL_CLI_VERSION,
      coreVersion: SIGIL_CORE_VERSION,
    };
  }

  // @sigil uses packages/core/src/projections.sigil::SigilProjections::ContractProjection interface,logic,cases
  componentContracts(
    resolved: ResolvedSigilWorkspace,
  ): readonly ComponentContractView[] {
    return componentContracts(resolved);
  }
  // @sigil uses packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface,cases
  ownedImplementationTargetsFor(
    resolved: ResolvedSigilWorkspace,
    implementationSources: readonly ImplementationSource[],
    componentIdentity: ComponentIdentity,
    tagName?: string,
    sectionName?: ImplementationSection,
  ): OwnedImplementationProjection | undefined {
    return coreOwnedImplementationTargetsFor(
      resolved,
      implementationSources,
      componentIdentity,
      tagName,
      sectionName,
    );
  }
  // @sigil implements packages/cli/_module.sigil::SigilCli::CliOwnershipDiagnostics interface,logic,cases
  ownershipDiagnosticsFor(
    resolved: ResolvedSigilWorkspace,
    implementationSources: readonly ImplementationSource[],
  ): readonly SigilDiagnostic[] {
    return coreOwnershipDiagnosticsFor(resolved, implementationSources);
  }
  // @sigil implements packages/cli/_module.sigil::SigilCli::OwnershipContext interface,logic,constraints,cases
  async implementationSourcesFor(
    resolved: ResolvedSigilWorkspace,
  ): Promise<ImplementationSourceDiscoveryResult> {
    let paths: readonly string[];
    try {
      // Apply the workspace exclusion rules to implementation sources too.
      paths = (await this.#fs.listFiles(resolved.workspace.root))
        .filter(isSupportedImplementationSource)
        .filter((path) =>
          !isExcludedPath(
            relativePath(resolved.workspace.root, path),
            resolved.workspace.config!,
          )
        );
    } catch (error) {
      return {
        sources: [],
        diagnostics: [
          diagnostic(
            "SIGIL_IMPLEMENTATION_SOURCE_DISCOVERY",
            `Unable to enumerate implementation sources under ${resolved.workspace.root}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            {
              severity: "warning",
              filePath: resolved.workspace.root,
            },
          ),
        ],
      };
    }
    const sources: ImplementationSource[] = [];
    for (const filePath of paths) {
      try {
        sources.push({
          filePath,
          text: await this.#fs.readTextFile(filePath),
        });
      } catch {
        // A file can disappear or become unreadable after workspace listing.
      }
    }
    return { sources, diagnostics: [] };
  }
  async implementationEvidenceFor(
    resolved: ResolvedSigilWorkspace,
  ): Promise<ImplementationEvidenceInput> {
    const discovery = await this.implementationSourcesFor(resolved);
    return {
      workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
      discoveryState: discovery.diagnostics.length ? "unavailable" : "complete",
      sources: discovery.sources.map((source) => ({
        ...source,
        filePath: relativePath(resolved.workspace.root, source.filePath),
      })).sort((a, b) => compareScalarText(a.filePath, b.filePath)),
      diagnostics: discovery.diagnostics,
    };
  }
  // @sigil implements packages/cli/_module.sigil::SigilCli::PurposeContextRetrieval interface,logic
  retrievePurposeContext(
    resolved: ResolvedSigilWorkspace,
    target: PurposeRetrievalTarget,
    purpose: RetrievalPurpose,
    implementationEvidence: ImplementationEvidenceInput | null,
    options?: PurposeRetrievalOptions,
  ): Promise<PurposeRetrievalResult> {
    return retrievePurposeContext(
      resolved,
      target,
      purpose,
      resolved.glossary,
      implementationEvidence,
      options,
    );
  }
  // @sigil uses packages/core/src/projections.sigil::SigilProjections::AgentDependencyContext interface,logic,constraints,cases
  agentDependencyContextFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): AgentDependencyContext | undefined {
    return agentDependencyContextFor(resolved, componentName);
  }
  agentDependentContextFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): AgentDependentContext | undefined {
    return agentDependentContextFor(resolved, componentName);
  }
  // @sigil uses packages/core/src/projections.sigil::SigilProjections::TagScopeProjection interface,logic,cases
  tagNamespaceFor(
    resolved: ResolvedSigilWorkspace,
    componentName: string,
  ): TagNamespace | undefined {
    return tagNamespaceFor(resolved, componentName);
  }
  /*
   * @sigil implements packages/cli/_module.sigil::SigilCli::GlossaryInspectionCommand interface
   * @sigil implements packages/cli/_module.sigil::SigilCli::CliGlossaryInspection logic,cases
   */
  glossaryContextForFiles(
    projection: GlossaryProjection,
    filePaths: readonly string[],
  ): GlossaryContextProjection {
    return glossaryContextForFiles(projection, filePaths);
  }
  normalizePath(path: string): string {
    return normalizePath(path);
  }
  resolveTarget(path: string): string {
    const normalized = normalizePath(path);
    return isAbsolute(normalized)
      ? normalized
      : joinPath(this.#currentDirectory, normalized);
  }
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "sigil";
}

function seedGlossary(): {
  readonly schemaVersion: 1;
  readonly terms: readonly {
    readonly term: string;
    readonly definition: string;
    readonly agentContext: false;
  }[];
  readonly contexts: readonly [];
} {
  return {
    schemaVersion: 1,
    terms: [
      {
        term: "Decision:",
        definition:
          "Required by the decision record convention; states the selected course or outcome whose rationale is being recorded.",
        agentContext: false,
      },
      {
        term: "Scope:",
        definition:
          "Required by the decision record convention; states the governed boundary and important exclusions.",
        agentContext: false,
      },
      {
        term: "Assumptions:",
        definition:
          "States materially applicable conditions treated as true when making the decision.",
        agentContext: false,
      },
      {
        term: "Trade-offs:",
        definition:
          "States materially applicable benefits, costs, and tensions accepted by the decision.",
        agentContext: false,
      },
      {
        term: "Design issues addressed:",
        definition:
          "States materially applicable problems or pressures the decision resolves.",
        agentContext: false,
      },
      {
        term: "Discarded alternatives:",
        definition:
          "States materially relevant options not selected and why they were rejected.",
        agentContext: false,
      },
      {
        term: "Consequences:",
        definition:
          "States materially applicable effects and obligations created by the decision.",
        agentContext: false,
      },
      {
        term: "Revisit when:",
        definition:
          "States conditions that should trigger reconsideration of the decision.",
        agentContext: false,
      },
    ],
    contexts: [],
  };
}
