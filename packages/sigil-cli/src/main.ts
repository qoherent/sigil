/** Command-line interface for versioned Sigil 1.0 workspaces. @module */
import { parseArgs } from "./args.ts";
import { runCommand } from "./commands.ts";
import { EXIT_RUNTIME, EXIT_USAGE, exitCodeForDiagnostics } from "./exit.ts";
import { formatResult } from "./formatters.ts";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runCli(argv: readonly string[]): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "usage-error") {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: `${parsed.message}\n`,
    };
  }

  try {
    const result = await runCommand(parsed.request);
    return {
      exitCode: exitCodeForDiagnostics(result.diagnostics),
      stdout: formatResult(result, parsed.request),
      stderr: "",
    };
  } catch (error) {
    return {
      exitCode: EXIT_RUNTIME,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

if (import.meta.main) {
  const result = await runCli(Deno.args);
  if (result.stdout) {
    await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  }
  if (result.stderr) {
    await Deno.stderr.write(new TextEncoder().encode(result.stderr));
  }
  Deno.exit(result.exitCode);
}
