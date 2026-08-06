import type {
  CompilationColor,
  CompilerDiagnostic,
  CompilerFailureCode,
  StageReport,
} from "./types.ts";

// @sigil implements packages/compiler/src/status.sigil::SigilCompilationStatus interface,logic,cases
export function compilationColor(
  diagnostics: readonly CompilerDiagnostic[],
  stages: readonly StageReport[],
): CompilationColor {
  if (
    diagnostics.some((item) =>
      item.lifecycle !== "resolved" && item.severity === "error"
    ) ||
    stages.some((stage) =>
      stage.required && !["completed", "disabled"].includes(stage.state)
    )
  ) return "red";
  if (
    diagnostics.some((item) =>
      item.lifecycle !== "resolved" && item.severity === "warning"
    )
  ) return "yellow";
  return "green";
}

export class CompilerFailure extends Error {
  constructor(
    readonly code: CompilerFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CompilerFailure";
  }
}

export function compilerFailureCode(error: unknown): CompilerFailureCode {
  if (error instanceof CompilerFailure) return error.code;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "COMPILER_CANCELLED";
  }
  const candidate = (error as { code?: unknown } | undefined)?.code;
  return typeof candidate === "string" && candidate.startsWith("COMPILER_")
    ? candidate as CompilerFailureCode
    : "COMPILER_FAILED";
}
