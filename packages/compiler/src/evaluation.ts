import type {
  PurposeRetrievalResult,
  ResolvedComponent,
} from "@qoherent/sigil-core";
import { deriveEvaluatorRetrievalBrief } from "./evaluator-retrieval.ts";
import { validateAgentEvaluationRequest } from "./evaluation-request.ts";
import type { AgentEvaluationRequest, AgentEvaluationTarget } from "./types.ts";

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext logic,constraints,cases
export async function compilationEvaluationTarget(
  component: ResolvedComponent,
  root: string,
  retrieval: PurposeRetrievalResult,
): Promise<AgentEvaluationTarget> {
  const retrievalBrief = await deriveEvaluatorRetrievalBrief(retrieval, root);
  return {
    componentName: component.name,
    sigilFile: canonicalWorkspacePath(component.filePath, root),
    initialPaths: retrievalBrief.allowedDirectReadPaths,
    retrieval,
    retrievalBrief,
  };
}

// @sigil implements packages/compiler/src/evaluation.sigil::SigilCompilationEvaluation::EvaluationContext interface,logic,constraints,cases
export function buildAgentEvaluationRequest(
  request: AgentEvaluationRequest,
): AgentEvaluationRequest {
  validateAgentEvaluationRequest(request);
  return Object.freeze({
    ...request,
    target: Object.freeze({
      ...request.target,
      initialPaths: Object.freeze([...request.target.initialPaths]),
      retrievalBrief: request.target.retrievalBrief && Object.freeze({
        ...request.target.retrievalBrief,
        allowedDirectReadPaths: Object.freeze([
          ...request.target.retrievalBrief.allowedDirectReadPaths,
        ]),
      }),
    }),
  });
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
