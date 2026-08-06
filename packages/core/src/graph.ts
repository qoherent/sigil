import type {
  ComponentIdentity,
  SigilGraph,
  SigilResolution,
} from "./model.ts";

export type { SigilGraph } from "./model.ts";

// @sigil implements packages/core/src/graph.sigil::SigilGraphBuilder::GraphConstruction interface,logic,constraints
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
          sourceComponents: sourceComponentsFor(
            resolution,
            item.sourceFile,
            name.uses,
          ),
          originRange: item.declaration.range,
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

function sourceComponentsFor(
  resolution: SigilResolution,
  sourceFile: string,
  uses: readonly { ownerKind?: "component" | "expand"; ownerName?: string }[],
): readonly ComponentIdentity[] {
  const keys = new Map<string, ComponentIdentity>();
  for (const use of uses) {
    if (
      !use.ownerName ||
      (use.ownerKind !== "component" && use.ownerKind !== "expand")
    ) continue;
    const component = resolution.components.find((candidate) =>
      candidate.name === use.ownerName &&
      (candidate.filePath === sourceFile ||
        candidate.expansions.expands.some((expand) =>
          expand.filePath === sourceFile
        ))
    );
    if (!component) continue;
    const identity = {
      componentName: component.name,
      declarationPath: component.filePath,
    };
    keys.set(
      `${identity.declarationPath}\0${identity.componentName}`,
      identity,
    );
  }
  return [...keys.values()].sort((a, b) =>
    a.declarationPath.localeCompare(b.declarationPath) ||
    a.componentName.localeCompare(b.componentName)
  );
}

// @sigil implements packages/core/src/graph.sigil::SigilGraphBuilder::StronglyConnectedComponents interface,logic,constraints,cases
export function stronglyConnectedComponentGroups(
  graph: SigilGraph,
): readonly (readonly ComponentIdentity[])[] {
  const nodes = graph.componentNodes.map((node) => ({
    componentName: node.name,
    declarationPath: node.filePath,
  })).sort(compareIdentity);
  const key = (node: ComponentIdentity) =>
    `${node.declarationPath}\0${node.componentName}`;
  const byKey = new Map(nodes.map((node) => [key(node), node]));
  const adjacency = new Map(
    nodes.map((node) => [key(node), new Set<string>()]),
  );
  for (const edge of graph.importedComponentEdges) {
    const target = nodes.find((node) =>
      node.componentName === edge.componentName &&
      node.declarationPath === edge.targetFile
    );
    if (!target) continue;
    for (const source of edge.sourceComponents) {
      adjacency.get(key(source))?.add(key(target));
    }
  }
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: ComponentIdentity[][] = [];
  const visit = (id: string) => {
    indices.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const target of [...(adjacency.get(id) ?? [])].sort()) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const group: ComponentIdentity[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        group.push(byKey.get(current)!);
      } while (current !== id);
      groups.push(group.sort(compareIdentity));
    }
  };
  for (const node of nodes) if (!indices.has(key(node))) visit(key(node));
  return groups.sort((a, b) => compareIdentity(a[0], b[0]));
}
function compareIdentity(a: ComponentIdentity, b: ComponentIdentity): number {
  return a.declarationPath.localeCompare(b.declarationPath) ||
    a.componentName.localeCompare(b.componentName);
}
