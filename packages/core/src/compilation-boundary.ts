import { dirname, isModuleFile, normalizePath, relativePath } from "./path.ts";
import { diagnostic } from "./diagnostics.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "./model/resolution.ts";

/**
 * A selector identifies where work happened. It is evidence of the affected
 * scope, not automatically the boundary that should be compiled.
 */
export type CompilationScopeSeed =
  | { readonly kind: "workspace" }
  | {
    readonly kind: "component";
    readonly componentName: string;
    readonly declarationPath?: string;
  }
  | { readonly kind: "file"; readonly filePath: string }
  | {
    readonly kind: "location";
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
  }
  | { readonly kind: "directory"; readonly directoryPath: string };

export type ResolvedCompilationTarget =
  | { readonly kind: "workspace" }
  | { readonly kind: "file"; readonly filePath: string }
  | {
    readonly kind: "component";
    readonly name: string;
    readonly declarationPath: string;
  };

export type CompilationBoundaryStrategy =
  | "exact-target"
  | "nearest-covering-module-index"
  | "covering-component"
  | "workspace-fallback";

export type CompilationBoundaryTieBreak =
  | "distance-vector"
  | "module-index-path"
  | "source-path"
  | "component-name";

export interface CompilationBoundarySelection {
  readonly strategy: CompilationBoundaryStrategy;
  readonly affectedSemanticUnits: readonly string[];
  readonly coveredSemanticUnits: readonly string[];
  readonly uncoveredSemanticUnits: readonly string[];
  readonly tieBreak?: CompilationBoundaryTieBreak;
  readonly reason?: string;
}

export interface CompilationBoundaryResult {
  readonly requestedScope: CompilationScopeSeed;
  readonly resolvedTarget: ResolvedCompilationTarget;
  readonly selection: CompilationBoundarySelection;
  /**
   * An invalid or unresolvable seed reports an error here. A caller must
   * refuse the run rather than compiling the workspace by accident.
   */
  readonly diagnostics: readonly SigilDiagnostic[];
}

export interface CompilationBoundaryOptions {
  /** Preserve the selector as the final target and skip boundary inference. */
  readonly exactTarget?: boolean;
}

interface AffectedScope {
  readonly components: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
}

interface BoundaryClosure {
  readonly components: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
}

// A set member is the semantic-unit string itself, so nothing has to be
// parsed back out of a delimited key.
const componentUnit = (name: string, declarationPath: string) =>
  `component:${name}@${declarationPath}`;

const fileUnit = (filePath: string) => `file:${filePath}`;

/*
 * @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::BoundarySelection interface,logic,constraints,cases
 * @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::WorkspaceFallback logic,cases
 */
export function selectCompilationBoundary(
  resolved: ResolvedSigilWorkspace,
  seed: CompilationScopeSeed,
  options: CompilationBoundaryOptions = {},
): CompilationBoundaryResult {
  if (seed.kind === "workspace") {
    return {
      requestedScope: seed,
      resolvedTarget: { kind: "workspace" },
      selection: {
        strategy: "exact-target",
        affectedSemanticUnits: [],
        coveredSemanticUnits: [],
        uncoveredSemanticUnits: [],
        reason: "The workspace selector is already the widest boundary.",
      },
      diagnostics: [],
    };
  }

  const invalid = seedDiagnostics(resolved, seed);
  if (invalid.length > 0) {
    return workspaceFallback(
      seed,
      [],
      "The selector could not be resolved against the loaded workspace.",
      invalid,
    );
  }

  const scope = affectedScopeFor(resolved, seed);
  const affectedUnits = semanticUnits(scope);

  if (options.exactTarget && seed.kind === "directory") {
    return workspaceFallback(
      seed,
      affectedUnits,
      "A directory cannot be an exact compilation target.",
      [
        diagnostic(
          "SIGIL_BOUNDARY_EXACT_TARGET_UNSUPPORTED",
          `An exact target cannot be a directory. Compile ${
            normalizePath(seed.directoryPath).replace(/\/+$/, "")
          } without an exact target, or name a component or file within it.`,
          { filePath: seed.directoryPath },
        ),
      ],
    );
  }

  if (options.exactTarget) {
    return {
      requestedScope: seed,
      resolvedTarget: exactTargetFor(resolved, seed),
      selection: {
        strategy: "exact-target",
        affectedSemanticUnits: affectedUnits,
        coveredSemanticUnits: affectedUnits,
        uncoveredSemanticUnits: [],
        reason:
          "An exact target was requested, so boundary inference was skipped.",
      },
      diagnostics: [],
    };
  }

  if (scope.components.size === 0 && scope.files.size === 0) {
    return workspaceFallback(
      seed,
      affectedUnits,
      "The selector resolved no loaded semantic units.",
    );
  }

  // A module index is the intentional boundary summary for its directory, so
  // it outranks any covering component.
  for (
    const [strategy, moduleIndex] of [
      ["nearest-covering-module-index", true],
      ["covering-component", false],
    ] as const
  ) {
    const candidates = resolved.components.filter((candidate) =>
      isModuleFile(candidate.filePath) === moduleIndex &&
      covers(closureFor(resolved, candidate, moduleIndex), scope)
    );
    if (candidates.length === 0) continue;
    const best = rankByProximity(resolved, candidates, scope);
    const path = workspacePath(resolved, best.candidate.filePath);
    return {
      requestedScope: seed,
      resolvedTarget: moduleIndex ? { kind: "file", filePath: path } : {
        kind: "component",
        name: best.candidate.name,
        declarationPath: path,
      },
      selection: {
        strategy,
        affectedSemanticUnits: affectedUnits,
        coveredSemanticUnits: affectedUnits,
        uncoveredSemanticUnits: [],
        tieBreak: best.tieBreak,
      },
      diagnostics: [],
    };
  }

  return workspaceFallback(
    seed,
    affectedUnits,
    "No module index or component closure covers the complete affected scope.",
  );
}

function workspaceFallback(
  seed: CompilationScopeSeed,
  affectedUnits: readonly string[],
  reason: string,
  diagnostics: readonly SigilDiagnostic[] = [],
): CompilationBoundaryResult {
  return {
    requestedScope: seed,
    resolvedTarget: { kind: "workspace" },
    selection: {
      strategy: "workspace-fallback",
      affectedSemanticUnits: affectedUnits,
      coveredSemanticUnits: affectedUnits,
      uncoveredSemanticUnits: [],
      reason,
    },
    diagnostics,
  };
}

// @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::AffectedScope interface,logic,constraints,cases
function affectedScopeFor(
  resolved: ResolvedSigilWorkspace,
  seed: CompilationScopeSeed,
): AffectedScope {
  const components = new Set<string>();
  const files = new Set<string>();

  const addComponent = (component: ResolvedComponent) => {
    const declarationPath = workspacePath(resolved, component.filePath);
    components.add(componentUnit(component.name, declarationPath));
    files.add(fileUnit(declarationPath));
    for (const expansion of component.expansions.expands) {
      files.add(fileUnit(workspacePath(resolved, expansion.filePath)));
    }
  };

  const addOwnersOfFile = (filePath: string) => {
    files.add(fileUnit(filePath));
    for (const component of resolved.components) {
      const ownsDeclaration =
        workspacePath(resolved, component.filePath) === filePath;
      const ownsExpansion = component.expansions.expands.some((expansion) =>
        workspacePath(resolved, expansion.filePath) === filePath
      );
      if (ownsDeclaration || ownsExpansion) addComponent(component);
    }
  };

  if (seed.kind === "component") {
    const declarationPath = seed.declarationPath
      ? normalizePath(seed.declarationPath)
      : undefined;
    for (const component of resolved.components) {
      if (component.name !== seed.componentName) continue;
      if (
        declarationPath !== undefined &&
        workspacePath(resolved, component.filePath) !== declarationPath
      ) continue;
      addComponent(component);
    }
  } else if (seed.kind === "file") {
    addOwnersOfFile(normalizePath(seed.filePath));
  } else if (seed.kind === "location") {
    const filePath = normalizePath(seed.filePath);
    const enclosing = enclosingComponent(
      resolved,
      filePath,
      seed.line,
      seed.column,
    );
    if (enclosing) addComponent(enclosing);
    else addOwnersOfFile(filePath);
  } else if (seed.kind === "directory") {
    const directory = normalizePath(seed.directoryPath).replace(/\/+$/, "");
    // Every loaded file under the directory participates, including an
    // expand-only or declarationless file that owns no component of its own.
    for (const file of resolved.workspace.files) {
      const filePath = workspacePath(resolved, file.path);
      if (!withinDirectory(filePath, directory)) continue;
      addOwnersOfFile(filePath);
    }
  }

  return { components, files };
}

function enclosingComponent(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
  line: number,
  column: number,
): ResolvedComponent | undefined {
  let best: ResolvedComponent | undefined;
  let bestStart = -1;
  for (const component of resolved.components) {
    const ranges: ResolvedComponent["declaration"]["range"][] = [];
    if (workspacePath(resolved, component.filePath) === filePath) {
      ranges.push(component.declaration.range);
    }
    for (const expansion of component.expansions.expands) {
      if (workspacePath(resolved, expansion.filePath) !== filePath) continue;
      ranges.push(expansion.declaration.range);
    }
    for (const range of ranges) {
      if (!containsPosition(range, line, column)) continue;
      // Prefer the innermost enclosing form when ranges nest.
      if (range.start.line > bestStart) {
        bestStart = range.start.line;
        best = component;
      }
    }
  }
  return best;
}

// @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::BoundaryClosure interface,logic,constraints
function closureFor(
  resolved: ResolvedSigilWorkspace,
  candidate: ResolvedComponent,
  transitive: boolean,
): BoundaryClosure {
  const components = new Set<string>();
  const files = new Set<string>();
  const visited = new Set<string>();
  const queue: ResolvedComponent[] = [candidate];

  const absorb = (component: ResolvedComponent) => {
    const declarationPath = workspacePath(resolved, component.filePath);
    components.add(componentUnit(component.name, declarationPath));
    files.add(fileUnit(declarationPath));
    for (const expansion of component.expansions.expands) {
      files.add(fileUnit(workspacePath(resolved, expansion.filePath)));
    }
  };

  while (queue.length > 0) {
    const current = queue.shift() as ResolvedComponent;
    const key = componentUnit(
      current.name,
      workspacePath(resolved, current.filePath),
    );
    if (visited.has(key)) continue;
    visited.add(key);
    absorb(current);

    if (transitive) {
      // A module index assembles a namespace, so its boundary reaches every
      // component it imports, however deeply nested.
      for (const next of importedComponents(resolved, current)) {
        queue.push(next);
      }
      continue;
    }
    for (const next of importedComponents(resolved, current)) absorb(next);
    for (const next of importers(resolved, current)) absorb(next);
  }
  return { components, files };
}

function importedComponents(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
): ResolvedComponent[] {
  const ownedFiles = new Set<string>([
    workspacePath(resolved, component.filePath),
    ...component.expansions.expands.map((expansion) =>
      workspacePath(resolved, expansion.filePath)
    ),
  ]);
  const results: ResolvedComponent[] = [];
  for (const edge of resolved.graph.importedComponentEdges) {
    if (!ownedFiles.has(workspacePath(resolved, edge.sourceFile))) continue;
    if (
      edge.sourceComponents.length > 0 &&
      !edge.sourceComponents.some((identity) =>
        identity.componentName === component.name &&
        workspacePath(resolved, identity.declarationPath) ===
          workspacePath(resolved, component.filePath)
      )
    ) continue;
    for (const target of resolved.components) {
      if (
        target.name === edge.componentName &&
        workspacePath(resolved, target.filePath) ===
          workspacePath(resolved, edge.targetFile)
      ) results.push(target);
    }
  }
  return results;
}

function importers(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
): ResolvedComponent[] {
  const declarationPath = workspacePath(resolved, component.filePath);
  const results: ResolvedComponent[] = [];
  for (const edge of resolved.graph.importedComponentEdges) {
    if (edge.componentName !== component.name) continue;
    if (workspacePath(resolved, edge.targetFile) !== declarationPath) continue;
    for (const identity of edge.sourceComponents) {
      for (const source of resolved.components) {
        if (
          source.name === identity.componentName &&
          workspacePath(resolved, source.filePath) ===
            workspacePath(resolved, identity.declarationPath)
        ) results.push(source);
      }
    }
  }
  return results;
}

function covers(closure: BoundaryClosure, scope: AffectedScope): boolean {
  for (const component of scope.components) {
    if (!closure.components.has(component)) return false;
  }
  for (const file of scope.files) {
    if (!closure.files.has(file)) return false;
  }
  return true;
}

/**
 * Rank by how close a candidate sits to the affected sources. Each candidate
 * yields the segment distance to every affected directory, sorted
 * greatest-to-least; the lexicographically smallest vector wins.
 */
// @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::ProximityRanking interface,logic,constraints,cases
function rankByProximity(
  resolved: ResolvedSigilWorkspace,
  candidates: readonly ResolvedComponent[],
  scope: AffectedScope,
): {
  readonly candidate: ResolvedComponent;
  readonly tieBreak?: CompilationBoundaryTieBreak;
} {
  const affectedDirectories = [
    ...new Set(
      [...scope.files].map((unit) => dirname(unit.slice("file:".length))),
    ),
  ].sort();
  const scored = candidates.map((candidate) => {
    const path = workspacePath(resolved, candidate.filePath);
    return {
      candidate,
      path,
      vector: distanceVector(affectedDirectories, dirname(path)),
    };
  });

  scored.sort((left, right) =>
    compareVectors(left.vector, right.vector) ||
    left.path.localeCompare(right.path) ||
    left.candidate.name.localeCompare(right.candidate.name)
  );

  // Report the rule that actually separated the winner from its closest rival,
  // not the last comparison the sort happened to perform.
  const winner = scored[0];
  const runnerUp = scored[1];
  return {
    candidate: winner.candidate,
    tieBreak: runnerUp === undefined ? undefined : decidingRule(
      compareVectors(winner.vector, runnerUp.vector) !== 0,
      winner.path !== runnerUp.path,
      winner.path,
    ),
  };
}

function distanceVector(
  affectedDirectories: readonly string[],
  candidateDirectory: string,
): number[] {
  return affectedDirectories
    .map((directory) => segmentDistance(directory, candidateDirectory))
    .sort((left, right) => right - left);
}

function segmentDistance(left: string, right: string): number {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  let shared = 0;
  while (
    shared < leftSegments.length &&
    shared < rightSegments.length &&
    leftSegments[shared] === rightSegments[shared]
  ) shared++;
  return (leftSegments.length - shared) + (rightSegments.length - shared);
}

function pathSegments(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "." || normalized === "") return [];
  return normalized.split("/").filter((segment) =>
    segment.length > 0 && segment !== "."
  );
}

function compareVectors(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftValue = left[index] ?? -1;
    const rightValue = right[index] ?? -1;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function exactTargetFor(
  resolved: ResolvedSigilWorkspace,
  seed: CompilationScopeSeed,
): ResolvedCompilationTarget {
  if (seed.kind === "component") {
    const declared = seed.declarationPath
      ? normalizePath(seed.declarationPath)
      : resolved.components.find((component) =>
        component.name === seed.componentName
      )?.filePath;
    return {
      kind: "component",
      name: seed.componentName,
      declarationPath: declared ? workspacePath(resolved, declared) : "",
    };
  }
  if (seed.kind === "file" || seed.kind === "location") {
    return { kind: "file", filePath: normalizePath(seed.filePath) };
  }
  // Directory seeds are rejected before this point.
  return { kind: "workspace" };
}

function semanticUnits(scope: AffectedScope): string[] {
  return [...scope.components, ...scope.files].sort();
}

function withinDirectory(filePath: string, directory: string): boolean {
  if (directory === "" || directory === ".") return true;
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

function workspacePath(
  resolved: ResolvedSigilWorkspace,
  path: string,
): string {
  const root = normalizePath(resolved.workspace.root);
  const normalized = normalizePath(path);
  if (root === "." || root === "") return normalized;
  return normalized.startsWith(`${root}/`)
    ? relativePath(root, normalized)
    : normalized;
}

function decidingRule(
  vectorsDiffer: boolean,
  pathsDiffer: boolean,
  winningPath: string,
): CompilationBoundaryTieBreak {
  if (vectorsDiffer) return "distance-vector";
  if (pathsDiffer) {
    return isModuleFile(winningPath) ? "module-index-path" : "source-path";
  }
  return "component-name";
}

// @sigil implements packages/core/src/compilation-boundary.sigil::SigilCompilationBoundary::SeedValidation interface,logic,constraints,cases
function seedDiagnostics(
  resolved: ResolvedSigilWorkspace,
  seed: CompilationScopeSeed,
): SigilDiagnostic[] {
  const invalidPath = (path: string, label: string) =>
    diagnostic(
      "SIGIL_BOUNDARY_SEED_PATH_INVALID",
      `The ${label} selector ${
        JSON.stringify(path)
      } is not a workspace-relative path.`,
      { filePath: path },
    );
  const notFound = (path: string, message: string) =>
    diagnostic("SIGIL_BOUNDARY_SEED_NOT_FOUND", message, { filePath: path });

  if (seed.kind === "component") {
    if (seed.componentName.trim() === "") {
      return [
        diagnostic(
          "SIGIL_BOUNDARY_SEED_PATH_INVALID",
          "The component selector is empty.",
        ),
      ];
    }
    if (
      seed.declarationPath !== undefined &&
      !isWorkspaceRelative(seed.declarationPath)
    ) return [invalidPath(seed.declarationPath, "component")];
    const matches = resolved.components.filter((component) =>
      component.name === seed.componentName &&
      (seed.declarationPath === undefined ||
        workspacePath(resolved, component.filePath) ===
          normalizePath(seed.declarationPath))
    );
    if (matches.length === 0) {
      return [
        notFound(
          seed.declarationPath ?? "",
          `No loaded component is named ${JSON.stringify(seed.componentName)}${
            seed.declarationPath
              ? ` in ${normalizePath(seed.declarationPath)}`
              : ""
          }.`,
        ),
      ];
    }
    return [];
  }

  if (seed.kind === "file" || seed.kind === "location") {
    if (!isWorkspaceRelative(seed.filePath)) {
      return [invalidPath(seed.filePath, seed.kind)];
    }
    const filePath = normalizePath(seed.filePath);
    const loaded = resolved.workspace.files.some((file) =>
      workspacePath(resolved, file.path) === filePath
    );
    if (!loaded) {
      return [
        notFound(
          filePath,
          `${filePath} is not a loaded Sigil source in this workspace.`,
        ),
      ];
    }
    return [];
  }

  if (seed.kind === "directory") {
    if (
      seed.directoryPath.trim() === "" ||
      !isWorkspaceRelative(seed.directoryPath)
    ) return [invalidPath(seed.directoryPath, "directory")];
    const directory = normalizePath(seed.directoryPath).replace(/\/+$/, "");
    const covered = resolved.workspace.files.some((file) =>
      withinDirectory(workspacePath(resolved, file.path), directory)
    );
    if (!covered) {
      return [
        notFound(
          directory,
          `No loaded Sigil source exists beneath ${directory}.`,
        ),
      ];
    }
    return [];
  }

  return [];
}

/** Reject absolute paths and any path that escapes the workspace root. */
function isWorkspaceRelative(path: string): boolean {
  if (path.trim() === "") return false;
  const normalized = normalizePath(path);
  if (normalized.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

function containsPosition(
  range: ResolvedComponent["declaration"]["range"],
  line: number,
  column: number,
): boolean {
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && column < range.start.column) return false;
  if (line === range.end.line && column > range.end.column) return false;
  return true;
}
