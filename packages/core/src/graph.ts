import type { SigilGraph, SigilResolution } from "./model.ts";

export type { SigilGraph } from "./model.ts";

export function buildSigilGraph(resolution: SigilResolution): SigilGraph {
  return {
    componentNodes: resolution.components.map((component) => ({
      name: component.name,
      filePath: component.filePath,
    })),
    fileEdges: resolution.imports
      .filter((item) => item.targetFile !== undefined)
      .map((item) => ({
        from: item.sourceFile,
        to: item.targetFile!,
        importPath: item.declaration.path,
      })),
    importedComponentEdges: resolution.imports.flatMap((item) =>
      item.targetFile === undefined ? [] : item.names
        .filter((name) =>
          name.component !== undefined && name.componentFile !== undefined
        )
        .map((name) => ({
          sourceFile: item.sourceFile,
          targetFile: name.componentFile!,
          componentName: name.name,
          importPath: item.declaration.path,
        }))
    ),
    componentExpansionEdges: resolution.components.flatMap((component) =>
      component.expansions.expands.map((expand) => ({
        componentName: component.name,
        componentFile: component.filePath,
        expandFile: expand.filePath,
      }))
    ),
  };
}
