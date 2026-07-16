import type { ResolvedSigilWorkspace, SigilWorkspace } from "./model.ts";
import { buildSigilGraph } from "./graph.ts";
import { resolveSigilRelationships } from "./resolver.ts";

export function resolveSigilWorkspace(
  workspace: SigilWorkspace,
): ResolvedSigilWorkspace {
  const resolution = resolveSigilRelationships(workspace);
  return {
    ...resolution,
    graph: buildSigilGraph(resolution),
  };
}
