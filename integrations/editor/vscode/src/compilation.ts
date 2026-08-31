import { spawn } from "node:child_process";
import readline from "node:readline";

export interface CompilerDiagnostic {
  readonly code: string;
  readonly fingerprint?: string;
  readonly severity: "error" | "warning" | "optimization" | "information";
  readonly stage: string;
  readonly skill?: string;
  readonly lifecycle: "new" | "unchanged" | "resolved" | "regressed";
  readonly message: string;
  readonly filePath?: string;
  readonly range?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly semanticSubjects: readonly DiagnosticSemanticSubject[];
  readonly evidence?: string;
  readonly impact?: string;
  readonly correction?: string;
  readonly evaluator?: string;
}

export interface DiagnosticSemanticSubject {
  readonly relation: "direct" | "governing" | "related";
  readonly sigilPath: string;
  readonly componentName: string;
  readonly ownerKind: "component" | "expand";
  readonly ownerName: string;
  readonly sectionName:
    | "goal"
    | "interface"
    | "state"
    | "logic"
    | "constraints"
    | "decisions"
    | "cases";
  readonly conceptIdentifier?: string;
  readonly semanticUnit?: {
    readonly range: {
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
    };
    readonly fingerprint: string;
  };
}

export type StageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped-by-dependency"
  | "disabled"
  | "cancelled";

export interface StageReport {
  readonly id: string;
  readonly required: boolean;
  readonly state: StageState;
  readonly evaluator: string;
  readonly diagnosticCount: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly evaluations?: readonly unknown[];
}

export interface CompilationReport {
  readonly reportVersion: 3;
  readonly runId?: string;
  readonly workspaceRoot?: string;
  /** The boundary that was compiled; may be wider than what was selected. */
  readonly target?: unknown;
  /** The selector the caller supplied, before boundary inference. */
  readonly requestedScope?: unknown;
  /** How `target` was derived from `requestedScope`. */
  readonly selection?: unknown;
  readonly status: "red" | "yellow" | "green";
  readonly componentNames: readonly string[];
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly sourceFingerprint?: string;
  readonly requestedStage?: string;
  readonly focus?: "design" | "implementation";
  readonly session?: unknown;
  readonly profile?: unknown;
  readonly stages?: readonly StageReport[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export interface CompilationEvent {
  readonly protocolVersion: 1;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const EVENT_TYPES = new Set([
  "started",
  "stage-started",
  "stage-completed",
  "diagnostic",
  "completed",
  "failed",
  "cancelled",
]);
const TERMINAL_EVENT_TYPES = new Set(["completed", "failed", "cancelled"]);

export interface CompilationProcess {
  readonly result: Promise<CompilationReport>;
  cancel(): void;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,logic,constraints,cases
export function runCompilationProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  onEvent: (event: CompilationEvent) => void,
  onLog: (line: string) => void,
): CompilationProcess {
  const child = spawn(executable, [...args, "--format", "jsonl"], {
    cwd,
    shell: false,
    windowsHide: true,
  });
  let expectedSequence = 1;
  let completed: CompilationReport | undefined;
  let runId: string | undefined;
  let terminalType: string | undefined;
  let terminalMessage: string | undefined;
  let activeStage: string | undefined;

  const result = new Promise<CompilationReport>((resolve, reject) => {
    child.once("error", reject);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event = parseCompilationEvent(line);
        if (event.sequence !== expectedSequence++) {
          throw new Error("Compilation event sequence is invalid.");
        }
        if (!runId) runId = event.runId;
        if (event.runId !== runId) {
          throw new Error("Compilation event run identity changed.");
        }
        if (event.sequence === 1 && event.type !== "started") {
          throw new Error("Compilation event stream must begin with started.");
        }
        if (event.sequence !== 1 && event.type === "started") {
          throw new Error(
            "Compilation event stream contains duplicate started.",
          );
        }
        if (terminalType) {
          throw new Error("Compilation event followed a terminal event.");
        }
        if (event.type === "stage-started") {
          if (activeStage) {
            throw new Error(
              `Compilation stage ${activeStage} did not complete before another stage started.`,
            );
          }
          activeStage = event.payload.stage as string;
        } else if (event.type === "stage-completed") {
          const report = event.payload.report as StageReport;
          if (!activeStage || report.id !== activeStage) {
            throw new Error(
              "Compilation stage completed without its matching start event.",
            );
          }
          activeStage = undefined;
        } else if (event.type === "diagnostic" && !activeStage) {
          throw new Error(
            "Compilation diagnostic was emitted outside an active stage.",
          );
        }
        // Terminal events may end a valid prefix with an open stage; later
        // progress can be suppressed by the producer.
        onEvent(event);
        if (event.type === "completed") {
          const report = event.payload.report;
          if (!isCompilationReport(report)) {
            throw new Error("Completed event has no valid CompilationReport.");
          }
          completed = report;
        }
        if (TERMINAL_EVENT_TYPES.has(event.type)) {
          terminalType = event.type;
          terminalMessage = typeof event.payload.message === "string"
            ? event.payload.message
            : undefined;
        }
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    readline.createInterface({ input: child.stderr }).on("line", onLog);
    child.once("close", (code, signal) => {
      if (completed) {
        resolve(completed);
      } else if (terminalType) {
        reject(
          new Error(
            terminalMessage ??
              `Sigil compilation ended with terminal event ${terminalType}.`,
          ),
        );
      } else {
        reject(
          new Error(
            signal
              ? `Sigil compilation was terminated by ${signal}.`
              : `Sigil compile exited with code ${
                code ?? "unknown"
              } without a completed report.`,
          ),
        );
      }
    });
  });

  return {
    result,
    cancel: () => child.kill("SIGTERM"),
  };
}

export function parseCompilationEvent(line: string): CompilationEvent {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Compilation event must be an object.");
  }
  const event = value as Record<string, unknown>;
  if (
    event.protocolVersion !== 1 || typeof event.runId !== "string" ||
    !event.runId || !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 1 ||
    typeof event.type !== "string" || !EVENT_TYPES.has(event.type) ||
    !event.payload || typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new Error("Incompatible or malformed compilation event.");
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    (event.type === "stage-started" && typeof payload.stage !== "string") ||
    (event.type === "stage-completed" &&
      !isStageCompletedReport(payload.report)) ||
    (event.type === "diagnostic" &&
      !isCompilerDiagnostic(payload.diagnostic)) ||
    (event.type === "completed" && !isCompilationReport(payload.report)) ||
    (["failed", "cancelled"].includes(event.type as string) &&
      (typeof payload.code !== "string" ||
        typeof payload.message !== "string"))
  ) {
    throw new Error("Compilation event payload is malformed.");
  }
  return event as unknown as CompilationEvent;
}

export function componentAt(
  source: string,
  zeroBasedLine: number,
): string | undefined {
  const lines = source.split(/\r?\n/);
  let depth = 0;
  let owner: { name: string; depth: number } | undefined;
  for (let index = 0; index <= zeroBasedLine && index < lines.length; index++) {
    const line = lines[index].replace(/\/\/.*$/, "");
    const declaration =
      /^\s*(?:component|expand)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/.exec(
        line,
      );
    if (declaration) owner = { name: declaration[1], depth };
    depth += [...line].filter((character) => character === "{").length;
    depth -= [...line].filter((character) => character === "}").length;
    if (owner && depth <= owner.depth) owner = undefined;
  }
  return owner?.name;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface logic,constraints
export function diagnosticDisplayRange(
  diagnostic: CompilerDiagnostic,
): NonNullable<CompilerDiagnostic["range"]> | undefined {
  const semanticUnitRange = diagnostic.semanticSubjects.find((subject) =>
    subject.relation === "direct" && subject.semanticUnit
  )?.semanticUnit?.range;
  return semanticUnitRange ?? diagnostic.range;
}

function isCompilationReport(value: unknown): value is CompilationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report.reportVersion === 3 &&
    ["red", "yellow", "green"].includes(String(report.status)) &&
    Array.isArray(report.componentNames) && Array.isArray(report.diagnostics) &&
    report.componentNames.every((item) => typeof item === "string") &&
    report.diagnostics.every(isCompilerDiagnostic) &&
    (report.stages === undefined ||
      (Array.isArray(report.stages) && report.stages.every(isStageReport)));
}

function isStageReport(value: unknown): value is StageReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return typeof report.id === "string" && report.id.length > 0 &&
    typeof report.required === "boolean" &&
    [
      "pending",
      "running",
      "completed",
      "failed",
      "skipped-by-dependency",
      "disabled",
      "cancelled",
    ].includes(String(report.state)) &&
    typeof report.evaluator === "string" && report.evaluator.length > 0 &&
    Number.isSafeInteger(report.diagnosticCount) &&
    (report.diagnosticCount as number) >= 0 &&
    (report.startedAt === undefined || typeof report.startedAt === "string") &&
    (report.completedAt === undefined ||
      typeof report.completedAt === "string") &&
    (report.evaluations === undefined || Array.isArray(report.evaluations));
}

function isStageCompletedReport(value: unknown): value is StageReport {
  return isStageReport(value) &&
    (value.state === "completed" || value.state === "failed");
}

function isCompilerDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  return typeof diagnostic.code === "string" &&
    typeof diagnostic.stage === "string" &&
    ["error", "warning", "optimization", "information"].includes(
      String(diagnostic.severity),
    ) &&
    ["new", "unchanged", "resolved", "regressed"].includes(
      String(diagnostic.lifecycle),
    ) &&
    typeof diagnostic.message === "string" &&
    (diagnostic.filePath === undefined ||
      typeof diagnostic.filePath === "string") &&
    (diagnostic.range === undefined || isRange(diagnostic.range)) &&
    Array.isArray(diagnostic.semanticSubjects) &&
    diagnostic.semanticSubjects.every(isSemanticSubject);
}

function isSemanticSubject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const subject = value as Record<string, unknown>;
  return ["direct", "governing", "related"].includes(
    String(subject.relation),
  ) &&
    typeof subject.sigilPath === "string" &&
    typeof subject.componentName === "string" &&
    ["component", "expand"].includes(String(subject.ownerKind)) &&
    typeof subject.ownerName === "string" &&
    [
      "goal",
      "interface",
      "state",
      "logic",
      "constraints",
      "decisions",
      "cases",
    ].includes(String(subject.sectionName)) &&
    (subject.conceptIdentifier === undefined ||
      typeof subject.conceptIdentifier === "string") &&
    (subject.semanticUnit === undefined ||
      (!!subject.semanticUnit && typeof subject.semanticUnit === "object" &&
        !Array.isArray(subject.semanticUnit) &&
        isRange((subject.semanticUnit as Record<string, unknown>).range) &&
        typeof (subject.semanticUnit as Record<string, unknown>).fingerprint ===
          "string"));
}

function isRange(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  return Number.isSafeInteger(position.line) &&
    (position.line as number) >= 1 &&
    Number.isSafeInteger(position.column) &&
    (position.column as number) >= 1;
}
