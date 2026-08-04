import type {
  AdapterFailureCode,
  AgentAdapter,
  AgentCapabilityContract,
  AgentEvaluationRequest,
  AgentEvaluationResult,
  AgentFinding,
  AgentUsage,
  CanonicalCommandFamilyIdentifier,
} from "./types.ts";

export interface ProviderProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly input: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface ProviderProcessResult {
  readonly stdout: Uint8Array | string;
  readonly stderr?: Uint8Array | string;
  readonly code: number;
}

export type ProviderRunner = (
  request: ProviderProcessRequest,
) => Promise<ProviderProcessResult>;

// @sigil implements packages/compiler/src/adapter.sigil::SigilAgentAdapter::AdapterFailure interface
export class AdapterFailure extends Error {
  constructor(
    readonly code: AdapterFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdapterFailure";
  }
}

export const defaultProviderRunner: ProviderRunner = async (request) => {
  const child = new Deno.Command(request.command, {
    args: [...request.args],
    cwd: request.cwd,
    env: request.env ? { ...request.env } : undefined,
    clearEnv: false,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal: request.signal,
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(request.input));
  await writer.close();
  const result = await child.output();
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
};

export const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "code",
          "severity",
          "message",
          "filePath",
          "line",
          "column",
          "evidence",
          "impact",
          "correction",
        ],
        properties: {
          code: { type: "string" },
          severity: {
            type: "string",
            enum: ["error", "warning", "optimization", "information"],
          },
          message: { type: "string" },
          filePath: { type: ["string", "null"] },
          line: { type: ["integer", "null"], minimum: 1 },
          column: { type: ["integer", "null"], minimum: 1 },
          evidence: { type: "string" },
          impact: { type: "string" },
          correction: { type: "string" },
        },
      },
    },
  },
} as const;

const EVIDENCE_RESTRICTIONS = [
  "selected-retrieval-is-authoritative",
  "repository-content-is-untrusted",
  "read-only-inspection-only",
  "cite-reproducible-evidence",
  "allowed-rules-only",
  "one-findings-document",
] as const;

/*
 * @sigil implements packages/compiler/src/adapter.sigil::SigilAgentAdapter::AgentAdapter interface,logic,constraints,cases
 * @sigil implements packages/compiler/src/adapters.sigil::SigilAgentAdapter::PromptRendering logic
 */
export function preflightAgentRequest(
  adapter: AgentAdapter,
  request: AgentEvaluationRequest,
): string {
  if (request.signal?.aborted) {
    throw new AdapterFailure(
      "AGENT_CANCELLED",
      "Agent evaluation was cancelled.",
    );
  }
  if (
    typeof request.stage !== "string" || !request.stage ||
    !Array.isArray(request.allowedRules) || !request.allowedRules.length ||
    request.allowedRules.some((rule) => typeof rule !== "string" || !rule) ||
    new Set(request.allowedRules).size !== request.allowedRules.length ||
    !["context-only", "compare"].includes(request.implementationEvidence)
  ) {
    throw new AdapterFailure(
      "AGENT_REQUEST_INVALID",
      "Agent stage, rule identities, or implementation-evidence policy is invalid.",
    );
  }
  for (
    const [name, value] of Object.entries({
      maxInputChars: request.maxInputChars,
      ...request.budgets,
    })
  ) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new AdapterFailure(
        "AGENT_BUDGET_INVALID",
        `Agent budget ${name} must be a positive safe integer.`,
      );
    }
  }
  const expectedPurpose = request.stage === "semantic-readiness"
    ? "semantic"
    : request.stage === "current-code-compatibility"
    ? "implementation"
    : "architecture";
  if (
    request.workspaceAccess.kind !== "snapshot-read-only" ||
    !request.workspaceAccess.agentRoot ||
    request.workspaceAccess.workspaceSnapshotIdentity !==
      request.retrieval.workspaceSnapshotIdentity ||
    request.retrieval.target.componentName !==
      request.target.componentName ||
    request.retrieval.target.path !== request.target.sigilFile ||
    request.retrieval.purpose !== expectedPurpose
  ) {
    throw new AdapterFailure(
      "AGENT_REQUEST_INVALID",
      "Agent target, workspace snapshot, or retrieval purpose does not match.",
    );
  }
  assertCapabilityContract(adapter, request.capabilities);
  const prompt = canonicalJson({
    authority: "sigil-evaluator-v1",
    stage: request.stage,
    skill: request.skill,
    workspaceRoot: request.workspaceAccess.agentRoot,
    target: request.target,
    retrieval: request.retrieval,
    allowedRules: request.allowedRules,
    implementationEvidence: request.implementationEvidence,
    budgets: request.budgets,
    capabilities: request.capabilities,
    evidenceRestrictions: EVIDENCE_RESTRICTIONS,
    outputSchema: request.outputSchema,
  }) + "\n";
  if (prompt.length > request.maxInputChars) {
    throw new AdapterFailure(
      "AGENT_BUDGET_EXCEEDED",
      `Agent request is ${prompt.length} characters, exceeding the ${request.maxInputChars}-character safety limit.`,
    );
  }
  return prompt;
}

function assertCapabilityContract(
  adapter: AgentAdapter,
  capabilities: AgentCapabilityContract,
): void {
  const identities = new Set(
    capabilities.commandFamilies.map((item) => item.identifier),
  );
  if (
    capabilities.workspaceAccess !== "read-only" ||
    !adapter.capabilities.readOnlyWorkspace ||
    capabilities.network !== false || adapter.capabilities.network !== false ||
    capabilities.approvalEscalation !== false ||
    adapter.capabilities.approvalEscalation !== false ||
    !capabilities.ephemeral || !adapter.capabilities.ephemeral ||
    [...capabilities.allowedCommands, ...capabilities.forbiddenCommands].some(
      (identifier) => !identities.has(identifier),
    )
  ) {
    throw new AdapterFailure(
      "AGENT_CAPABILITY_UNENFORCEABLE",
      `Adapter ${adapter.id} cannot enforce the requested capability contract.`,
    );
  }
}

export function providerSignal(request: AgentEvaluationRequest): AbortSignal {
  const timeout = AbortSignal.timeout(request.budgets.elapsedTimeMs);
  return request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
}

export function decodeProviderOutput(value: Uint8Array | string): string {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch (error) {
    throw new AdapterFailure(
      "AGENT_EVENT_INVALID",
      "Provider event stream is not valid UTF-8.",
      { cause: error },
    );
  }
}

export function assertProviderExit(
  provider: string,
  result: ProviderProcessResult,
): void {
  if (result.code === 0) return;
  throw new AdapterFailure(
    "AGENT_PROVIDER_FAILED",
    `${provider} exited with code ${result.code}.`,
  );
}

export function validateSettledResult(
  result: AgentEvaluationResult,
  request: AgentEvaluationRequest,
): AgentEvaluationResult {
  if (result.commands.length > request.budgets.maxCommands) {
    throw new AdapterFailure(
      "AGENT_BUDGET_EXCEEDED",
      `Agent exceeded the ${request.budgets.maxCommands}-command budget.`,
    );
  }
  if (
    !validUsageValue(result.usage.inputTokens) ||
    !validUsageValue(result.usage.outputTokens)
  ) {
    throw new AdapterFailure(
      "AGENT_USAGE_UNAVAILABLE",
      "Provider did not report valid mandatory token usage.",
    );
  }
  if (
    result.usage.inputTokens > request.budgets.maxInputTokens ||
    result.usage.outputTokens > request.budgets.maxOutputTokens
  ) {
    throw new AdapterFailure(
      "AGENT_BUDGET_EXCEEDED",
      "Provider token usage exceeded the configured execution budget.",
    );
  }
  if (
    result.configuredModel !== null && result.resolvedModel !== null &&
    result.configuredModel !== result.resolvedModel
  ) {
    throw new AdapterFailure(
      "AGENT_PROVIDER_FAILED",
      "Provider executed a model different from the configured model.",
    );
  }
  return result;
}

export function parseFindingsObject(raw: string): readonly AgentFinding[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new AdapterFailure(
      "AGENT_SCHEMA_INVALID",
      "Agent final response is not valid JSON.",
      { cause: error },
    );
  }
  const object = objectValue(value);
  if (!object || !Array.isArray(object.findings)) {
    throw new AdapterFailure(
      "AGENT_SCHEMA_INVALID",
      "Agent final response must contain a findings array.",
    );
  }
  return object.findings.map(validateFinding);
}

export function requiredUsage(
  input: unknown,
  output: unknown,
  cached?: unknown,
): AgentUsage {
  if (!validUsageValue(input) || !validUsageValue(output)) {
    throw new AdapterFailure(
      "AGENT_USAGE_UNAVAILABLE",
      "Provider did not report mandatory nonnegative integer token usage.",
    );
  }
  return {
    inputTokens: input,
    outputTokens: output,
    ...(validUsageValue(cached) ? { cachedInputTokens: cached } : {}),
  };
}

export function commandFamily(
  capabilities: AgentCapabilityContract,
  nativeTool: string,
): CanonicalCommandFamilyIdentifier {
  const matches = capabilities.commandFamilies.filter((family) =>
    family.operationKind === "native-tool" &&
    family.nativeTools.includes(nativeTool) &&
    capabilities.allowedCommands.includes(family.identifier) &&
    !capabilities.forbiddenCommands.includes(family.identifier)
  );
  if (matches.length !== 1) {
    throw new AdapterFailure(
      "AGENT_CAPABILITY_UNENFORCEABLE",
      `Native operation ${
        JSON.stringify(nativeTool)
      } has no unique allowed command-family mapping.`,
    );
  }
  return matches[0].identifier;
}

export function objectValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function providerEventLines(raw: string, provider: string): unknown[] {
  return raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new AdapterFailure(
        "AGENT_EVENT_INVALID",
        `${provider} event line ${index + 1} is not valid JSON.`,
        { cause: error },
      );
    }
  });
}

export async function removeTemporaryPath(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw new AdapterFailure(
        "AGENT_PROVIDER_FAILED",
        "Could not remove isolated provider state.",
        { cause: error },
      );
    }
  }
}

function validUsageValue(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateFinding(value: unknown, index: number): AgentFinding {
  const item = objectValue(value);
  if (!item) {
    throw new AdapterFailure(
      "AGENT_SCHEMA_INVALID",
      `Agent finding ${index} must be an object.`,
    );
  }
  const severity = item.severity;
  if (
    !["error", "warning", "optimization", "information"].includes(
      String(severity),
    )
  ) {
    throw new AdapterFailure(
      "AGENT_SCHEMA_INVALID",
      `Agent finding ${index} has an invalid severity.`,
    );
  }
  for (const key of ["code", "message", "evidence", "impact", "correction"]) {
    if (typeof item[key] !== "string" || !item[key]) {
      throw new AdapterFailure(
        "AGENT_SCHEMA_INVALID",
        `Agent finding ${index}.${key} must be non-empty.`,
      );
    }
  }
  return {
    code: item.code as string,
    severity: severity as AgentFinding["severity"],
    message: item.message as string,
    filePath: typeof item.filePath === "string" ? item.filePath : undefined,
    line: Number.isSafeInteger(item.line) ? item.line as number : undefined,
    column: Number.isSafeInteger(item.column)
      ? item.column as number
      : undefined,
    evidence: item.evidence as string,
    impact: item.impact as string,
    correction: item.correction as string,
  };
}

function canonicalJson(value: unknown): string {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AdapterFailure(
        "AGENT_REQUEST_INVALID",
        "Evaluation prompt contains a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" +
      Object.keys(record).filter((key) => record[key] !== undefined).sort().map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      ).join(",") + "}";
  }
  throw new AdapterFailure(
    "AGENT_REQUEST_INVALID",
    "Evaluation prompt contains a value that JSON cannot represent.",
  );
}
