import type { ResolvedSigilWorkspace } from "./model/resolution.ts";
import { orderDiagnostics } from "./diagnostics.ts";
import type { SigilWorkspace } from "./model/workspace.ts";
import { buildSigilGraph } from "./graph.ts";
import { glossaryProjectionForWorkspace } from "./glossary.ts";
import { resolveSigilRelationships } from "./resolver.ts";

/*
 * @sigil implements packages/core/src/pipeline.sigil::SigilWorkspaceResolutionPipeline::WorkspaceResolution interface
 * @sigil implements packages/core/src/pipeline.sigil::SigilWorkspaceResolutionPipeline logic,cases
 */
export function resolveSigilWorkspace(
  workspace: SigilWorkspace,
): ResolvedSigilWorkspace {
  const resolution = resolveSigilRelationships(workspace);
  const glossary = glossaryProjectionForWorkspace(workspace);
  return {
    ...resolution,
    graph: buildSigilGraph(resolution),
    glossary,
    diagnostics: orderDiagnostics([
      ...resolution.diagnostics,
      ...glossary.diagnostics,
    ]),
  };
}
