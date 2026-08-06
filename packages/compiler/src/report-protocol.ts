import { applyDiagnosticLifecycle } from "./history.ts";
import { compilationColor } from "./status.ts";
import {
  COMPILATION_REPORT_VERSION,
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
