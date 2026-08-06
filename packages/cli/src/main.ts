/** Command-line interface for versioned Sigil 0.7 workspaces. @module */
import { type HelpTopic, parseArgs } from "./args.ts";
import {
  type CompilationEvent,
  type CompilationHistoryStore,
  type CompilationReport,
  compile,
  FileCompilationHistoryStore,
  type SigilCompilationSessionFactory,
} from "@qoherent/sigil-compiler";
import {
  closeCompilationSession,
  evaluateCompilationSession,
  refreshCompilationSession,
  startCompilationSession,
} from "./compilation-sessions.ts";
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
  --root <path>       Use an explicit workspace root
  --format <value>    Output json or markdown
  --pretty            Pretty-print JSON output
  --quiet             Suppress command output
  --help              Show this help
`,
  compile:
    `Usage: sigil compile [stage] [path] [--component <name> | --file <file> [--position <line:column>]] [options]

Options:
  stage               Run one stage and its dependency closure
  --component <name>  Compile one component
  --file <file>       Compile components represented by one file
  --position <value>  Select the component enclosing one-based line:column
  --profile <name>    Select a compilation profile (default: standard)
  --focus <value>     Evaluate design readiness or implementation alignment
  --no-cache          Do not consult compilation history
  --output <file>     Export the authoritative report
  --format <value>    Output text or jsonl
  --root <path>       Use an explicit workspace root
  --quiet             Suppress human output
  --help              Show this help
`,
  "compile-session":
    `Usage: sigil compile session <start|evaluate|refresh|close> [options]\n`,
  "compile-session-start":
    `Usage: sigil compile session start [path] --focus design|implementation [--component <name> | --file <file>] [--profile <name>]\n`,
  "compile-session-evaluate":
    `Usage: sigil compile session evaluate <session-id> [--format jsonl]\n\nReads one CompilationProposal JSON object from standard input.\n`,
  "compile-session-refresh":
    `Usage: sigil compile session refresh <session-id>\n`,
  "compile-session-close": `Usage: sigil compile session close <session-id>\n`,
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
  readonly sessionFactory?: SigilCompilationSessionFactory;
  readonly readStdin?: () => Promise<string>;
}

/**
 * @sigil implements packages/cli/_module.sigil::SigilCli::CliInvocation interface,logic,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::StructuredOutput interface,constraints
 * @sigil implements packages/cli/_module.sigil::SigilCli::ExitStatus constraints,cases
 * @sigil implements packages/cli/_module.sigil::SigilCli::CompilationFacade interface,logic,constraints,cases
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
    if (parsed.request.command === "compile-session") {
      const request = parsed.request;
      if (request.action === "start") {
        const target = request.component
          ? { kind: "component" as const, name: request.component }
          : request.file
          ? { kind: "file" as const, filePath: request.file }
          : { kind: "workspace" as const };
        const result = await startCompilationSession(
          request.root ?? request.path ?? Deno.cwd(),
          target,
          request.profile ?? "standard",
          request.focus!,
          { factory: options.sessionFactory },
        );
        return {
          exitCode: 0,
          stdout: request.quiet ? "" : `${JSON.stringify(result)}\n`,
          stderr: "",
        };
      }
      if (request.action === "evaluate") {
        const events: CompilationEvent[] = [];
        const report = await evaluateCompilationSession(
          request.sessionIdentity!,
          {
            readStdin: options.readStdin,
            signal: options.signal,
            onEvent: async (event) => {
              events.push(event);
              if (request.format === "jsonl" && options.onCompilationEvent) {
                await options.onCompilationEvent(`${JSON.stringify(event)}\n`);
              }
            },
          },
        );
        const stdout = request.quiet
          ? ""
          : request.format === "jsonl"
          ? options.onCompilationEvent
            ? ""
            : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
          : formatCompilation(report);
        return {
          exitCode: report.status === "green" ? 0 : 1,
          stdout,
          stderr: "",
        };
      }
      if (request.action === "refresh") {
        const result = await refreshCompilationSession(
          request.sessionIdentity!,
        );
        return {
          exitCode: 0,
          stdout: request.quiet ? "" : `${JSON.stringify(result)}\n`,
          stderr: "",
        };
      }
      await closeCompilationSession(request.sessionIdentity!);
      return {
        exitCode: 0,
        stdout: request.quiet ? "" : `${
          JSON.stringify({
            sessionIdentity: request.sessionIdentity,
            closed: true,
          })
        }\n`,
        stderr: "",
      };
    }
    if (parsed.request.command === "compile") {
      const events: CompilationEvent[] = [];
      compilationEvents = events;
      const compileWorkspace = options.compiler ?? compile;
      const target = parsed.request.component
        ? { kind: "component" as const, name: parsed.request.component }
        : parsed.request.file && parsed.request.position
        ? {
          kind: "location" as const,
          filePath: parsed.request.file,
          ...parsed.request.position,
        }
        : parsed.request.file
        ? { kind: "file" as const, filePath: parsed.request.file }
        : { kind: "workspace" as const };
      const report = await compileWorkspace(
        parsed.request.root ?? parsed.request.path ?? Deno.cwd(),
        target,
        {
          profile: parsed.request.profile,
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
      stdout: formatResult(result, parsed.request),
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
      exitCode: EXIT_RUNTIME,
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
