/**
 * The design-quality benchmark's command line. It has `sigil-write` author a
 * design from a benchmark's requirement file and measures the result against
 * the reference design.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { errorMessage } from "../agent-runner/files.ts";
import { parseHostName } from "../agent-runner/hosts.ts";
import {
  type Environment,
  referenceDirFor,
  rereadBatch,
  rereadReference,
  runBatch,
} from "./batch.ts";
import { measureDesign, requirementInputs, sigilcIdentity } from "./measure.ts";
import { pinReader } from "./reader.ts";
import {
  benchmarkNamed,
  defaultSigilc,
  PACKAGE_DIR,
  referenceFor,
  referenceStorePaths,
  REPO_ROOT,
  type WriterIdentity,
} from "./records.ts";
import { buildReport, renderMeasureReport } from "./report.ts";

export const COMMANDS = [
  "run",
  "measure",
  "reread",
  "report",
  "pin-reader",
] as const;
export type CommandName = typeof COMMANDS[number];

export const HELP = `Usage: bun run main.ts COMMAND [OPTIONS]

Commands:
  run         Regenerate designs: run --benchmark NAME --agent AGENT:MODEL...
              --reasoning LEVEL --passes N [--out DIR] [--timeout-ms MS]
              [--slotted-workspace DIR] [--sigil PATH] [--sigilc PATH]
  measure     Score a committed design and its stored readings without a
              model: measure --benchmark NAME [--root DIR --store DIR]
              [--coverage FILE] [--sigilc PATH] [--json] [--out FILE]
  reread      Take new claims readings on stored designs, and with --coverage
              new coverage readings too: reread BATCH_DIR [--coverage], or
              reread reference [--list NAME] [--coverage] [--out DIR], which
              writes a new reference store and never the committed one
  report      Re-measure listed batches with the current sigilc and write one
              table per measure beside the reference: report DIR...
              [--sigilc PATH] [--out FILE]
  pin-reader  Pin the reader of every claims and coverage reading: freeze its
              skills beside the reference store and write reader.json:
              pin-reader --agent AGENT:MODEL --reasoning LEVEL [--list NAME]
              [--force]

run, reread and pin-reader also take --codex-auth FILE and --pi-subagents PATH
where they start a host. --timeout-ms bounds one stage (default one hour).

Benchmarks live in benchmarks/<name>/requirement.md. Evidence goes under
.benchmarks/ at the repository root.
`;

/** What every command may use besides its arguments. */
export interface CommandContext {
  /** Cancels a running batch; set from SIGINT and SIGTERM. */
  readonly signal?: AbortSignal;
  /** Replaces where things are and how hosts start; tests use it. */
  readonly environment?: Environment;
}

export type CommandHandler = (
  args: readonly string[],
  context?: CommandContext,
) => Promise<void>;

/** Split `--name value` options and positional arguments. */
export function parseOptions(
  args: readonly string[],
  valued: readonly string[],
  flags: readonly string[] = [],
): { options: Map<string, string>; flags: Set<string>; positional: string[] } {
  const options = new Map<string, string>();
  const seen = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (flags.includes(arg)) {
      seen.add(arg);
    } else if (valued.includes(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (options.has(arg)) throw new Error(`${arg} is given twice`);
      options.set(arg, value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}\n\n${HELP}`);
    } else positional.push(arg);
  }
  return { options, flags: seen, positional };
}

/** The value of an option `command` cannot run without. */
function required(
  options: Map<string, string>,
  command: string,
  name: string,
  value: string,
): string {
  const given = options.get(name);
  if (!given) throw new Error(`${command} needs ${name} ${value}`);
  return given;
}

async function emit(text: string, out: string | undefined): Promise<void> {
  if (out === undefined) {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, text);
}

export const measureCommand: CommandHandler = async (args) => {
  const { options, flags, positional } = parseOptions(
    args,
    ["--benchmark", "--root", "--store", "--coverage", "--sigilc", "--out"],
    ["--json"],
  );
  if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`);
  }
  const benchmark = required(options, "measure", "--benchmark", "NAME");
  const definition = benchmarkNamed(benchmark);
  const reference = referenceFor(definition.list);
  const referencePaths = referenceStorePaths(
    join(PACKAGE_DIR, reference.store),
  );
  const givenRoot = options.get("--root");
  if (givenRoot !== undefined && !options.has("--store")) {
    throw new Error("measure --root needs --store as well");
  }
  const root = givenRoot ?? join(REPO_ROOT, reference.root);
  const store = options.get("--store") ?? referencePaths.store;
  const coveragePath = options.get("--coverage") ??
    (givenRoot === undefined ? referencePaths.coverage : undefined);
  const sigilc = options.get("--sigilc") ?? defaultSigilc();
  const requirements = await requirementInputs(benchmark);
  const measures = await measureDesign({
    sigilc,
    root,
    store,
    coverage: coveragePath === undefined
      ? { reason: "no coverage reading given" }
      : { path: coveragePath },
    requirements,
  });
  await emit(
    flags.has("--json")
      ? `${JSON.stringify(measures, null, 2)}\n`
      : renderMeasureReport({
        benchmark,
        sigilc: await sigilcIdentity(sigilc),
        requirements,
        measures,
      }),
    options.get("--out"),
  );
};

export const reportCommand: CommandHandler = async (args, context) => {
  const { options, positional } = parseOptions(args, ["--sigilc", "--out"]);
  const text = await buildReport({
    batchDirs: positional,
    sigilc: options.get("--sigilc") ?? defaultSigilc(),
    references: context?.environment?.references,
  });
  await emit(text, options.get("--out"));
};

/** Every `--agent` value, and the other arguments in order. */
function takeRepeated(
  args: readonly string[],
  name: string,
): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name) {
      const value = args[++index];
      if (value === undefined) throw new Error(`${name} needs a value`);
      values.push(value);
    } else rest.push(args[index]!);
  }
  return { values, rest };
}

/** `AGENT:MODEL`; the model may itself hold colons. */
export function parseAgentModel(value: string): WriterIdentity {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) {
    throw new Error(`--agent takes AGENT:MODEL, not ${value}`);
  }
  return {
    agent: parseHostName(value.slice(0, at)),
    model: value.slice(at + 1),
  };
}

function positiveInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive whole number, not ${value}`);
  }
  return Number(value);
}

const HOST_OPTIONS = ["--codex-auth", "--pi-subagents", "--timeout-ms"];

/** Options that set an `Environment` path, in the order they apply. */
const ENVIRONMENT_OPTIONS = [
  ["--codex-auth", "codexAuthPath"],
  ["--pi-subagents", "piSubagentsEntry"],
  ["--sigil", "sigil"],
  ["--sigilc", "sigilc"],
  ["--slotted-workspace", "slottedWorkspace"],
] as const satisfies readonly (readonly [string, keyof Environment])[];

function hostEnvironment(
  options: Map<string, string>,
  context: CommandContext | undefined,
): Environment {
  const timeout = options.get("--timeout-ms");
  return {
    log: (line) => process.stderr.write(`${line}\n`),
    ...context?.environment,
    signal: context?.signal,
    ...(timeout ? { timeoutMs: positiveInteger("--timeout-ms", timeout) } : {}),
    ...Object.fromEntries(
      ENVIRONMENT_OPTIONS.filter(([flag]) => options.has(flag))
        .map(([flag, key]) => [key, options.get(flag)]),
    ) as Partial<Environment>,
  };
}

export const runCommand: CommandHandler = async (args, context) => {
  const agents = takeRepeated(args, "--agent");
  const { options, positional } = parseOptions(agents.rest, [
    "--benchmark",
    "--reasoning",
    "--passes",
    "--out",
    "--sigil",
    "--sigilc",
    "--slotted-workspace",
    ...HOST_OPTIONS,
  ]);
  if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`);
  }
  const benchmark = required(options, "run", "--benchmark", "NAME");
  const effort = required(options, "run", "--reasoning", "LEVEL");
  const passes = required(options, "run", "--passes", "N");
  if (agents.values.length === 0) {
    throw new Error("run needs at least one --agent AGENT:MODEL");
  }
  const result = await runBatch({
    ...hostEnvironment(options, context),
    benchmark,
    writers: agents.values.map(parseAgentModel),
    effort,
    passes: positiveInteger("--passes", passes),
    out: options.get("--out"),
  });
  const count = (status: string) =>
    result.records.filter((record) => record.stages.coverage.status === status)
      .length;
  process.stdout.write(
    `Batch: ${result.batchDir}\nReport: ${result.reportPath}${
      result.reportError ? ` (not built: ${result.reportError})` : ""
    }\nPasses: ${result.records.length}; read to the end: ${count("done")}\n`,
  );
};

export const rereadCommand: CommandHandler = async (args, context) => {
  const { options, flags, positional } = parseOptions(
    args,
    ["--list", "--out", "--sigilc", "--slotted-workspace", ...HOST_OPTIONS],
    ["--coverage"],
  );
  if (positional.length !== 1) {
    throw new Error("reread needs one BATCH_DIR, or reference");
  }
  const environment = hostEnvironment(options, context);
  const coverage = flags.has("--coverage");
  if (positional[0] === "reference") {
    const result = await rereadReference({
      ...environment,
      list: options.get("--list"),
      coverage,
      out: options.get("--out"),
    });
    const store = referenceStorePaths(result.referenceDir);
    process.stdout.write(
      [
        `Wrote new ${result.list} reference readings to ${result.outDir}`,
        `Claims: ${result.state ?? "unknown"}, ${
          result.unreadUnits ?? "unknown"
        } unread units, guidance fingerprint ${result.readings.guidanceFingerprint}, vocabulary generation ${result.readings.vocabularyGeneration}`,
        result.coverage
          ? `Coverage: ${result.coverage.answered} answered, ${result.coverage.none} none, ${result.coverage.notRead} not read`
          : "Coverage: not reread",
        ...(result.deniedToolCalls.length > 0
          ? [`Claims reader: ${result.deniedToolCalls.length} tool call(s) refused, its readings were still taken:`, ...result.deniedToolCalls.map((call) => `  ${call}`)]
          : []),
        "",
        "The committed reference store was not changed. After reviewing the new",
        "readings, copy them in:",
        "",
        `  rm -rf ${store.store}`,
        `  cp -R ${join(result.outDir, "store")} ${store.store}`,
        `  cp ${join(result.outDir, "readings.json")} ${store.readings}`,
        ...(result.coverage || coverage
          ? [`  cp ${join(result.outDir, "coverage.json")} ${store.coverage}`]
          : []),
        "",
      ].join("\n"),
    );
    return;
  }
  if (options.has("--list") || options.has("--out")) {
    throw new Error("--list and --out apply to reread reference only");
  }
  const result = await rereadBatch({
    ...environment,
    batchDir: positional[0]!,
    coverage,
  });
  process.stdout.write(
    `Reread ${result.reread.length} passes of ${result.batchDir}${
      result.skipped.length
        ? `; left ${
          result.skipped.map((entry) => `${entry.id} (${entry.reason})`)
            .join(", ")
        }`
        : ""
    }\nReport: ${result.reportPath}${
      result.reportError ? ` (not built: ${result.reportError})` : ""
    }\n`,
  );
};

export const pinReaderCommand: CommandHandler = async (args, context) => {
  const { options, flags, positional } = parseOptions(
    args,
    ["--agent", "--reasoning", "--list"],
    ["--force"],
  );
  if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`);
  }
  const agent = required(options, "pin-reader", "--agent", "AGENT:MODEL");
  const effort = required(options, "pin-reader", "--reasoning", "LEVEL");
  const { agent: name, model } = parseAgentModel(agent);
  const environment = context?.environment ?? {};
  const reference = await referenceDirFor(environment, options.get("--list"));
  const reader = await pinReader({
    referenceDir: reference.dir,
    skillsDir: environment.skillsDir ?? join(REPO_ROOT, "skills"),
    agent: name,
    model,
    effort,
    force: flags.has("--force"),
  });
  process.stdout.write(
    `Pinned ${reader.agent}:${reader.model} at ${reader.effort} for ${reference.list} in ${
      referenceStorePaths(reference.dir).reader
    }\nNext: reread reference --coverage, then copy its output into ${reference.dir}\n`,
  );
};

export const HANDLERS: Record<CommandName, CommandHandler> = {
  run: runCommand,
  measure: measureCommand,
  reread: rereadCommand,
  report: reportCommand,
  "pin-reader": pinReaderCommand,
};

export async function executeCommand(
  args: readonly string[],
  handlers: Partial<Record<CommandName, CommandHandler>> = HANDLERS,
  context?: CommandContext,
): Promise<void> {
  const [command, ...tail] = args;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
  const handler = handlers[command as CommandName];
  if (handler === undefined) {
    throw new Error(`No handler for the ${command} command`);
  }
  await handler(tail, context);
}

if (import.meta.main) {
  // A first SIGINT or SIGTERM cancels the batch: the active stage is recorded
  // as interrupted and a report is still written. A second one exits at once.
  const controller = new AbortController();
  const abort = () => {
    if (controller.signal.aborted) process.exit(130);
    process.stderr.write("Cancelling: finishing the records and the report\n");
    controller.abort();
  };
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    await executeCommand(process.argv.slice(2), HANDLERS, {
      signal: controller.signal,
    });
  } catch (cause) {
    process.stderr.write(`${errorMessage(cause)}\n`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
