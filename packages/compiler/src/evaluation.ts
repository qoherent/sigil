import type {
  PurposeRetrievalResult,
  ResolvedComponent,
} from "@qoherent/sigil-core";
import type { AgentEvaluationTarget } from "./types.ts";

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext logic,constraints,cases
export function compilationEvaluationTarget(
  component: ResolvedComponent,
  root: string,
  retrieval: PurposeRetrievalResult,
): AgentEvaluationTarget {
  const initialPaths = new Set([
    component.filePath,
    ...retrieval.evidence.flatMap((item) => item.path ? [item.path] : []),
  ].map((path) => canonicalWorkspacePath(path, root)));
  return {
    componentName: component.name,
    sigilFile: canonicalWorkspacePath(component.filePath, root),
    initialPaths: [...initialPaths],
    retrieval,
  };
}

function canonicalWorkspacePath(path: string, root: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalizedRoot !== "." &&
    (normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`))
  ) return normalized.slice(normalizedRoot.length).replace(/^\//, "") || ".";
  return normalized.replace(/^\.\//, "");
}
