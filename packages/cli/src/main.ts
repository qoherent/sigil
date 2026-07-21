/** Command-line interface for versioned Sigil 0.2 workspaces. @module */
import { parseArgs } from "./args.ts";
import { type CommandHandlerOptions, runCommand } from "./commands.ts";
import { EXIT_RUNTIME, EXIT_USAGE, exitCodeForDiagnostics } from "./exit.ts";
import { formatResult } from "./formatters.ts";
import metadata from "../deno.json" with { type: "json" };

const HELP = `Usage: sigil <command> [path] [options]

Commands:
  skill list        List bundled agent skills
  skill install     Install bundled skills globally (use --project for this repository)
  init [path]       Create a workspace configuration
  version [path]    Report workspace and contract versions
  parse <file>      Parse one Sigil file
  check [path]      Report workspace diagnostics
  graph [path]      Report the component and import graph
  context [path]    Return context for a component or file
  render [path]     Render workspace documentation

Options:
  --help            Show this help
  --version         Show the sigil version
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --project         Install skills into the current repository
  --agent <value>   Install for codex, claude, opencode, pi, or all
`;

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliRunOptions = CommandHandlerOptions;

export async function runCli(
  argv: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    return { exitCode: 0, stdout: HELP, stderr: "" };
  }
  if (parsed.kind === "cli-version") {
    return { exitCode: 0, stdout: `${metadata.version}\n`, stderr: "" };
  }
  if (parsed.kind === "usage-error") {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: `${parsed.message}\n`,
    };
  }

  try {
    const result = await runCommand(parsed.request, options);
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
