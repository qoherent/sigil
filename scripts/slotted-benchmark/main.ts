import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBatch, runBatch, validateSelections } from "./batch.ts";
import type { AgentName } from "./agents.ts";
import { writeReport } from "./report.ts";

const DEFAULT_OUTPUT = fileURLToPath(
  new URL("../../analyze-demo/slotted-runs/benchmarks/", import.meta.url),
);

export const HELP = `Slotted interpretation benchmark

Run a batch:
  deno task slotted-benchmark run --agent claude:MODEL --agent codex:MODEL --passes 3 [--action design|implementation] [--variant clean|planted] [--out DIR] [--timeout-ms N] [--reasoning LEVEL] [--codex-auth FILE] [--pi-subagents FILE]

Rebuild a report without launching an agent:
  deno task slotted-benchmark report DIR

Each --agent selects one coding agent and requested model. Repeat it for more combinations.
Each pass runs one orchestrator process that carries out sigil-compute-design's whole-design
action in its own pass directory; the benchmark then runs the linked check itself and
scores the planted problems from that report. --timeout-ms bounds one whole pass (default
7200000). --reasoning sets the reasoning effort of the orchestrator and every child.
--codex-auth names the Codex auth file copied into each pass's scratch CODEX_HOME
(default ~/.codex/auth.json). --pi-subagents names the pi-subagents extension entry
(default ~/.pi/agent/npm/node_modules/pi-subagents/index.js); Pi support is untested live.
The batch keeps each pass directory, raw host events, the linked report, and the generated
report under analyze-demo/slotted-runs/benchmarks/ by default.
`;

export interface CommandDependencies {
  /** Test and diagnostic override; normal CLI use resolves the installed agents. */
  readonly agentExecutables?: Partial<Record<AgentName, string>>;
  readonly signal?: AbortSignal;
}

export interface CommandResult {
  readonly batchDir: string;
  readonly reportPath: string;
  readonly scheduled: number;
  readonly valid: number;
  readonly failed: number;
  readonly interrupted: number;
  readonly unfinished: number;
}

export async function executeCommand(
  args: readonly string[],
  dependencies: CommandDependencies = {},
): Promise<CommandResult> {
  const [command, ...tail] = args;
  if (command === "report") {
    if (tail.length !== 1) {
      throw new Error("Usage: slotted-benchmark report DIR");
    }
    const batchDir = resolve(tail[0]);
    const reportPath = await writeReport(batchDir);
    const { records } = await readBatch(batchDir);
    return summarize(batchDir, reportPath, records);
  }
  if (command !== "run") throw new Error(HELP);
  const selections: { agent: string; model: string }[] = [];
  let action: "design" | "implementation" = "design";
  let variant: "clean" | "planted" = "clean";
  let passes: number | null = null;
  let outputDir: string | null = null;
  let timeoutMs = 7_200_000;
  let reasoning: string | undefined;
  let codexAuthPath: string | undefined;
  let piSubagentsEntry: string | undefined;
  for (let index = 0; index < tail.length; index += 2) {
    const flag = tail[index];
    const value = tail[index + 1];
    if (
      !value ||
      ![
        "--action",
        "--variant",
        "--agent",
        "--passes",
        "--out",
        "--timeout-ms",
        "--reasoning",
        "--codex-auth",
        "--pi-subagents",
      ].includes(flag)
    ) {
      throw new Error(
        `Unknown or incomplete option: ${flag ?? "(none)"}\n${HELP}`,
      );
    }
    if (flag === "--action") {
      if (value !== "design" && value !== "implementation") {
        throw new Error("Action must be design or implementation");
      }
      action = value;
    } else if (flag === "--variant") {
      if (value !== "clean" && value !== "planted") {
        throw new Error("Variant must be clean or planted");
      }
      variant = value;
    } else if (flag === "--agent") {
      const colon = value.indexOf(":");
      if (colon < 0) throw new Error("Agent selection must be AGENT:MODEL");
      selections.push({
        agent: value.slice(0, colon),
        model: value.slice(colon + 1),
      });
    } else if (flag === "--passes") {
      if (passes !== null) {
        throw new Error("Pass count supplied more than once");
      }
      passes = Number(value);
    } else if (flag === "--out") {
      if (outputDir !== null) {
        throw new Error("Output directory supplied more than once");
      }
      outputDir = resolve(value);
    } else if (flag === "--reasoning") {
      reasoning = value;
    } else if (flag === "--codex-auth") {
      codexAuthPath = resolve(value);
    } else if (flag === "--pi-subagents") {
      piSubagentsEntry = resolve(value);
    } else {
      timeoutMs = Number(value);
    }
  }
  validateSelections(selections);
  if (!Number.isSafeInteger(passes) || passes === null || passes < 1) {
    throw new Error("--passes requires a positive integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("--timeout-ms requires a positive integer");
  }
  const destination = outputDir ?? join(
    DEFAULT_OUTPUT,
    `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${
      crypto.randomUUID().slice(0, 8)
    }`,
  );
  await runBatch({
    action,
    variant,
    selections,
    passes,
    outputDir: destination,
    timeoutMs,
    reasoning,
    codexAuthPath,
    piSubagentsEntry,
    agentExecutables: dependencies.agentExecutables,
    signal: dependencies.signal,
  });
  const reportPath = await writeReport(destination);
  const { records } = await readBatch(destination);
  return summarize(destination, reportPath, records);
}

function summarize(
  batchDir: string,
  reportPath: string,
  records: readonly { status: string }[],
): CommandResult {
  return {
    batchDir,
    reportPath,
    scheduled: records.length,
    valid: records.filter((record) => record.status === "valid").length,
    failed:
      records.filter((record) =>
        record.status === "failed" || record.status === "invalid"
      ).length,
    interrupted: records.filter((record) => record.status === "interrupted")
      .length,
    unfinished:
      records.filter((record) =>
        record.status === "pending" || record.status === "running"
      ).length,
  };
}

if (import.meta.main) {
  if (
    Deno.args.length === 0 || Deno.args[0] === "--help" || Deno.args[0] === "-h"
  ) {
    console.log(HELP);
  } else {
    const controller = new AbortController();
    const abort = () => controller.abort();
    Deno.addSignalListener("SIGINT", abort);
    Deno.addSignalListener("SIGTERM", abort);
    try {
      const result = await executeCommand(Deno.args, {
        signal: controller.signal,
      });
      console.log(
        `Report: ${result.reportPath}\nScheduled: ${result.scheduled}; valid: ${result.valid}; failed or invalid: ${result.failed}; interrupted: ${result.interrupted}; unfinished: ${result.unfinished}`,
      );
    } catch (cause) {
      console.error(String(cause));
      Deno.exitCode = 1;
    } finally {
      Deno.removeSignalListener("SIGINT", abort);
      Deno.removeSignalListener("SIGTERM", abort);
    }
  }
}
