/**
 * Orchestrator and child launch settings for each host, and the readers that
 * recover what each host recorded about its children.
 *
 * The benchmark's passes (`agents.ts`) and the host probe
 * (`probe-hosts.ts`) share this module, so the settings the probe verified live
 * are the settings a pass runs with.
 *
 * Verified live by the host probe: Codex (0.161) and Claude Code. NOT verified live: Pi
 * (0.87 with pi-subagents 0.70.1). The xAI provider answered 403 out of credits,
 * so the Pi settings below were written from the pi-subagents documentation and
 * have never been run against a real model.
 */
import { join, resolve } from "node:path";

export type HostName = "codex" | "claude" | "pi";
export const HOSTS: readonly HostName[] = ["codex", "claude", "pi"];

export type JsonObject = Record<string, unknown>;

/** The name of the child agent every host is told to start. */
export const CHILD_AGENT = "interpreter";

export const DEFAULT_CHILD_PROMPT =
  "You are a fresh interpreter child. Do exactly the task you are handed: read only the files it names, write your answer to the file it names, and write nothing else.";

export interface HostSettings {
  readonly host: HostName;
  readonly model: string;
  /** Reasoning effort of the orchestrator. Absent: the host's own default. */
  readonly effort?: string;
  readonly childModel: string;
  /** Reasoning effort of every child. Absent: the host's own default. */
  readonly childEffort?: string;
  /** The orchestrator's working directory. */
  readonly passDir: string;
  /** Codex: a scratch CODEX_HOME that already holds the auth file. */
  readonly codexHome?: string;
  /** Codex: where the host writes its last message. */
  readonly lastMessagePath?: string;
  /** Claude Code: shell commands the orchestrator may run, by program name. */
  readonly allowedShell: readonly string[];
  /** Claude Code and Pi: the child agent's system prompt. */
  readonly childPrompt: string;
  /** Pi: the pi-subagents extension entry loaded with `-e`. */
  readonly piSubagentsEntry: string;
}

export interface HostLaunch {
  /** Every argument except the prompt, which follows them. */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** The sentence that tells the orchestrator how this host starts a child. */
  readonly spawnInstruction: string;
  readonly isolationLimits: readonly string[];
}

/** The default pi-subagents entry of a Pi install. Reads HOME on demand. */
export function defaultPiSubagentsEntry(): string {
  let home = "";
  try {
    home = Deno.env.get("HOME") ?? "";
  } catch { /* Environment access may be denied; the caller passes a path. */ }
  return join(home, ".pi/agent/npm/node_modules/pi-subagents/index.js");
}

/** The default Codex auth file. Reads HOME on demand. */
export function defaultCodexAuthPath(): string {
  let home = "";
  try {
    home = Deno.env.get("HOME") ?? "";
  } catch { /* Environment access may be denied; the caller passes a path. */ }
  return join(home, ".codex/auth.json");
}

/**
 * A scratch CODEX_HOME. Codex records each child's model and effort only in
 * its own rollout files, so a pass keeps the home (without credentials) as
 * evidence. The auth file is copied in and must be removed with
 * `removeCodexAuth` once the run ends.
 */
export async function prepareCodexHome(
  codexHome: string,
  authPath: string,
): Promise<void> {
  await Deno.mkdir(codexHome, { recursive: true });
  await Deno.copyFile(authPath, join(codexHome, "auth.json"));
}

export async function removeCodexAuth(codexHome: string): Promise<void> {
  try {
    await Deno.remove(join(codexHome, "auth.json"));
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
}

export async function buildHostLaunch(
  settings: HostSettings,
): Promise<HostLaunch> {
  const passDir = resolve(settings.passDir);
  switch (settings.host) {
    case "codex": {
      if (!settings.codexHome) {
        throw new Error("Codex needs a scratch CODEX_HOME");
      }
      // No `--ephemeral`: an ephemeral run records neither the child's model
      // nor its effort anywhere. `skip_host_skill_discovery` keeps Codex from
      // reading the sigil-compute installed in ~/.agents/skills instead of the
      // staged copy. The multi-agent effort key is
      // `agents.default_subagent_reasoning_effort`.
      const args = [
        "exec",
        "--json",
        "--ignore-user-config",
        "--ignore-rules",
        "--enable",
        "skip_host_skill_discovery",
        "--sandbox",
        "workspace-write",
        "-C",
        passDir,
        "--skip-git-repo-check",
        "--model",
        settings.model,
        ...(settings.effort
          ? ["-c", `model_reasoning_effort="${settings.effort}"`]
          : []),
        ...(settings.childEffort
          ? [
            "-c",
            `agents.default_subagent_reasoning_effort="${settings.childEffort}"`,
          ]
          : []),
        ...(settings.lastMessagePath
          ? ["--output-last-message", settings.lastMessagePath]
          : []),
      ];
      return {
        args,
        env: { CODEX_HOME: resolve(settings.codexHome) },
        spawnInstruction:
          'Start each child with the spawn_agent tool and set fork_turns to "none" so it does not inherit this conversation.',
        isolationLimits: [
          "The workspace-write sandbox confines writes to the pass directory but may still read outside it.",
        ],
      };
    }
    case "claude": {
      const agents = {
        [CHILD_AGENT]: {
          description: "Fresh interpreter child",
          prompt: settings.childPrompt,
          tools: ["Read", "Glob", "Grep", "Write"],
          model: settings.childModel,
          ...(settings.childEffort ? { effort: settings.childEffort } : {}),
        },
      };
      // `--safe-mode` is deliberately absent: it disables `--agents`, so the
      // Agent tool then reports the child type as not found.
      // The prompt has the orchestrator run the pinned tool as
      // `./bin/sigil-claims`, so that exact command must be allowed as well.
      const shell = settings.allowedShell.flatMap((program) =>
        program === "ls"
          ? ["Bash(ls)", "Bash(ls *)"]
          : program === "sigil-claims"
          ? ["Bash(sigil-claims *)", "Bash(./bin/sigil-claims *)"]
          : [`Bash(${program} *)`]
      );
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        settings.model,
        ...(settings.effort ? ["--effort", settings.effort] : []),
        "--no-session-persistence",
        "--restricted",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "Bash,Read,Write,Glob,Grep,Agent",
        "--allowedTools",
        ...shell,
        "Read",
        "Write",
        "Glob",
        "Grep",
        "Agent",
        "--agents",
        JSON.stringify(agents),
        "--",
      ];
      return {
        args,
        env: {},
        spawnInstruction:
          `Start each child with the Agent tool and subagent_type "${CHILD_AGENT}".`,
        isolationLimits: [
          "Managed settings may still apply; the CLI's tool and shell allowlists are not an OS sandbox.",
          "The child effort is requested through the agent definition but is not echoed by the host, so it is unverified.",
        ],
      };
    }
    case "pi": {
      // UNTESTED LIVE: written from the pi-subagents documentation (the host probe could
      // not reach a Pi provider with credit).
      await Deno.mkdir(join(passDir, ".pi/agents"), { recursive: true });
      await Deno.writeTextFile(
        join(passDir, `.pi/agents/${CHILD_AGENT}.md`),
        [
          "---",
          `name: ${CHILD_AGENT}`,
          "description: Fresh interpreter child",
          "tools: read, write, grep, find, ls",
          `model: ${settings.childModel}`,
          ...(settings.childEffort
            ? [`thinking: ${settings.childEffort}`]
            : []),
          "systemPromptMode: replace",
          "inheritProjectContext: false",
          "inheritGlobalContext: false",
          "inheritSkills: false",
          "---",
          settings.childPrompt,
          "",
        ].join("\n"),
      );
      const args = [
        "--print",
        "--mode",
        "json",
        "--model",
        settings.model,
        ...(settings.effort ? ["--thinking", settings.effort] : []),
        "--no-session",
        "--no-context-files",
        "--no-extensions",
        "-e",
        settings.piSubagentsEntry,
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--approve",
        "--tools",
        "read,bash,subagent",
        "--",
      ];
      return {
        args,
        env: {},
        spawnInstruction:
          `Start each child with the subagent tool, agent "${CHILD_AGENT}", context "fresh" and async false.`,
        isolationLimits: [
          "Pi settings are untested live. The tool allowlists limit available tools, not OS-level file access.",
        ],
      };
    }
  }
}

/** What a host's own output shows about the orchestrator and its children. */
export interface HostAnalysis {
  finalText: string | null;
  skillsRead: string[];
  /** Every model any process of the run was served by, where the host says. */
  models: string[];
  /** The children's models and efforts, where the host exposes them. */
  childModels: string[];
  childEfforts: string[];
  /** Child sessions started, where the host shows them. */
  childCount: number | null;
  observedFrom: string | null;
  exposedModel: boolean;
  exposedEffort: boolean;
  freshEvidence: string[];
  /** false when the host's own call shows the child inherited the parent. */
  freshFlagOk: boolean | null;
  blockedReason: string | null;
  gaps: string[];
  notes: string[];
}

function emptyAnalysis(): HostAnalysis {
  return {
    finalText: null,
    skillsRead: [],
    models: [],
    childModels: [],
    childEfforts: [],
    childCount: null,
    observedFrom: null,
    exposedModel: false,
    exposedEffort: false,
    freshEvidence: [],
    freshFlagOk: null,
    blockedReason: null,
    gaps: [],
    notes: [],
  };
}

export async function analyzeHostStream(
  host: HostName,
  events: readonly JsonObject[],
  codexHome?: string,
): Promise<HostAnalysis> {
  switch (host) {
    case "codex":
      return await analyzeCodex(events, codexHome);
    case "claude":
      return analyzeClaude(events);
    case "pi":
      return analyzePi(events);
  }
}

async function analyzeCodex(
  events: readonly JsonObject[],
  codexHome?: string,
): Promise<HostAnalysis> {
  const base = emptyAnalysis();
  const actions: string[] = [];
  let finalText: string | null = null;
  for (const event of events) {
    const item = asRecord(event.item);
    if (!item) continue;
    if (item.type === "command_execution" && event.type === "item.started") {
      actions.push(String(item.command ?? ""));
    }
    if (item.type === "agent_message" && typeof item.text === "string") {
      finalText = item.text;
    }
  }
  base.finalText = finalText;
  base.skillsRead = skillPaths(actions);

  // Codex's stdout stream carries no child model or effort. Rollout files under
  // the scratch CODEX_HOME are the only record.
  const rollouts = codexHome
    ? await readRollouts(join(codexHome, "sessions"))
    : [];
  const parent = rollouts.find((r) => !r.isChild);
  const children = rollouts.filter((r) => r.isChild);
  base.models = unique(rollouts.map((r) => r.model));
  if (children.length > 0) {
    base.childCount = children.length;
    base.childModels = unique(children.map((r) => r.model));
    base.childEfforts = unique(children.map((r) => r.effort));
    base.observedFrom = "child rollouts in the scratch CODEX_HOME";
    // Exposure means a child's own model or effort shows in a collab item.
    const collab = events.map((e) => asRecord(e.item)).filter((item) =>
      item?.type === "collab_tool_call"
    ).map((item) => JSON.stringify(item));
    base.exposedModel = base.childModels.some((model) =>
      collab.some((text) => text.includes(model))
    );
    base.exposedEffort = collab.some((text) => /effort|reasoning/.test(text));
  } else if (codexHome) {
    base.childCount = 0;
    base.gaps.push("no child rollout found in the scratch CODEX_HOME");
  }
  if (parent) {
    const spawns = parent.calls.filter((c) => c.name === "spawn_agent");
    if (spawns.length > 0) {
      base.freshEvidence.push(
        `spawn_agent fork_turns=${
          unique(spawns.map((s) => s.forkTurns ?? "(unset)")).join(",")
        }`,
      );
      base.freshFlagOk = spawns.every((s) => s.forkTurns === "none");
    } else {
      base.gaps.push("orchestrator never called spawn_agent");
    }
    base.notes.push(
      `orchestrator ran ${parent.model}/${parent.effort} per its own rollout`,
    );
  }
  const error = events.find((e) => asRecord(e.item)?.type === "error");
  if (error && !finalText) {
    base.blockedReason = String(asRecord(error.item)?.message ?? "error");
  }
  return base;
}

interface Rollout {
  readonly isChild: boolean;
  readonly model: string | null;
  readonly effort: string | null;
  readonly calls: { name: string; forkTurns: string | null }[];
}

async function readRollouts(dir: string): Promise<Rollout[]> {
  const rollouts: Rollout[] = [];
  async function walk(path: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(path));
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory) await walk(full);
      else if (entry.name.startsWith("rollout-")) {
        const lines = parseJsonLines(await Deno.readTextFile(full));
        let isChild = false;
        let model: string | null = null;
        let effort: string | null = null;
        const calls: Rollout["calls"] = [];
        for (const line of lines) {
          const payload = asRecord(line.payload);
          if (!payload) continue;
          if (line.type === "session_meta") {
            const source = asRecord(payload.source);
            isChild = source !== null && "subagent" in source;
          } else if (line.type === "turn_context" && model === null) {
            model = typeof payload.model === "string" ? payload.model : null;
            effort = typeof payload.effort === "string" ? payload.effort : null;
          } else if (
            line.type === "response_item" && payload.type === "function_call"
          ) {
            let forkTurns: string | null = null;
            try {
              const parsed = JSON.parse(String(payload.arguments));
              forkTurns = parsed.fork_turns === undefined
                ? null
                : String(parsed.fork_turns);
            } catch { /* Arguments are opaque when not valid JSON. */ }
            calls.push({ name: String(payload.name), forkTurns });
          }
        }
        rollouts.push({ isChild, model, effort, calls });
      }
    }
  }
  await walk(dir);
  return rollouts;
}

function analyzeClaude(events: readonly JsonObject[]): HostAnalysis {
  const base = emptyAnalysis();
  const actions: string[] = [];
  const agentCalls: JsonObject[] = [];
  const models = new Set<string>();
  const childModels = new Set<string>();
  const childSessions = new Set<string>();
  for (const event of events) {
    if (event.type === "result" && typeof event.result === "string") {
      base.finalText = event.result;
    }
    if (event.type !== "assistant") continue;
    const message = asRecord(event.message);
    const parent = event.parent_tool_use_id;
    if (!message) continue;
    const model = typeof message.model === "string" ? message.model : "";
    const served = event.is_api_error_message !== true && model.length > 0 &&
      !model.startsWith("<");
    if (served) models.add(model);
    if (parent) {
      if (served) childModels.add(model);
      childSessions.add(String(parent));
      continue;
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const record = asRecord(block);
      if (record?.type !== "tool_use") continue;
      actions.push(JSON.stringify(record.input));
      if (record.name === "Agent" || record.name === "Task") {
        const input = asRecord(record.input);
        if (input) agentCalls.push(input);
      }
    }
  }
  base.skillsRead = skillPaths(actions);
  base.models = [...models];
  if (agentCalls.length > 0) {
    base.freshEvidence.push(
      `Agent subagent_type=${
        unique(agentCalls.map((c) => String(c.subagent_type))).join(",")
      }; a custom agent has no parent transcript`,
    );
    base.freshFlagOk = agentCalls.every((c) => c.subagent_type === CHILD_AGENT);
  } else {
    base.gaps.push("orchestrator never called the Agent tool");
  }
  base.childCount = childSessions.size;
  if (childModels.size > 0) {
    base.childModels = [...childModels];
    base.observedFrom =
      "assistant events with parent_tool_use_id in the stream-json output";
    base.exposedModel = true;
  }
  // The agent definition's `effort` is validated by the host but never echoed,
  // so a Claude pass cannot observe a child's effort.
  base.exposedEffort = false;
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const agents = Array.isArray(init?.agents) ? init.agents : [];
  if (init && !agents.includes(CHILD_AGENT)) {
    base.gaps.push(
      `custom \`${CHILD_AGENT}\` agent absent from the init event`,
    );
  }
  return base;
}

// UNTESTED LIVE: the stream shapes below follow the Pi JSON mode and
// pi-subagents documentation.
function analyzePi(events: readonly JsonObject[]): HostAnalysis {
  const base = emptyAnalysis();
  const actions: string[] = [];
  const errors: string[] = [];
  const models = new Set<string>();
  const childKeys = new Set<string>();
  const subagentCalls: JsonObject[] = [];
  for (const event of events) {
    const message = asRecord(event.message);
    if (event.type === "message_end" && message?.role === "assistant") {
      if (typeof message.errorMessage === "string") {
        errors.push(message.errorMessage);
      }
      if (typeof message.model === "string" && message.model.length) {
        models.add(
          typeof message.provider === "string" && message.provider.length
            ? `${message.provider}/${message.model}`
            : message.model,
        );
      }
      const text = (Array.isArray(message.content) ? message.content : [])
        .map((part) => {
          const block = asRecord(part);
          return block?.type === "text" ? String(block.text ?? "") : "";
        }).join("");
      if (text) base.finalText = text;
      for (
        const part of Array.isArray(message.content) ? message.content : []
      ) {
        const block = asRecord(part);
        if (
          block && (block.type === "toolCall" || block.type === "tool_use")
        ) {
          const input = JSON.stringify(block.arguments ?? block.input ?? {});
          actions.push(input);
          if (block.name === "subagent") {
            const call = asRecord(block.arguments ?? block.input);
            if (call) subagentCalls.push(call);
          }
        }
      }
    }
    if (event.type === "tool_execution_end" && event.toolName === "subagent") {
      const text = JSON.stringify(event.result ?? {});
      for (
        const match of text.matchAll(/"(model|thinking|effort)":"([^"]+)"/g)
      ) {
        childKeys.add(`${match[1]}=${match[2]}`);
      }
    }
  }
  base.skillsRead = skillPaths(actions);
  base.models = [...models];
  base.childCount = subagentCalls.length;
  if (subagentCalls.length > 0) {
    base.freshEvidence.push(
      `subagent call context=${
        unique(subagentCalls.map((c) => JSON.stringify(c.context))).join(",")
      }`,
    );
    base.freshFlagOk = subagentCalls.every((c) => c.context === "fresh");
  }
  if (childKeys.size > 0) {
    base.childModels = [...childKeys].filter((k) => k.startsWith("model="))
      .map((k) => k.slice("model=".length));
    base.childEfforts = [...childKeys].filter((k) =>
      /^(thinking|effort)=/.test(k)
    ).map((k) => k.split("=")[1]);
    base.observedFrom = "subagent tool result in the JSON stream";
    base.exposedModel = base.childModels.length > 0;
    base.exposedEffort = base.childEfforts.length > 0;
  }
  if (errors.length > 0 && base.finalText === null) {
    base.blockedReason = errors[0];
  }
  return base;
}

/** Collect every `.../SKILL.md` path named in tool-call text. */
export function skillPaths(actions: readonly string[]): string[] {
  const found = new Set<string>();
  for (const action of actions) {
    for (const match of action.matchAll(/[^\s"'`\\]*SKILL\.md/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

export function parseJsonLines(text: string): JsonObject[] {
  const events: JsonObject[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") events.push(parsed);
    } catch { /* Hosts may interleave non-JSON lines. */ }
  }
  return events;
}

export function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function unique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}
