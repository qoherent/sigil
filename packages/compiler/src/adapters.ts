import type {
  AgentAdapter,
  AgentEvaluationRequest,
  AgentEvaluationResult,
  AgentFinding,
} from "./types.ts";

export { AdapterFailure } from "./adapter-runtime.ts";
export type {
  ProviderProcessRequest,
  ProviderProcessResult,
  ProviderRunner,
} from "./adapter-runtime.ts";
export { ClaudeAdapter } from "./claude-adapter.ts";
export { CodexAdapter } from "./codex-adapter.ts";
export type { CommandRunner } from "./codex-adapter.ts";
export { OpenCodeAdapter } from "./opencode-adapter.ts";
export { PiAdapter } from "./pi-adapter.ts";

export class MockAdapter implements AgentAdapter {
  readonly provider = "mock" as const;
  readonly capabilities = {
    readOnlyWorkspace: true,
    network: false,
    approvalEscalation: false,
    ephemeral: true,
  } as const;

  constructor(
    private readonly response:
      | readonly AgentFinding[]
      | AgentEvaluationResult
      | ((request: AgentEvaluationRequest) =>
        | readonly AgentFinding[]
        | AgentEvaluationResult) = [],
    readonly id = "mock",
  ) {}

  evaluate(request: AgentEvaluationRequest): Promise<AgentEvaluationResult> {
    const value = typeof this.response === "function"
      ? this.response(request)
      : this.response;
    return Promise.resolve(
      Array.isArray(value)
        ? {
          findings: value,
          commands: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          configuredModel: null,
          resolvedModel: null,
        }
        : value as AgentEvaluationResult,
    );
  }
}
