/** Command-line interface for versioned Sigil 0.7 workspaces. @module */
import { type HelpTopic, parseArgs } from "./args.ts";
import {
  type CompilationEvent,
  type CompilationHistoryStore,
  type CompilationReport,
  type compile,
  CompilerFailure,
  FileCompilationHistoryStore,
  renderCompilationReportMarkdown,
  resolveCompilationProfile,
} from "@qoherent/sigil-compiler";
import { type CommandHandlerOptions, runCommand } from "./commands.ts";
import {
  EXIT_CANCELLED,
  EXIT_RUNTIME,
  EXIT_USAGE,
  exitCodeForDiagnostics,
} from "./exit.ts";
import { formatResult } from "./formatters.ts";
import metadata from "../deno.json" with { type: "json" };
import { compilationCacheDirectory } from "./fs-adapter.ts";
import { compileWithBundledAdapters } from "./compiler-adapters.ts";

const HELP: Readonly<Record<HelpTopic, string>> = {
  root: `Usage: sigil <command> [options]

Commands:
  skill             List or install bundled agent skills
  init              Create a workspace configuration
  version           Report workspace and contract versions
  parse             Parse one Sigil file
  check             Report workspace diagnostics
  fmt               Format selected Sigil source
  glossary          Inspect reviewed glossary terms and occurrences
  graph             Report the component and import graph
  context           Return context for a component or file
  retrieve          Select deterministic purpose-specific context
  compile           Evaluate Sigil until red, yellow, or green
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
  compile:
    `Usage: sigil compile [stage] [path] [--component <name> | --file <file> [--position <line:column>] | --directory <dir>] [--exact-target] [options]

Options:
  stage               Run one stage and its dependency closure
  --component <name>  Compile one component
  --file <file>       Compile components represented by one file
  --position <value>  Select the component enclosing one-based line:column
  --profile <name>    Select a compilation profile (default: standard)
  --focus <value>     Evaluate design readiness or implementation alignment
  --no-cache          Do not consult compilation history
  --output <file>     Export the selected completed representation
  --format <value>    Output text, jsonl, or markdown
  --root <path>       Use an explicit workspace root
  --quiet             Suppress human output
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

export interface CliRunOptions extends CommandHandlerOptions {
  readonly compiler?: typeof compile;
  readonly compilationHistory?: CompilationHistoryStore;
  readonly onCompilationEvent?: (line: string) => void | Promise<void>;
  readonly onCompilationProgress?: (line: string) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

/**
 * @sigil implements packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
 * @sigil implements packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade interface,logic,constraints,cases
 * @sigil uses packages/compiler/src/report-markdown.sigil::SigilCompilationReportMarkdown::CompilationReportMarkdown interface
 */
export async function runCli(
  argv: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  let compilationEvents: CompilationEvent[] | undefined;
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
    if (parsed.request.command === "compile") {
      const events: CompilationEvent[] = [];
      compilationEvents = events;
      const compileWorkspace = options.compiler ?? compileWithBundledAdapters;
      // Every selector is an affected-scope seed. The compiler resolves the
      // boundary that actually covers it unless --exact-target is given.
      const target = parsed.request.component
        ? {
          kind: "component" as const,
          componentName: parsed.request.component,
        }
        : parsed.request.file && parsed.request.position
        ? {
          kind: "location" as const,
          filePath: parsed.request.file,
          ...parsed.request.position,
        }
        : parsed.request.file
        ? { kind: "file" as const, filePath: parsed.request.file }
        : parsed.request.directory
        ? {
          kind: "directory" as const,
          directoryPath: parsed.request.directory,
        }
        : { kind: "workspace" as const };
      const workspacePath = parsed.request.root ?? parsed.request.path ??
        Deno.cwd();
      const report = await compileWorkspace(
        workspacePath,
        target,
        parsed.request.profile ?? await resolveCompilationProfile(
          workspacePath,
          parsed.request.agent,
        ),
        {
          exactTarget: parsed.request.exactTarget,
          requestedStage: parsed.request.stage,
          focus: parsed.request.focus,
          noHistory: parsed.request.noCache,
          history: parsed.request.noCache
            ? undefined
            : options.compilationHistory ??
              (options.compiler ? undefined : new FileCompilationHistoryStore(
                compilationCacheDirectory(),
              )),
          output: parsed.request.output,
          reportExportRepresentation: parsed.request.format === "markdown"
            ? "markdown"
            : "json",
          signal: options.signal,
          onEvent: async (event) => {
            events.push(event);
            if (
              parsed.request.format === "jsonl" &&
              options.onCompilationEvent
            ) {
              await options.onCompilationEvent(`${JSON.stringify(event)}\n`);
            } else if (
              parsed.request.format !== "jsonl" &&
              options.onCompilationProgress
            ) {
              const progress = compilationProgress(event);
              if (progress) await options.onCompilationProgress(progress);
            }
          },
        },
      );
      const stdout = parsed.request.quiet
        ? ""
        : parsed.request.format === "jsonl"
        ? options.onCompilationEvent
          ? ""
          : events.map((event) => JSON.stringify(event)).join("\n") + "\n"
        : parsed.request.format === "markdown"
        ? renderCompilationReportMarkdown(report)
        : formatCompilation(report);
      return {
        exitCode: report.status === "green" ? 0 : 1,
        stdout,
        stderr: "",
      };
    }
    const result = await runCommand(parsed.request, options);
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
    const bufferedJsonl = parsed.kind === "ok" &&
        parsed.request.command === "compile" &&
        parsed.request.format === "jsonl" &&
        !options.onCompilationEvent && compilationEvents
      ? compilationEvents.map((event) => JSON.stringify(event)).join("\n") +
        (compilationEvents.length ? "\n" : "")
      : "";
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        exitCode: EXIT_CANCELLED,
        stdout: bufferedJsonl,
        stderr: "Compilation cancelled.\n",
      };
    }
    return {
      // A rejected selector is correctable input, not an infrastructure
      // failure, so it exits as usage rather than runtime.
      exitCode: error instanceof CompilerFailure &&
          error.code === "COMPILER_INVALID_INVOCATION"
        ? EXIT_USAGE
        : EXIT_RUNTIME,
      stdout: bufferedJsonl,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  Deno.addSignalListener("SIGINT", cancel);
  const result = await runCli(Deno.args, {
    signal: controller.signal,
    onCompilationEvent: async (line) => {
      await Deno.stdout.write(new TextEncoder().encode(line));
    },
    onCompilationProgress: async (line) => {
      await Deno.stderr.write(new TextEncoder().encode(line));
    },
  });
  Deno.removeSignalListener("SIGINT", cancel);
  if (result.stdout) {
    await Deno.stdout.write(new TextEncoder().encode(result.stdout));
  }
  if (result.stderr) {
    await Deno.stderr.write(new TextEncoder().encode(result.stderr));
  }
  Deno.exit(result.exitCode);
}

function compilationProgress(event: CompilationEvent): string {
  if (event.type === "started") return "Compiling Sigil...\n";
  if (event.type === "stage-started") {
    return `  ${String(event.payload.stage)}...\n`;
  }
  return "";
}

function formatCompilation(report: CompilationReport): string {
  const lines = [
    `${report.status.toUpperCase()} ${
      report.componentNames.join(", ") || "workspace"
    }`,
  ];
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${
        diagnostic.range
          ? `:${diagnostic.range.start.line}:${diagnostic.range.start.column}`
          : ""
      } `
      : "";
    lines.push(
      `${diagnostic.lifecycle} ${diagnostic.severity} ${diagnostic.code}: ${location}${diagnostic.message}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
