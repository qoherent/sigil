/** Command-line interface for versioned Sigil 0.8 workspaces. @module */
import { type HelpTopic, parseArgs } from "./args.ts";
import { type CommandHandlerOptions, runCommand } from "./commands.ts";
import { EXIT_RUNTIME, EXIT_USAGE, exitCodeForDiagnostics } from "./exit.ts";
import { formatResult } from "./formatters.ts";
import metadata from "../deno.json" with { type: "json" };

const HELP: Readonly<Record<HelpTopic, string>> = {
  root: `Usage: sigil <command> [options]

Commands:
  skill             List or install bundled agent skills
  init              Create a workspace configuration
  version           Report workspace and contract versions
  parse             Parse one Sigil file
  export            Export structural Design JSON for direct sigilc use
  check             Report workspace diagnostics
  fmt               Format selected Sigil source
  glossary          Inspect reviewed glossary terms and occurrences
  graph             Report the component and import graph
  context           Return context for a component or file
  retrieve          Select deterministic purpose-specific context
  render            Render workspace documentation

Options:
  --help            Show this help
  --version         Show the sigil version
`,
  skill: `Usage: sigil skill <subcommand> [options]

Subcommands:
  list              List bundled agent skills
  install           Install bundled agent skills

Options:
  --help            Show this help
`,
  "skill-list": `Usage: sigil skill list [options]

Options:
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  "skill-install": `Usage: sigil skill install [options]

Options:
  --project         Install skills into the current repository
  --agent <value>   Install for codex, claude, opencode, pi, or all
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  init: `Usage: sigil init [path] [options]

Options:
  --name <value>    Set the workspace name
  --include <glob>  Include a source glob; may be repeated
  --exclude <glob>  Exclude a source glob; may be repeated
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  version: `Usage: sigil version [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  export: `Usage: sigil export design [path] [options]

Exports the complete discovered workspace as structural JSON on stdout.
Use sigilc directly with --frontend and optional --scope for semantic operations.

Options:
  --root <path>     Use an explicit workspace root
  --format json    JSON is the only output format
  --pretty         Pretty-print JSON output
  --help           Show this help
`,
  parse: `Usage: sigil parse <file> [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  check: `Usage: sigil check [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --show-locations  Add file path, line, and column to text diagnostics
  --help            Show this help
`,
  fmt: `Usage: sigil fmt [path] [options]

Options:
  --check           Report noncanonical source without writing
  --root <path>     Use an explicit workspace root
  --format <value>  Output json or text
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  glossary: `Usage: sigil glossary [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  graph: `Usage: sigil graph [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
  context:
    `Usage: sigil context [path] (--component <name> | --file <file>) [options]

Options:
  --component <name>  Select a component
  --file <file>       Select a Sigil file
  --include-dependents
                      Include direct importing-file context for --component
  --root <path>       Use an explicit workspace root
  --format <value>    Output json, text, or markdown
  --pretty            Pretty-print JSON output
  --quiet             Suppress command output
  --help              Show this help
`,
  retrieve:
    `Usage: sigil retrieve [path] (--component <name> | --file <file>) --purpose <purpose> [options]

Options:
  --component <name>  Select one exact component
  --file <file>       Select one Sigil file
  --purpose <value>   semantic, architecture, or implementation
  --max-evidence-bytes <n>  Keep the closest evidence within a byte budget
  --root <path>       Use an explicit workspace root
  --format <value>    Output json or markdown
  --pretty            Pretty-print JSON output
  --quiet             Suppress command output
  --help              Show this help
`,
  render: `Usage: sigil render [path] [options]

Options:
  --root <path>     Use an explicit workspace root
  --format <value>  Output json, text, or markdown
  --pretty          Pretty-print JSON output
  --quiet           Suppress command output
  --help            Show this help
`,
};

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * @sigil implements packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
 * @sigil implements packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 */
export async function runCli(
  argv: readonly string[],
  options: CommandHandlerOptions = {},
): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    return { exitCode: 0, stdout: HELP[parsed.helpTopic], stderr: "" };
  }
  if (parsed.kind === "cli-version") {
    return { exitCode: 0, stdout: `${metadata.version}\n`, stderr: "" };
  }
  if (parsed.kind === "usage-error") {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: `Error: ${parsed.message}\n\n${HELP[parsed.helpTopic]}`,
    };
  }

  try {
    const result = await runCommand(parsed.request, options);
    if (result.command === "export-design" && !result.bundle) {
      return {
        exitCode: exitCodeForDiagnostics(result.diagnostics) || 1,
        stdout: "",
        stderr: `${JSON.stringify({ diagnostics: result.diagnostics })}\n`,
      };
    }
    const formatDifference = result.command === "fmt" && result.check &&
      result.files.some((file) => file.status === "noncanonical");
    return {
      exitCode: formatDifference
        ? 1
        : exitCodeForDiagnostics(result.diagnostics),
      stdout: await formatResult(result, parsed.request),
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

export async function runMain(
  args: readonly string[] = Deno.args,
): Promise<never> {
  const result = await runCli(args);
  if (result.stdout) {
    await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  }
  if (result.stderr) {
    await Deno.stderr.write(new TextEncoder().encode(result.stderr));
  }
  Deno.exit(result.exitCode);
}

if (import.meta.main) await runMain();
