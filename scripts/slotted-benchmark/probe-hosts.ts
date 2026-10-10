/**
 * Host feasibility probe for the slotted benchmark's orchestrator design.
 *
 * For each host (Codex, Claude Code, Pi) this launches one orchestrator
 * process in a throwaway pass directory with the benchmark's orchestrator
 * settings and a tiny prompt. The orchestrator reads a staged stub SKILL.md,
 * runs the pinned `sigilc --version`, starts ONE fresh child that writes
 * `child.txt`, and reports back. The probe then records whether the child was
 * fresh, which model and reasoning effort it ran with, whether the host shows
 * that to the caller, which skill file was read, and the wall time.
 *
 * Live calls run one host at a time. This is a manual probe against real hosts,
 * not a test, and it does not build `sigilc`: it uses the pinned binary
 * from `packages/sigilc/target/debug` (or `--sigilc PATH`).
 */
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeHostStream,
  buildHostLaunch,
  defaultCodexAuthPath,
  defaultPiSubagentsEntry,
  type HostName,
  HOSTS,
  parseJsonLines,
  prepareCodexHome,
  removeCodexAuth,
} from "./hosts.ts";
import { settleWithin, signalOwnedProcess } from "./process.ts";

type Host = HostName;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_SIGIL_CLAIMS = join(
  REPO_ROOT,
  "packages/sigilc/target/debug/sigilc",
);

const SKILL_MARKER = "STAGED-SKILL-MARKER-4471";
const SECRET_WORD = "PLUM-7731";
const SKILL_STUB =
  `---\nname: sigil-compute-design\ndescription: probe stub\n---\nProbe stub SKILL.md. Marker: ${SKILL_MARKER}.\n`;
const CHILD_TASK =
  "Write the word OK to the file child.txt in your working directory. Then write to child-context.txt the secret word if you were told one earlier in this conversation, otherwise write NONE. Then reply DONE.";

const HELP = `Host probe: can each host orchestrate one fresh child?

  deno task slotted-benchmark:probe [--host codex|claude|pi]... [--effort LEVEL]
    [--child-effort LEVEL] [--codex-model M] [--claude-model M]
    [--claude-child-model M] [--pi-model PROVIDER/ID] [--pi-child-model PROVIDER/ID]
    [--timeout-ms N] [--out DIR] [--sigilc PATH]

Defaults: all hosts, run one at a time; effort medium, child effort low;
timeout 600000 ms per host. Scratch output goes to a new temp directory unless
--out is given.
`;

interface Options {
  hosts: Host[];
  effort: string;
  childEffort: string;
  models: Record<Host, string>;
  childModels: Record<Host, string>;
  timeoutMs: number;
  outDir: string | null;
  sigilc: string;
}

export interface HostProbeResult {
  readonly host: Host;
  /** ok: every check met. blocked: the host could not run (auth, credits). */
  readonly status: "ok" | "gap" | "blocked" | "timeout" | "failed";
  readonly wallMs: number;
  readonly hostVersion: string | null;
  readonly flags: readonly string[];
  readonly orchestrator: { model: string; effort: string };
  readonly child: {
    readonly wroteFile: boolean;
    readonly fresh: boolean | null;
    readonly freshEvidence: string[];
    readonly requestedModel: string;
    readonly requestedEffort: string;
    readonly observedModel: string | null;
    readonly observedEffort: string | null;
    readonly observedFrom: string | null;
  };
  readonly exposedToCaller: { model: boolean; effort: boolean };
  readonly skillsRead: readonly string[];
  readonly stagedSkillRead: boolean;
  readonly versionReported: boolean;
  readonly gaps: readonly string[];
  readonly notes: readonly string[];
  readonly passDir: string;
  readonly exitCode: number | null;
}

interface Launch {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly prompt: string;
  /** Flags to report, excluding the prompt. */
  readonly flags: readonly string[];
}

export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const outDir = options.outDir ?? await Deno.makeTempDir({
    prefix: "sigil-host-probe-",
  });
  await Deno.mkdir(outDir, { recursive: true });
  const results: HostProbeResult[] = [];
  // One host at a time: the service stalls under concurrency.
  for (const host of options.hosts) {
    const result = await probeHost(host, options, join(outDir, host));
    results.push(result);
    console.log(summaryLine(result));
  }
  const summary = { outDir, results };
  await Deno.writeTextFile(
    join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    hosts: [],
    effort: "medium",
    childEffort: "low",
    models: { codex: "gpt-6-luna", claude: "sonnet", pi: "xai/grok-4.6" },
    childModels: { codex: "", claude: "", pi: "" },
    timeoutMs: 600_000,
    outDir: null,
    sigilc: DEFAULT_SIGIL_CLAIMS,
  };
  const childOverride: Partial<Record<Host, string>> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}\n${HELP}`);
    switch (flag) {
      case "--host":
        if (!HOSTS.includes(value as Host)) {
          throw new Error(`Unknown host ${value}\n${HELP}`);
        }
        options.hosts.push(value as Host);
        break;
      case "--effort":
        options.effort = value;
        break;
      case "--child-effort":
        options.childEffort = value;
        break;
      case "--codex-model":
        options.models.codex = value;
        break;
      case "--claude-model":
        options.models.claude = value;
        break;
      case "--pi-model":
        options.models.pi = value;
        break;
      case "--claude-child-model":
        childOverride.claude = value;
        break;
      case "--pi-child-model":
        childOverride.pi = value;
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(value);
        if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
          throw new Error("--timeout-ms requires a positive integer");
        }
        break;
      case "--out":
        options.outDir = resolve(value);
        break;
      case "--sigilc":
        options.sigilc = resolve(value);
        break;
      default:
        throw new Error(`Unknown option ${flag}\n${HELP}`);
    }
  }
  if (options.hosts.length === 0) options.hosts = [...HOSTS];
  for (const host of HOSTS) {
    options.childModels[host] = childOverride[host] ?? options.models[host];
  }
  return options;
}

async function probeHost(
  host: Host,
  options: Options,
  hostDir: string,
): Promise<HostProbeResult> {
  const passDir = join(hostDir, "pass");
  const binDir = join(hostDir, "bin");
  await Deno.mkdir(join(passDir, "skills/sigil-compute-design"), {
    recursive: true,
  });
  await Deno.mkdir(binDir, { recursive: true });
  await Deno.writeTextFile(
    join(passDir, "skills/sigil-compute-design/SKILL.md"),
    SKILL_STUB,
  );
  await Deno.symlink(options.sigilc, join(binDir, "sigilc")).catch(
    async () => {
      await Deno.remove(join(binDir, "sigilc"));
      await Deno.symlink(options.sigilc, join(binDir, "sigilc"));
    },
  );
  const expectedVersion = await commandOutput(options.sigilc, [
    "--version",
  ]);
  // The Codex launch copies a credential into the host directory. It is
  // removed in the finally below, so a throw or a cancelled run never leaves it
  // in retained evidence.
  try {
    const launch = await buildLaunch(host, options, passDir, hostDir);
    await Deno.writeTextFile(join(hostDir, "prompt.txt"), launch.prompt);
    const stdoutPath = join(hostDir, "stdout.jsonl");
    const stderrPath = join(hostDir, "stderr.txt");
    const hostVersion = await commandOutput(launch.executable, ["--version"])
      .catch(() => null);

    const started = performance.now();
    const run = await runProcess(
      launch.executable,
      [...launch.args, launch.prompt],
      passDir,
      {
        ...launch.env,
        PATH: `${binDir}${delimiter}${Deno.env.get("PATH") ?? ""}`,
      },
      options.timeoutMs,
      stdoutPath,
      stderrPath,
    );
    const wallMs = Math.round(performance.now() - started);
    const events = parseJsonLines(await Deno.readTextFile(stdoutPath));
    const analysis = await analyzeHostStream(
      host,
      events,
      join(hostDir, "codex-home"),
    );
    const observedModel = analysis.childModels.join(",") || null;
    const observedEffort = analysis.childEfforts.join(",") || null;

    const childWrote = (await readTrimmed(join(passDir, "child.txt")))
      ?.toUpperCase() === "OK";
    const childContext = await readTrimmed(join(passDir, "child-context.txt"));
    const freshEvidence = [...analysis.freshEvidence];
    let fresh: boolean | null = null;
    if (childContext !== null) {
      const leaked = childContext.includes(SECRET_WORD);
      freshEvidence.push(
        leaked
          ? `child-context.txt leaked the parent's secret word`
          : `child-context.txt=${
            JSON.stringify(childContext)
          } (no parent secret)`,
      );
      fresh = !leaked && analysis.freshFlagOk !== false;
    }

    const stagedSkillRead = analysis.skillsRead.some((path) =>
      isStaged(path, passDir)
    );
    const finalText = analysis.finalText ?? "";
    const versionReported = finalText.includes(expectedVersion) ||
      finalText.includes(expectedVersion.replace(/^\S+\s+/, ""));

    const gaps: string[] = [...analysis.gaps];
    const notes: string[] = [...analysis.notes];
    if (!childWrote) gaps.push("child did not write child.txt with OK");
    if (fresh !== true) gaps.push("child freshness not confirmed");
    if (observedModel === null) {
      gaps.push("child model not observed anywhere");
    }
    if (observedEffort === null) {
      gaps.push("child effort not observed anywhere");
    }
    if (!analysis.exposedModel) {
      notes.push("child model is not visible in the host's stdout stream");
    }
    if (!analysis.exposedEffort) {
      notes.push("child effort is not visible in the host's stdout stream");
    }
    if (!stagedSkillRead) gaps.push("staged SKILL.md was not read");
    if (!versionReported) {
      gaps.push("orchestrator did not report the sigilc version");
    }

    let status: HostProbeResult["status"];
    if (run.timedOut) status = "timeout";
    else if (analysis.blockedReason) {
      status = "blocked";
      // The other checks cannot run, so they would only add noise.
      gaps.splice(
        0,
        gaps.length,
        `host could not run: ${analysis.blockedReason}`,
      );
    } else if (run.exitCode !== 0) status = "failed";
    else {status = childWrote && fresh === true && stagedSkillRead
        ? "ok"
        : "gap";}

    return {
      host,
      status,
      wallMs,
      hostVersion,
      flags: launch.flags,
      orchestrator: { model: options.models[host], effort: options.effort },
      child: {
        wroteFile: childWrote,
        fresh,
        freshEvidence,
        requestedModel: options.childModels[host],
        requestedEffort: options.childEffort,
        observedModel,
        observedEffort,
        observedFrom: analysis.observedFrom,
      },
      exposedToCaller: {
        model: analysis.exposedModel,
        effort: analysis.exposedEffort,
      },
      skillsRead: analysis.skillsRead,
      stagedSkillRead,
      versionReported,
      gaps,
      notes,
      passDir,
      exitCode: run.exitCode,
    };
  } finally {
    await removeCodexAuth(join(hostDir, "codex-home"));
  }
}

function orchestratorPrompt(spawnStep: string): string {
  return [
    "You are the probe orchestrator. Do these steps in order.",
    "1. Read skills/sigil-compute-design/SKILL.md (relative to your working directory) and note its marker.",
    "2. Run `sigilc --version` in the shell and note the output.",
    `3. Start exactly ONE fresh child sub-agent. ${spawnStep} Its task, verbatim: "${CHILD_TASK}"`,
    "4. Wait for the child, then reply with one line: marker, version, child result.",
    `Secret word, for you only: ${SECRET_WORD}.`,
    "",
  ].join("\n");
}

async function buildLaunch(
  host: Host,
  options: Options,
  passDir: string,
  hostDir: string,
): Promise<Launch> {
  let codexHome: string | undefined;
  if (host === "codex") {
    // A scratch CODEX_HOME keeps child rollouts (the only place Codex records
    // a child's model and effort) out of the user's session history. Auth is
    // copied in and removed again after the run.
    codexHome = join(hostDir, "codex-home");
    await prepareCodexHome(codexHome, defaultCodexAuthPath());
  }
  const launch = await buildHostLaunch({
    host,
    model: options.models[host],
    effort: options.effort,
    childModel: options.childModels[host],
    childEffort: options.childEffort,
    passDir,
    codexHome,
    allowedShell: ["sigilc"],
    childPrompt:
      "You are a careful file-writing helper. Do exactly what the task says.",
    piSubagentsEntry: defaultPiSubagentsEntry(),
  });
  return {
    executable: host,
    args: launch.args,
    env: { ...launch.env },
    prompt: orchestratorPrompt(launch.spawnInstruction),
    flags: launch.args.filter((arg) => arg !== "--"),
  };
}

function isStaged(path: string, passDir: string): boolean {
  const resolved = resolve(passDir, path);
  const real = (() => {
    try {
      return Deno.realPathSync(resolved);
    } catch {
      return resolved;
    }
  })();
  const realPass = Deno.realPathSync(passDir);
  return real.startsWith(realPass + "/") ||
    real === join(realPass, "skills/sigil-compute-design/SKILL.md");
}

function summaryLine(result: HostProbeResult): string {
  const child = result.child;
  const seen = child.observedModel
    ? `${child.observedModel}/${child.observedEffort ?? "effort-unobserved"}`
    : "unobserved";
  return [
    `${result.host.padEnd(6)} ${result.status.toUpperCase().padEnd(7)}`,
    `wall=${(result.wallMs / 1000).toFixed(1)}s`,
    `fresh=${child.fresh === null ? "?" : child.fresh ? "yes" : "NO"}`,
    `wrote=${child.wroteFile ? "yes" : "NO"}`,
    `child=${seen} (asked ${child.requestedModel}/${child.requestedEffort})`,
    `exposed=model:${result.exposedToCaller.model ? "yes" : "no"},effort:${
      result.exposedToCaller.effort ? "yes" : "no"
    }`,
    `skill=${
      result.skillsRead.map((p) => basename(dirname(p))).join("+") || "none"
    }${result.stagedSkillRead ? "(staged)" : "(NOT staged)"}`,
    ...(result.gaps.length > 0 ? [`gaps=[${result.gaps.join("; ")}]`] : []),
  ].join(" ");
}

interface ProcessRun {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

async function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  stdoutPath: string,
  stderrPath: string,
): Promise<ProcessRun> {
  const child = new Deno.Command(executable, {
    args: [...args],
    cwd,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();
  const drains = [
    child.stdout.pipeTo(
      (await Deno.open(stdoutPath, {
        write: true,
        create: true,
        truncate: true,
      })).writable,
    ),
    child.stderr.pipeTo(
      (await Deno.open(stderrPath, {
        write: true,
        create: true,
        truncate: true,
      })).writable,
    ),
  ];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void signalOwnedProcess(child, "SIGTERM");
    setTimeout(() => void signalOwnedProcess(child, "SIGKILL"), 2_000);
  }, timeoutMs);
  const status = await child.status;
  clearTimeout(timer);
  // A descendant may hold the pipes open after the host exits.
  if (!await settleWithin(Promise.all(drains), 1_000)) {
    await signalOwnedProcess(child, "SIGKILL");
    await settleWithin(Promise.all(drains), 1_000);
  }
  return { exitCode: status.code, timedOut };
}

async function commandOutput(
  executable: string,
  args: string[],
): Promise<string> {
  const output = await new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) {
    throw new Error(`${executable} ${args.join(" ")} failed`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function readTrimmed(path: string): Promise<string | null> {
  try {
    return (await Deno.readTextFile(path)).trim();
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return null;
    throw cause;
  }
}

if (import.meta.main) {
  main(Deno.args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
