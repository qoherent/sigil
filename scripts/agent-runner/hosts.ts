/**
 * Orchestrator and child launch settings for each host, and the readers that
 * recover what each host recorded about its children.
 *
 * The shared launcher (`launch.ts`) and the evaluation benchmark's host probe
 * (`scripts/slotted-benchmark/probe-hosts.ts`) share this module, so the
 * settings the probe verified live are the settings a pass runs with.
 *
 * Verified live by the host probe: Codex (0.161) and Claude Code. NOT verified live: Pi
 * (0.87 with pi-subagents 0.70.1). The xAI provider answered 403 out of credits,
 * so the Pi settings below were written from the pi-subagents documentation and
 * have never been run against a real model.
 */
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import type { Dirent } from "node:fs";

export type HostName = "codex" | "claude" | "pi";
export const HOSTS: readonly HostName[] = ["codex", "claude", "pi"];

/** `name` as a host name; throws naming the known hosts when it is not one. */
export function parseHostName(name: string): HostName {
  if (!(HOSTS as readonly string[]).includes(name)) {
    throw new Error(`Unknown agent ${name} (known: ${HOSTS.join(", ")})`);
  }
  return name as HostName;
}

export type JsonObject = Record<string, unknown>;

/**
 * A child agent the orchestrator may start. Claude Code and Pi are given the
 * definition; Codex starts its own default agent and ignores it.
 */
export interface ChildAgentDefinition {
  /** The name the orchestrator starts the child by. */
  readonly name: string;
  readonly description: string;
  /** The child's system prompt. */
  readonly prompt: string;
  /** Claude Code tools the child may use. */
  readonly claudeTools: readonly string[];
  /** Claude agent-scoped lifecycle hooks (for example a read-only Bash gate). */
  readonly claudeHooks?: JsonObject;
  /** Pi tools the child may use. */
  readonly piTools: readonly string[];
  /** Pi extensions loaded only for this child (normally absolute staged paths). */
  readonly piExtensions?: readonly string[];
}

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
  /** The child agents the orchestrator may start; at least one. */
  readonly children: readonly ChildAgentDefinition[];
  /** Pi: the pi-subagents extension entry loaded with `-e`. */
  readonly piSubagentsEntry: string;
  /**
   * Arguments added after the host's own settings and before the prompt, such
   * as Claude Code's `--settings` with `claudeDenySettings`. Default: none.
   */
  readonly hostArgs?: readonly string[];
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
  return join(home(), ".pi/agent/npm/node_modules/pi-subagents/index.js");
}

/** The default Codex auth file. Reads HOME on demand. */
export function defaultCodexAuthPath(): string {
  return join(home(), ".codex/auth.json");
}

function home(): string {
  try {
    return process.env.HOME ?? "";
  } catch {
    /* Environment access may be denied; the caller passes a path. */
    return "";
  }
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
  await mkdir(codexHome, { recursive: true });
  await copyFile(authPath, join(codexHome, "auth.json"));
}

export async function removeCodexAuth(codexHome: string): Promise<void> {
  // `force` ignores a missing file and nothing else.
  await rm(join(codexHome, "auth.json"), { force: true });
}

/** Name the child agents for a sentence: `"a"`, or `one of "a", "b"`. */
function childChoice(children: readonly ChildAgentDefinition[]): string {
  const names = children.map((child) => `"${child.name}"`);
  return names.length === 1 ? names[0] : `one of ${names.join(", ")}`;
}

export async function buildHostLaunch(
  settings: HostSettings,
): Promise<HostLaunch> {
  if (settings.children.length === 0) {
    throw new Error("A host launch needs at least one child agent definition");
  }
  const passDir = resolve(settings.passDir);
  const hostArgs = settings.hostArgs ?? [];
  switch (settings.host) {
    case "codex": {
      if (!settings.codexHome) {
        throw new Error("Codex needs a scratch CODEX_HOME");
      }
      // No `--ephemeral`: an ephemeral run records neither the child's model
      // nor its effort anywhere. `skip_host_skill_discovery` keeps Codex from
      // reading the sigil-compute-design installed in ~/.agents/skills instead of the
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
        ...hostArgs,
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
      const agents = Object.fromEntries(
        settings.children.map((child) => [child.name, {
          description: child.description,
          prompt: child.prompt,
          tools: [...child.claudeTools],
          ...(child.claudeHooks ? { hooks: child.claudeHooks } : {}),
          model: settings.childModel,
          ...(settings.childEffort ? { effort: settings.childEffort } : {}),
        }]),
      );
      // `--safe-mode` is deliberately absent: it disables `--agents`, so the
      // Agent tool then reports the child type as not found.
      // The prompt has the orchestrator run the pinned tool as
      // `./bin/sigilc`, so that exact command must be allowed as well.
      const shell = settings.allowedShell.flatMap((program) =>
        program === "ls"
          ? ["Bash(ls)", "Bash(ls *)"]
          : program === "sigilc"
          ? ["Bash(sigilc *)", "Bash(./bin/sigilc *)"]
          : program === "sigil"
          ? ["Bash(sigil *)", "Bash(./bin/sigil *)"]
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
        ...hostArgs,
        "--",
      ];
      return {
        args,
        env: {},
        spawnInstruction: settings.children.length === 1
          ? `Start each child with the Agent tool and subagent_type ${
            childChoice(settings.children)
          }.`
          : `Start each child with the Agent tool and the subagent_type its task calls for, ${
            childChoice(settings.children)
          }.`,
        isolationLimits: [
          "Managed settings may still apply; the CLI's tool and shell allowlists are not an OS sandbox.",
          "The child effort is requested through the agent definition but is not echoed by the host, so it is unverified.",
        ],
      };
    }
    case "pi": {
      // UNTESTED LIVE: written from the pi-subagents documentation (the host probe could
      // not reach a Pi provider with credit).
      await mkdir(join(passDir, ".pi/agents"), { recursive: true });
      for (const child of settings.children) {
        await writeFile(
          join(passDir, `.pi/agents/${child.name}.md`),
          [
            "---",
            `name: ${child.name}`,
            `description: ${child.description}`,
            `tools: ${child.piTools.join(", ")}`,
            ...(child.piExtensions
              ? [`extensions: ${child.piExtensions.join(", ")}`]
              : []),
            `model: ${settings.childModel}`,
            ...(settings.childEffort
              ? [`thinking: ${settings.childEffort}`]
              : []),
            "systemPromptMode: replace",
            "inheritProjectContext: false",
            "inheritGlobalContext: false",
            "inheritSkills: false",
            "---",
            child.prompt,
            "",
          ].join("\n"),
        );
      }
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
        ...hostArgs,
        "--",
      ];
      return {
        args,
        env: {},
        spawnInstruction: settings.children.length === 1
          ? `Start each child with the subagent tool, agent ${
            childChoice(settings.children)
          }, context "fresh" and async false.`
          : `Start each child with the subagent tool, the agent its task calls for (${
            childChoice(settings.children)
          }), context "fresh" and async false.`,
        isolationLimits: [
          "Pi settings are untested live. The tool allowlists limit available tools, not OS-level file access.",
        ],
      };
    }
  }
}

/**
 * A Claude Code settings document, passed with `--settings`, that denies reads
 * under each root to the orchestrator.
 *
 * Rule syntax from the Claude Code permissions documentation
 * (https://code.claude.com/docs/en/permissions): a `//` prefix anchors a path
 * at the filesystem root (one `/` anchors it at the settings source), and
 * Claude Code applies `Read` deny rules to Grep and Glob as well. A
 * `Glob(path)` rule is accepted but never consulted, so only Read rules are
 * written. Whether a custom `--agents` child inherits these rules is not
 * documented, which is why every pass is also scanned afterwards.
 */
export function claudeDenySettings(roots: readonly string[]): JsonObject {
  return {
    permissions: {
      deny: roots.map((root) => `Read(/${root.replace(/\/+$/, "")}/**)`),
    },
  };
}

/** One tool call a host recorded, by the orchestrator or by a child. */
export interface ToolCall {
  /** "orchestrator", or the child's agent name or path where the host shows it. */
  readonly actor: string;
  /** The child session the call belongs to; null for the orchestrator. */
  readonly childSession: string | null;
  readonly tool: string;
  /** An object for structured tools; the raw text for free-form ones. */
  readonly input: unknown;
  /** The working directory the host recorded; null when it records none. */
  readonly cwd: string | null;
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
  /**
   * Every tool call the host shows, the children's included. Pi shows only
   * the orchestrator's; Codex shows its children's only through rollouts.
   */
  toolCalls: ToolCall[];
  /**
   * Tool calls the host refused, each as `Tool: input`. Claude Code reports
   * them on its final result; the other hosts report none.
   */
  permissionDenials: string[];
}

function emptyAnalysis(): HostAnalysis {
  return {
    toolCalls: [],
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
    permissionDenials: [],
  };
}

export interface AnalysisOptions {
  /** The child agent names the orchestrator was told it may start. */
  readonly childNames: readonly string[];
  /** Codex: the scratch CODEX_HOME whose rollouts record the children. */
  readonly codexHome?: string;
}

export async function analyzeHostStream(
  host: HostName,
  events: readonly JsonObject[],
  options: AnalysisOptions,
): Promise<HostAnalysis> {
  switch (host) {
    case "codex":
      return await analyzeCodex(events, options.codexHome);
    case "claude":
      return analyzeClaude(events, options.childNames);
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
  const streamCalls: ToolCall[] = [];
  const collabIds = new Set<string>();
  let finalText: string | null = null;
  for (const event of events) {
    const item = asRecord(event.item);
    if (!item) continue;
    if (item.type === "command_execution" && event.type === "item.started") {
      actions.push(String(item.command ?? ""));
      streamCalls.push(orchestratorCall("command_execution", {
        command: item.command,
      }));
    }
    // A collab call is how the stream shows a child being started.
    if (item.type === "collab_tool_call" && !collabIds.has(String(item.id))) {
      collabIds.add(String(item.id));
      streamCalls.push(orchestratorCall("collab_tool_call", item));
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
  // The orchestrator's own rollout records each call's arguments and working
  // directory; the stream is the fallback when no rollout was kept.
  base.toolCalls = [
    ...(parent
      ? rollouts.filter((r) => !r.isChild).flatMap((r) => r.toolCalls)
      : streamCalls),
    ...children.flatMap((r) => r.toolCalls),
  ];
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
  readonly toolCalls: ToolCall[];
}

function orchestratorCall(tool: string, input: unknown): ToolCall {
  return { actor: "orchestrator", childSession: null, tool, input, cwd: null };
}

async function readRollouts(dir: string): Promise<Rollout[]> {
  const rollouts: Rollout[] = [];
  async function walk(path: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.startsWith("rollout-")) {
        const lines = parseJsonLines(await readFile(full, "utf8"));
        let isChild = false;
        let model: string | null = null;
        let effort: string | null = null;
        let actor = "orchestrator";
        let session: string | null = null;
        let cwd: string | null = null;
        const calls: Rollout["calls"] = [];
        const toolCalls: ToolCall[] = [];
        const record = (tool: string, input: unknown) =>
          toolCalls.push({
            actor,
            childSession: isChild ? session ?? entry.name : null,
            tool,
            input,
            cwd,
          });
        for (const line of lines) {
          const payload = asRecord(line.payload);
          if (!payload) continue;
          if (line.type === "session_meta") {
            const source = asRecord(payload.source);
            isChild = source !== null && "subagent" in source;
            session = typeof payload.id === "string" ? payload.id : null;
            if (typeof payload.cwd === "string") cwd = payload.cwd;
            if (isChild) {
              const spawn = asRecord(asRecord(source?.subagent)?.thread_spawn);
              actor = String(
                spawn?.agent_path ?? spawn?.agent_nickname ?? "child",
              );
            }
          } else if (line.type === "turn_context") {
            if (typeof payload.cwd === "string") cwd = payload.cwd;
            if (model === null) {
              model = typeof payload.model === "string" ? payload.model : null;
              effort = typeof payload.effort === "string"
                ? payload.effort
                : null;
            }
          } else if (
            line.type === "response_item" && payload.type === "function_call"
          ) {
            let forkTurns: string | null = null;
            let input: unknown = payload.arguments;
            try {
              const parsed = JSON.parse(String(payload.arguments));
              input = parsed;
              forkTurns = parsed.fork_turns === undefined
                ? null
                : String(parsed.fork_turns);
            } catch { /* Arguments are opaque when not valid JSON. */ }
            calls.push({ name: String(payload.name), forkTurns });
            record(String(payload.name), input);
          } else if (
            line.type === "response_item" &&
            payload.type === "custom_tool_call"
          ) {
            // Free-form tools: `exec` (code mode) and `apply_patch` take text.
            record(String(payload.name), payload.input);
          } else if (
            line.type === "response_item" &&
            payload.type === "local_shell_call"
          ) {
            record("local_shell", payload.action);
          }
        }
        rollouts.push({ isChild, model, effort, calls, toolCalls });
      }
    }
  }
  await walk(dir);
  return rollouts;
}

function analyzeClaude(
  events: readonly JsonObject[],
  childNames: readonly string[],
): HostAnalysis {
  const base = emptyAnalysis();
  const actions: string[] = [];
  const agentCalls: JsonObject[] = [];
  const models = new Set<string>();
  const childModels = new Set<string>();
  const childSessions = new Set<string>();
  // The Agent call's id is the parent_tool_use_id of its child's events.
  const childTypes = new Map<string, string>();
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const cwd = typeof init?.cwd === "string" ? init.cwd : null;
  for (const event of events) {
    if (event.type === "result" && typeof event.result === "string") {
      base.finalText = event.result;
    }
    if (event.type === "result" && Array.isArray(event.permission_denials)) {
      base.permissionDenials.push(...event.permission_denials.map((denial) => {
        const record = asRecord(denial);
        const input = asRecord(record?.tool_input);
        const tool = String(record?.tool_name ?? "unknown tool");
        return input ? `${tool}: ${JSON.stringify(input)}` : tool;
      }));
    }
    if (event.type !== "assistant") continue;
    const message = asRecord(event.message);
    const parent = event.parent_tool_use_id
      ? String(event.parent_tool_use_id)
      : null;
    if (!message) continue;
    const model = typeof message.model === "string" ? message.model : "";
    const served = event.is_api_error_message !== true && model.length > 0 &&
      !model.startsWith("<");
    if (served) models.add(model);
    if (parent) {
      if (served) childModels.add(model);
      childSessions.add(parent);
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const record = asRecord(block);
      if (record?.type !== "tool_use") continue;
      const tool = String(record.name);
      base.toolCalls.push({
        actor: parent ? childTypes.get(parent) ?? "child" : "orchestrator",
        childSession: parent,
        tool,
        input: record.input,
        cwd,
      });
      if ((tool === "Agent" || tool === "Task") && record.id) {
        const type = asRecord(record.input)?.subagent_type;
        childTypes.set(String(record.id), String(type ?? "child"));
      }
      // Skill reads and the fresh-child check describe the orchestrator only.
      if (parent) continue;
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
    base.freshFlagOk = agentCalls.every((c) =>
      childNames.includes(String(c.subagent_type))
    );
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
  const agents = Array.isArray(init?.agents) ? init.agents : [];
  for (const name of init ? childNames : []) {
    if (!agents.includes(name)) {
      base.gaps.push(`custom \`${name}\` agent absent from the init event`);
    }
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
          // Only the orchestrator's calls appear; a child's stay inside it.
          base.toolCalls.push(
            orchestratorCall(
              String(block.name),
              block.arguments ?? block.input ?? {},
            ),
          );
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
