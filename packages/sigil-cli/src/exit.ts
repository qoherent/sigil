import type { SigilDiagnostic } from "@sigil/core";

export const EXIT_OK = 0;
export const EXIT_DIAGNOSTICS = 1;
export const EXIT_USAGE = 2;
export const EXIT_RUNTIME = 3;

export function exitCodeForDiagnostics(
  diagnostics: readonly SigilDiagnostic[],
): number {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? EXIT_DIAGNOSTICS
    : EXIT_OK;
}
