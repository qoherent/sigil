import type { ComponentNode, SigilGraph } from "./model/graph.ts";
import type { SigilResolution } from "./model/resolution.ts";
export type { SigilGraph } from "./model/graph.ts";

// @sigil implements packages/core/src/graph.sigil::SigilGraphBuilder::GraphConstruction interface,logic,constraints
export function buildSigilGraph(resolution: SigilResolution): SigilGraph {
  const components = new Map(resolution.components.map((c) => [c.id, c]));
  return {
    componentNodes: resolution.components.map((c) => ({
      id: c.id,
      identity: c.identity,
      name: c.name,
      filePath: c.filePath,
    })),
    fileEdges: resolution.imports.flatMap((item) =>
      item.targetFile
        ? [{
          importId: item.id,
          from: item.sourceFile,
          to: item.targetFile,
          importPath: item.declaration.path,
        }]
        : []
    ),
    importedTagEdges: resolution.imports.flatMap((item) =>
      item.names.flatMap((selection) => {
        if (
          selection.status !== "resolved" || !selection.tag?.identity ||
          !item.targetFile || !item.providerId
        ) return [];
        const usedComponents = [
          ...new Set(selection.uses.map((u) => u.componentId)),
        ];
        return [{
          id: selection.id,
          importId: item.id,
          sourceFile: item.sourceFile,
          targetFile: item.targetFile,
          providerComponentId: item.providerId,
          tagIdentity: selection.tag.identity,
          importPath: item.declaration.path,
          sourceComponents: usedComponents.flatMap((id) =>
            components.get(id)?.identity ? [components.get(id)!.identity!] : []
          ),
          uses: selection.uses,
          originRange: selection.selection.range,
        }];
      })
    ),
  };
}

// @sigil implements packages/core/src/graph.sigil::SigilGraphBuilder::StronglyConnectedGroups interface,logic,constraints,cases
export function stronglyConnectedComponentGroups(
  graph: SigilGraph,
): readonly (readonly ComponentNode[])[] {
  const nodes = graph.componentNodes;
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of graph.importedTagEdges) {
    if (!byId.has(edge.providerComponentId)) continue;
    for (const use of edge.uses) {
      adjacency.get(use.componentId)?.add(edge.providerComponentId);
    }
  }
  let nextIndex = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], onStack = new Set<string>();
  const groups: ComponentNode[][] = [];
  const compare = (a: ComponentNode, b: ComponentNode) =>
    order.get(a.id)! - order.get(b.id)!;
  const visit = (id: string) => {
    indices.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const group: ComponentNode[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        group.push(byId.get(current)!);
      } while (current !== id);
      groups.push(group.sort(compare));
    }
  };
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
  return groups.sort((a, b) => compare(a[0], b[0]));
}
