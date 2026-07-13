import { diagnostic } from "./diagnostics.ts";
import type {
  CollectedExpansion,
  ComponentDeclaration,
  ExpandDeclaration,
  ResolvedComponent,
  ResolvedImport,
  ResolvedImportName,
  ResolvedSigilWorkspace,
  SigilDiagnostic,
  SigilGraph,
  SigilWorkspace,
} from "./model.ts";
import { joinPath, normalizePath } from "./path.ts";

interface IndexedComponent {
  readonly filePath: string;
  readonly declaration: ComponentDeclaration;
}

interface IndexedExpand {
  readonly filePath: string;
  readonly declaration: ExpandDeclaration;
}

export function resolveSigilWorkspace(
  workspace: SigilWorkspace,
): ResolvedSigilWorkspace {
  const diagnostics: SigilDiagnostic[] = [...workspace.diagnostics];
  const componentsByName = new Map<string, IndexedComponent[]>();
  const expandsByName = new Map<string, IndexedExpand[]>();
  const documentByPath = new Map(
    workspace.files.map((file) => [normalizePath(file.path), file.document]),
  );

  for (const file of workspace.files) {
    for (const component of file.document.components) {
      const components = componentsByName.get(component.name) ?? [];
      components.push({ filePath: file.path, declaration: component });
      componentsByName.set(component.name, components);
    }
    for (const expand of file.document.expands) {
      const expands = expandsByName.get(expand.name) ?? [];
      expands.push({ filePath: file.path, declaration: expand });
      expandsByName.set(expand.name, expands);
    }
  }

  for (const [name, components] of componentsByName) {
    if (components.length > 1) {
      for (const component of components) {
        diagnostics.push(diagnostic(
          "SIGIL_DUPLICATE_COMPONENT",
          `Duplicate component ${name} creates ambiguous references.`,
          { filePath: component.filePath, range: component.declaration.range },
        ));
      }
    }
  }

  for (const [name, expands] of expandsByName) {
    if (!componentsByName.has(name)) {
      for (const expand of expands) {
        diagnostics.push(diagnostic(
          "SIGIL_EXPAND_WITHOUT_COMPONENT",
          `expand ${name} has no matching component.`,
          { filePath: expand.filePath, range: expand.declaration.range },
        ));
      }
    }
  }

  const resolvedImports: ResolvedImport[] = [];

  for (const file of workspace.files) {
    for (const declaration of file.document.imports) {
      const targetFile = resolveImportPath(workspace.root, declaration.path);
      if (!documentByPath.has(targetFile)) {
        diagnostics.push(diagnostic(
          "SIGIL_UNRESOLVED_IMPORT_PATH",
          `Import path @${declaration.path} resolved to missing file ${targetFile}.`,
          { filePath: file.path, range: declaration.range },
        ));
        resolvedImports.push({
          declaration,
          sourceFile: file.path,
          targetFile,
          names: [],
        });
        continue;
      }

      const targetDocument = documentByPath.get(targetFile)!;
      const names: ResolvedImportName[] = declaration.names.map((name) => {
        const component = targetDocument.components.find((item) =>
          item.name === name
        );
        if (!component) {
          diagnostics.push(diagnostic(
            "SIGIL_UNRESOLVED_IMPORTED_COMPONENT",
            `Imported component ${name} was not found in ${targetFile}.`,
            { filePath: file.path, range: declaration.range },
          ));
          return { name };
        }
        return { name, component };
      });

      resolvedImports.push({
        declaration,
        sourceFile: file.path,
        targetFile,
        names,
      });
    }
  }

  diagnostics.push(...detectImportCycles(resolvedImports));

  const resolvedComponents: ResolvedComponent[] = [];
  for (const [name, components] of componentsByName) {
    for (const component of components) {
      const expands = expandsByName.get(name) ?? [];
      const expansion: CollectedExpansion = {
        componentName: name,
        expands: expands.map((item) => ({
          filePath: item.filePath,
          declaration: item.declaration,
        })),
      };
      resolvedComponents.push({
        name,
        declaration: component.declaration,
        filePath: component.filePath,
        expansions: expansion,
      });
    }
  }

  const graph = buildGraph(resolvedImports, resolvedComponents, expandsByName);

  return {
    workspace,
    imports: resolvedImports,
    components: resolvedComponents,
    graph,
    diagnostics,
  };
}

function resolveImportPath(root: string, importPath: string): string {
  const target = importPath.endsWith(".sigil")
    ? importPath
    : joinPath(importPath, "#module.sigil");
  return normalizePath(joinPath(root, target));
}

function buildGraph(
  imports: readonly ResolvedImport[],
  components: readonly ResolvedComponent[],
  expandsByName: ReadonlyMap<string, IndexedExpand[]>,
): SigilGraph {
  return {
    componentNodes: components.map((component) => ({
      name: component.name,
      filePath: component.filePath,
    })),
    fileEdges: imports
      .filter((item) => item.targetFile !== undefined)
      .map((item) => ({
        from: item.sourceFile,
        to: item.targetFile!,
        importPath: item.declaration.path,
      })),
    importedComponentEdges: imports.flatMap((item) =>
      item.targetFile === undefined ? [] : item.names
        .filter((name) => name.component !== undefined)
        .map((name) => ({
          sourceFile: item.sourceFile,
          targetFile: item.targetFile!,
          componentName: name.name,
          importPath: item.declaration.path,
        }))
    ),
    componentExpansionEdges: components.flatMap((component) =>
      (expandsByName.get(component.name) ?? []).map((expand) => ({
        componentName: component.name,
        componentFile: component.filePath,
        expandFile: expand.filePath,
      }))
    ),
  };
}

function detectImportCycles(
  imports: readonly ResolvedImport[],
): SigilDiagnostic[] {
  const diagnostics: SigilDiagnostic[] = [];
  const adjacency = new Map<string, string[]>();
  for (const item of imports) {
    if (!item.targetFile) continue;
    const edges = adjacency.get(item.sourceFile) ?? [];
    edges.push(item.targetFile);
    adjacency.set(item.sourceFile, edges);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(file: string): void {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file];
      diagnostics.push(diagnostic(
        "SIGIL_IMPORT_CYCLE",
        `Import cycle detected: ${cycle.join(" -> ")}.`,
        { filePath: file },
      ));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const next of adjacency.get(file) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of adjacency.keys()) {
    visit(file);
  }

  return diagnostics;
}
