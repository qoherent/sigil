import { applyDiagnosticLifecycle } from "./history.ts";
import { compilationColor } from "./status.ts";
import {
  COMPILATION_REPORT_VERSION,
  type CompilationEvaluationResult,
  type CompilationReport,
  type CompilerDiagnostic,
  type StageReport,
} from "./types.ts";

export interface CompilationReportInput extends
  Omit<
    CompilationReport,
    "reportVersion" | "status" | "diagnostics"
  > {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly stages: readonly StageReport[];
  readonly previous?: CompilationReport;
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol interface,logic,constraints,cases
export function constructCompilationReport(
  input: CompilationReportInput,
): CompilationReport {
  const diagnostics = applyDiagnosticLifecycle(
    input.diagnostics,
    input.previous,
  );
  const { previous: _previous, ...report } = input;
  return {
    ...report,
    reportVersion: COMPILATION_REPORT_VERSION,
    status: compilationColor(diagnostics, input.stages),
    diagnostics,
  };
}

export interface SessionReportIdentity {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly sessionIdentity: string;
  readonly baseEpoch: number;
  readonly generation: number;
  readonly baseFingerprint: string;
  readonly proposalFingerprint: string;
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport interface,cases
export function constructSessionCompilationReport(
  evaluation: CompilationEvaluationResult,
  identity: SessionReportIdentity,
  previous?: CompilationReport,
): CompilationReport {
  return constructCompilationReport({
    ...evaluation,
    diagnostics: evaluation.diagnostics ?? [],
    stages: evaluation.stages ?? [],
    runId: identity.runId,
    workspaceRoot: identity.workspaceRoot,
    previous,
    session: {
      sessionIdentity: identity.sessionIdentity,
      baseEpoch: identity.baseEpoch,
      generation: identity.generation,
      baseFingerprint: identity.baseFingerprint,
      proposalFingerprint: identity.proposalFingerprint,
    },
  });
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::ReportWireValidation interface
export function validateCompilationReportWire(
  value: unknown,
): value is CompilationReport {
  if (!record(value)) return false;
  return value.reportVersion === COMPILATION_REPORT_VERSION &&
    nonempty(value.runId) && nonempty(value.workspaceRoot) &&
    validTarget(value.target) && validScope(value.requestedScope) &&
    validSelection(value.selection) && stringArray(value.componentNames) &&
    ["red", "yellow", "green"].includes(String(value.status)) &&
    date(value.startedAt) && date(value.completedAt) &&
    nonempty(value.sourceFingerprint) && validProfile(value.profile) &&
    Array.isArray(value.stages) && value.stages.every(validStageReport) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(validDiagnostic) &&
    (value.requestedStage === undefined || nonempty(value.requestedStage)) &&
    (value.focus === undefined || value.focus === "design" ||
      value.focus === "implementation") &&
    validSession(value.session);
}

// @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::ReportWireValidation interface
export function equalReportWireValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((item, index) => equalReportWireValue(item, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined)
    .sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && equalReportWireValue(left[key], right[key])
    );
}

export function validStageReport(value: unknown): value is StageReport {
  return record(value) && nonempty(value.id) &&
    typeof value.required === "boolean" &&
    [
      "pending",
      "running",
      "completed",
      "failed",
      "skipped-by-dependency",
      "disabled",
      "cancelled",
    ].includes(String(value.state)) && nonempty(value.evaluator) &&
    nonnegativeInteger(value.diagnosticCount) &&
    (value.startedAt === undefined || date(value.startedAt)) &&
    (value.completedAt === undefined || date(value.completedAt)) &&
    (value.evaluations === undefined || Array.isArray(value.evaluations));
}

export function validDiagnostic(
  value: unknown,
): value is CompilerDiagnostic {
  return record(value) && nonempty(value.code) && nonempty(value.fingerprint) &&
    ["error", "warning", "optimization", "information"].includes(
      String(value.severity),
    ) && nonempty(value.stage) && nonempty(value.skill) &&
    typeof value.message === "string" &&
    Array.isArray(value.semanticSubjects) &&
    typeof value.evidence === "string" && typeof value.impact === "string" &&
    typeof value.correction === "string" && nonempty(value.evaluator) &&
    ["new", "unchanged", "resolved", "regressed"].includes(
      String(value.lifecycle),
    );
}

function validProfile(value: unknown): boolean {
  return record(value) && nonempty(value.name) &&
    typeof value.criticalSystem === "boolean" &&
    positiveInteger(value.contextBudgetChars) &&
    positiveInteger(value.agentInputBudgetChars) && record(value.limits) &&
    record(value.executionBudgets) && Array.isArray(value.stages) &&
    Array.isArray(value.evaluators) && nonempty(value.fingerprint);
}

function validTarget(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "workspace") return true;
  if (value.kind === "file") return nonempty(value.filePath);
  if (value.kind === "component") {
    return nonempty(value.name) &&
      (value.declarationPath === undefined || nonempty(value.declarationPath));
  }
  return value.kind === "location" && nonempty(value.filePath) &&
    positiveInteger(value.line) && positiveInteger(value.column);
}

function validSession(value: unknown): boolean {
  return value === undefined || (record(value) &&
    nonempty(value.sessionIdentity) && positiveInteger(value.baseEpoch) &&
    positiveInteger(value.generation) && nonempty(value.baseFingerprint) &&
    nonempty(value.proposalFingerprint));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(nonempty);
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function date(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validScope(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "workspace") return true;
  if (value.kind === "component") return nonempty(value.componentName);
  if (value.kind === "file") return nonempty(value.filePath);
  if (value.kind === "directory") return nonempty(value.directoryPath);
  if (value.kind === "location") {
    return nonempty(value.filePath) && typeof value.line === "number" &&
      typeof value.column === "number";
  }
  return false;
}

function validSelection(value: unknown): boolean {
  if (!record(value)) return false;
  return [
    "exact-target",
    "nearest-covering-module-index",
    "covering-component",
    "workspace-fallback",
  ].includes(String(value.strategy)) &&
    stringArray(value.affectedSemanticUnits) &&
    stringArray(value.coveredSemanticUnits) &&
    stringArray(value.uncoveredSemanticUnits);
}
