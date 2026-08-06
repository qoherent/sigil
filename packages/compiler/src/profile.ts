import type { CompilationFocus } from "./types.ts";

// @sigil implements packages/compiler/src/compiler.sigil::SigilCompiler::OneShotCompilation logic,cases
export function stageForCompilationFocus(
  focus: CompilationFocus | undefined,
): string | undefined {
  return focus === "design"
    ? "architecture-design"
    : focus === "implementation"
    ? "current-code-compatibility"
    : undefined;
}
