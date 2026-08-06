import type {
  ResolvedSigilWorkspace,
  SigilDiagnostic,
  SigilWorkspace,
} from "./model.ts";
import { buildSigilGraph } from "./graph.ts";
import { glossaryProjectionForWorkspace } from "./glossary.ts";
import { resolveSigilRelationships } from "./resolver.ts";

// @sigil implements packages/core/_module.sigil::SigilCore::WorkspaceResolution interface,logic,cases
export function resolveSigilWorkspace(
  workspace: SigilWorkspace,
): ResolvedSigilWorkspace {
  const resolution = resolveSigilRelationships(workspace);
  const glossary = glossaryProjectionForWorkspace(workspace);
  return {
    ...resolution,
    graph: buildSigilGraph(resolution),
    glossary,
    diagnostics: mergeDiagnostics(
      resolution.diagnostics,
      glossary.diagnostics,
    ),
  };
}

function mergeDiagnostics(
  ...groups: ReadonlyArray<readonly SigilDiagnostic[]>
): ResolvedSigilWorkspace["diagnostics"] {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );
}
