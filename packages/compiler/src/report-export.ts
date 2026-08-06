import { CompilerFailure } from "./status.ts";
import type { CompilationReport } from "./types.ts";
import { resolve } from "node:path";

// @sigil implements packages/compiler/src/report-export.sigil::SigilCompilationReportExporter interface,logic,constraints,cases
export async function exportCompilationReport(
  report: CompilationReport,
  destination: string,
  workspaceRoot: string,
): Promise<void> {
  const workspace = absolute(workspaceRoot);
  const target = absolute(destination);
  if (target === workspace || target.startsWith(`${workspace}/`)) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "Compilation report export must be outside the selected workspace.",
    );
  }
  try {
    const info = await Deno.lstat(target).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    });
    if (info && (!info.isFile || info.isSymlink)) {
      throw new CompilerFailure(
        "COMPILER_INVALID_INVOCATION",
        "Compilation report export destination must be absent or a regular file.",
      );
    }
    const slash = target.lastIndexOf("/");
    const directory = slash < 1 ? "." : target.slice(0, slash);
    const temporary = await Deno.makeTempFile({
      dir: directory,
      prefix: ".sigil-report-",
      suffix: ".tmp",
    });
    try {
      await Deno.chmod(temporary, 0o600);
      const file = await Deno.open(temporary, { write: true, truncate: true });
      try {
        await file.write(
          new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`),
        );
        await file.sync();
      } finally {
        file.close();
      }
      await Deno.rename(temporary, target);
    } catch (error) {
      await Deno.remove(temporary).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof CompilerFailure) throw error;
    throw new CompilerFailure(
      "COMPILER_FAILED",
      `Could not export compilation report: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function absolute(path: string): string {
  return resolve(path).replaceAll("\\", "/").replace(/\/$/, "");
}
