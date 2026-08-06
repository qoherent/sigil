import type {
  PurposeRetrievalResult,
  SigilFormKind,
  SigilSectionName,
  SourceRange,
} from "@qoherent/sigil-core";

export const COMPILATION_PROTOCOL_VERSION = 1;
export const COMPILATION_REPORT_VERSION = 2;

export type CompilationColor = "red" | "yellow" | "green";
export type DiagnosticSeverity =
  | "error"
  | "warning"
  | "optimization"
  | "information";
export type DiagnosticLifecycle =
  | "new"
  | "unchanged"
  | "resolved"
  | "regressed";
export type StageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped-by-dependency"
  | "disabled"
  | "cancelled";

export type CompilationTarget =
  | { readonly kind: "workspace" }
  | { readonly kind: "file"; readonly filePath: string }
  | {
    readonly kind: "component";
    readonly name: string;
    readonly declarationPath?: string;
  }
  | {
    readonly kind: "location";
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
  };

export type CompilationFocus = "design" | "implementation";

export type CompilerFailureCode =
  | "COMPILER_INVALID_INVOCATION"
  | "COMPILER_PROFILE_EVALUATORS_REQUIRED"
  | "COMPILER_CANCELLED"
  | "COMPILER_FAILED"
  | "COMPILER_INVALID_PROPOSAL"
  | "COMPILER_GENERATION_EXHAUSTED"
  | "COMPILER_INVALID_SESSION_IDENTITY"
  | "COMPILER_SESSION_BUSY"
  | "COMPILER_SESSION_EXPIRED"
  | "COMPILER_UNSAFE_SNAPSHOT_PATH"
  | "COMPILER_SNAPSHOT_CHANGED"
  | "COMPILER_WORKSPACE_STATE"
  | "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED"
  | "COMPILER_WORKSPACE_HOST_FAILURE";

export type DiagnosticSemanticRelation = "direct" | "governing" | "related";

export interface DiagnosticSemanticUnit {
  readonly range: SourceRange;
  readonly fingerprint: string;
}

export interface DiagnosticSemanticSubject {
  readonly relation: DiagnosticSemanticRelation;
  readonly sigilPath: string;
  readonly componentName: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly sectionName: SigilSectionName;
  readonly conceptIdentifier?: string;
  readonly semanticUnit?: DiagnosticSemanticUnit;
}

export interface CompilerDiagnostic {
  readonly code: string;
  readonly fingerprint: string;
  readonly severity: DiagnosticSeverity;
  readonly stage: string;
  readonly skill: string;
  readonly message: string;
  readonly filePath?: string;
  readonly range?: SourceRange;
  readonly semanticSubjects: readonly DiagnosticSemanticSubject[];
  readonly evidence: string;
  readonly impact: string;
  readonly correction: string;
  readonly evaluator: string;
  readonly lifecycle: DiagnosticLifecycle;
}

export interface StageReport {
  readonly id: string;
  readonly required: boolean;
  readonly state: StageState;
  readonly evaluator: string;
  readonly diagnosticCount: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly evaluations?: readonly AgentEvaluationTrace[];
}

export interface EffectiveProfile {
  readonly name: string;
  readonly criticalSystem: boolean;
  readonly contextBudgetChars: number;
  readonly agentInputBudgetChars: number;
  readonly limits: CompilationLimits;
  readonly executionBudgets: AgentExecutionBudgets;
  readonly stages: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly enabled: boolean;
    readonly agentic: boolean;
    readonly dependencies: readonly string[];
  }[];
  readonly adapter?: {
    readonly provider: "codex" | "claude" | "mock";
    readonly model?: string;
  };
  readonly evaluators: readonly EvaluatorConfiguration[];
  readonly fingerprint: string;
}

export interface CompilationReport {
  readonly reportVersion: 2;
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly target: CompilationTarget;
  readonly componentNames: readonly string[];
  readonly status: CompilationColor;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourceFingerprint: string;
  readonly requestedStage?: string;
  readonly focus?: CompilationFocus;
  readonly session?: {
    readonly sessionIdentity: string;
    readonly baseEpoch: number;
    readonly generation: number;
    readonly baseFingerprint: string;
    readonly proposalFingerprint: string;
  };
  readonly profile: EffectiveProfile;
  readonly stages: readonly StageReport[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export type CompilationEventType =
  | "started"
  | "stage-started"
  | "stage-completed"
  | "diagnostic"
  | "completed"
  | "failed"
  | "cancelled";

export interface CompilationEvent {
  readonly protocolVersion: 1;
  readonly runId: string;
  readonly sequence: number;
  readonly type: CompilationEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CompileOptions {
  readonly profile?: string;
  readonly requestedStage?: string;
  readonly focus?: CompilationFocus;
  readonly disableHistory?: boolean;
  readonly noHistory?: boolean;
  readonly reportExport?: string;
  readonly output?: string;
  readonly cancellationSignal?: AbortSignal;
  readonly signal?: AbortSignal;
  readonly adapter?: AgentAdapter;
  readonly adapters?: readonly AgentAdapter[];
  readonly history?: CompilationHistoryStore;
  readonly hostWarningSink?: (
    warning: CompilationHistoryWarning,
  ) => void | Promise<void>;
  readonly onEvent?: (event: CompilationEvent) => void | Promise<void>;
}

export interface CompilationHistoryWarning {
  readonly code:
    | "COMPILER_HISTORY_READ_FAILED"
    | "COMPILER_HISTORY_WRITE_FAILED";
  readonly operation: "read" | "write";
  readonly message: string;
  readonly historyKey: string;
}

export interface CompilationProposal {
  readonly sources: Readonly<Record<string, string>>;
}

export type CompilationSessionLifecycleState =
  | "active"
  | "evaluating"
  | "refreshing"
  | "closing"
  | "closed"
  | "expired"
  | "cleanup-failed"
  | "manual-recovery-required";

export interface ProposalWorkspacePersistedState {
  readonly version: 1;
  readonly sessionIdentity: string;
  readonly directoryName: string;
  readonly baseFingerprint: string;
  readonly selectedPaths: readonly string[];
  readonly generation?: number;
  readonly proposalFingerprint?: string;
}

export interface CompilationSessionRecord {
  readonly version: 1;
  readonly sessionIdentity: string;
  readonly workspacePath: string;
  readonly target: CompilationTarget;
  readonly profileName: string;
  readonly focus: CompilationFocus;
  readonly lifecycle: CompilationSessionLifecycleState;
  readonly expiresAt: string;
  readonly baseEpoch: number;
  readonly generation?: number;
  readonly baseFingerprint: string;
  readonly proposalFingerprint?: string;
  readonly proposalWorkspace: ProposalWorkspacePersistedState;
  readonly latestReport?: CompilationReport;
}

export interface CompilationSessionStartResult {
  readonly sessionIdentity: string;
  readonly baseEpoch: number;
  readonly baseFingerprint: string;
  readonly expiresAt: string;
}

export interface CompilationSessionRefreshResult {
  readonly baseEpoch: number;
  readonly baseFingerprint: string;
}

export interface AgentFinding {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly filePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly evidence: string;
  readonly impact: string;
  readonly correction: string;
}

export interface AgentEvaluationTarget {
  readonly componentName: string;
  readonly sigilFile: string;
  readonly initialPaths: readonly string[];
  readonly retrieval?: PurposeRetrievalResult;
}

export interface AgentCapabilityContract {
  readonly workspaceAccess: "read-only";
  readonly network: false;
  readonly approvalEscalation: false;
  readonly ephemeral: true;
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
}

export interface AgentExecutionBudgets {
  readonly elapsedTimeMs: number;
  readonly maxCommands: number;
  readonly maxCommandOutputChars: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface AgentEvaluationRequest {
  readonly stage: string;
  readonly skill: string;
  readonly allowedRules: readonly string[];
  readonly implementationEvidence: "context-only" | "compare";
  readonly workspaceRoot: string;
  readonly target: AgentEvaluationTarget;
  readonly capabilities: AgentCapabilityContract;
  readonly budgets: AgentExecutionBudgets;
  readonly maxInputChars: number;
  readonly signal?: AbortSignal;
}

export interface AgentCommandTrace {
  readonly command: string;
  readonly status?: string;
  readonly exitCode?: number;
}

export interface AgentUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
}

export interface AgentEvaluationTrace {
  readonly evaluatorId: string;
  readonly componentName: string;
  readonly commands: readonly AgentCommandTrace[];
  readonly usage?: AgentUsage;
}

export interface AgentEvaluationResult {
  readonly findings: readonly AgentFinding[];
  readonly commands: readonly AgentCommandTrace[];
  readonly usage?: AgentUsage;
}

export interface AgentAdapter {
  readonly id: string;
  readonly provider: "codex" | "claude" | "mock";
  readonly model?: string;
  readonly capabilities: {
    readonly readOnlyWorkspace: boolean;
    readonly network: false;
    readonly approvalEscalation: false;
    readonly ephemeral: boolean;
  };
  evaluate(request: AgentEvaluationRequest): Promise<AgentEvaluationResult>;
}

export interface CompileConfiguration {
  readonly defaultProfile?: string;
  readonly budgets?: Partial<AgentExecutionBudgets>;
  readonly limits?: Partial<CompilationLimits>;
  readonly adapter?: {
    readonly provider: "codex" | "claude";
    readonly model?: string;
  };
  readonly evaluators?: Readonly<
    Record<string, {
      readonly provider?: unknown;
      readonly model?: unknown;
    }>
  >;
  readonly profiles?: Readonly<
    Record<string, {
      readonly extends?: "standard" | "critical-system";
      readonly disabledStages?: readonly string[];
      readonly evaluatorIds?: readonly string[];
    }>
  >;
}

export interface CompilationLimits {
  readonly maxCompilationRequestChars: number;
  readonly maxAgentInputChars: number;
  readonly sessionTtlMs: number;
}

export interface EvaluatorConfiguration {
  readonly id: string;
  readonly provider: "codex" | "claude" | "mock";
  readonly model?: string;
}

export interface CompilationHistoryStore {
  read(key: string): Promise<CompilationReport | undefined>;
  write(key: string, report: CompilationReport): Promise<void>;
}
