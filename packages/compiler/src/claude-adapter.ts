import type {
  AgentAdapter,
  AgentEvaluationRequest,
  AgentEvaluationResult,
} from "./types.ts";
import { AdapterFailure } from "./adapter-runtime.ts";

// @sigil implements packages/compiler/src/claude-adapter.sigil::SigilClaudeAdapter::ClaudeAdapter interface,constraints
export class ClaudeAdapter implements AgentAdapter {
  readonly provider = "claude" as const;
  readonly capabilities = {
    readOnlyWorkspace: false,
    network: false,
    approvalEscalation: false,
    ephemeral: false,
  } as const;

  constructor(readonly model?: string, readonly id = "claude") {}

  evaluate(_request: AgentEvaluationRequest): Promise<AgentEvaluationResult> {
    return Promise.reject(
      new AdapterFailure(
        "AGENT_CAPABILITY_UNENFORCEABLE",
        "The installed Claude CLI cannot prove read-only workspace access and ephemeral state; evaluation was not started.",
      ),
    );
  }
}
