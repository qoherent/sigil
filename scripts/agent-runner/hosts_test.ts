import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { exists } from "./files.ts";
import {
  analyzeHostStream,
  buildHostLaunch,
  type ChildAgentDefinition,
  type HostSettings,
  parseJsonLines,
  prepareCodexHome,
  removeCodexAuth,
  skillPaths,
} from "./hosts.ts";
import { withTempDir } from "./test_support.ts";

const INTERPRETER: ChildAgentDefinition = {
  name: "interpreter",
  description: "Fresh interpreter child",
  prompt: "Read and answer.",
  claudeTools: ["Read", "Glob", "Grep", "Write"],
  piTools: ["read", "write", "grep", "find", "ls"],
};

const REVIEWER: ChildAgentDefinition = {
  name: "reviewer",
  description: "Read-only design reviewer",
  prompt: "Review without writing.",
  claudeTools: ["Read", "Glob", "Grep"],
  piTools: ["read", "grep", "find", "ls"],
};

function settings(
  passDir: string,
  overrides: Partial<HostSettings> = {},
): HostSettings {
  return {
    host: "claude",
    model: "model-o",
    effort: "high",
    childModel: "model-c",
    childEffort: "low",
    passDir,
    allowedShell: ["sigilc", "ls", "git"],
    children: [INTERPRETER],
    piSubagentsEntry: "/pi/index.js",
    ...overrides,
  };
}

test("Pi loads only the extensions explicitly supplied for a child", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    await buildHostLaunch(settings(root, {
      host: "pi",
      children: [INTERPRETER, {
        ...REVIEWER,
        piExtensions: [join(root, "bin/review-evidence-pi.mjs")],
      }],
    }));
    const reviewer = await readFile(
      join(root, ".pi/agents/reviewer.md"),
      "utf8",
    );
    assert.ok(
      reviewer.includes(
        `extensions: ${join(root, "bin/review-evidence-pi.mjs")}`,
      ),
    );
    assert.ok(
      !(await readFile(join(root, ".pi/agents/interpreter.md"), "utf8"))
        .includes("extensions:"),
    );
  });
});

test("Claude defines every child agent and allows the named shell programs", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    const launch = await buildHostLaunch(
      settings(root, { children: [INTERPRETER, REVIEWER] }),
    );
    const args = [...launch.args];
    const agents = JSON.parse(args[args.indexOf("--agents") + 1]);
    assert.deepEqual(agents, {
      interpreter: {
        description: "Fresh interpreter child",
        prompt: "Read and answer.",
        tools: ["Read", "Glob", "Grep", "Write"],
        model: "model-c",
        effort: "low",
      },
      reviewer: {
        description: "Read-only design reviewer",
        prompt: "Review without writing.",
        tools: ["Read", "Glob", "Grep"],
        model: "model-c",
        effort: "low",
      },
    });
    const allowed = args.slice(
      args.indexOf("--allowedTools") + 1,
      args.indexOf("--agents"),
    );
    for (
      const entry of [
        "Bash(sigilc *)",
        "Bash(./bin/sigilc *)",
        "Bash(ls)",
        "Bash(ls *)",
        "Bash(git *)",
      ]
    ) {
      assert.ok(allowed.includes(entry), `allowedTools lacks ${entry}`);
    }
    assert.equal(args.at(-1), "--");
    assert.equal(
      launch.spawnInstruction,
      'Start each child with the Agent tool and the subagent_type its task calls for, one of "interpreter", "reviewer".',
    );
  });
});

test("one child is named directly in the spawn instruction", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    const claude = await buildHostLaunch(settings(root));
    assert.equal(
      claude.spawnInstruction,
      'Start each child with the Agent tool and subagent_type "interpreter".',
    );
    const pi = await buildHostLaunch(settings(root, { host: "pi" }));
    assert.equal(
      pi.spawnInstruction,
      'Start each child with the subagent tool, agent "interpreter", context "fresh" and async false.',
    );
  });
});

test("Pi writes one fresh agent file per child", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    const launch = await buildHostLaunch(
      settings(root, { host: "pi", children: [INTERPRETER, REVIEWER] }),
    );
    const reviewer = await readFile(
      join(root, ".pi/agents/reviewer.md"),
      "utf8",
    );
    assert.equal(
      reviewer,
      [
        "---",
        "name: reviewer",
        "description: Read-only design reviewer",
        "tools: read, grep, find, ls",
        "model: model-c",
        "thinking: low",
        "systemPromptMode: replace",
        "inheritProjectContext: false",
        "inheritGlobalContext: false",
        "inheritSkills: false",
        "---",
        "Review without writing.",
        "",
      ].join("\n"),
    );
    assert.ok(await exists(join(root, ".pi/agents/interpreter.md")));
    assert.equal(launch.args[launch.args.indexOf("-e") + 1], "/pi/index.js");
    assert.match(launch.spawnInstruction, /one of "interpreter", "reviewer"/);
  });
});

test("Codex needs a scratch home and records its last message", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    await assert.rejects(
      buildHostLaunch(settings(root, { host: "codex" })),
      /scratch CODEX_HOME/,
    );
    const launch = await buildHostLaunch(settings(root, {
      host: "codex",
      codexHome: join(root, "home"),
      lastMessagePath: join(root, "last.txt"),
    }));
    assert.equal(launch.env.CODEX_HOME, join(root, "home"));
    const args = [...launch.args];
    assert.equal(args[args.indexOf("-C") + 1], root);
    assert.equal(
      args[args.indexOf("--output-last-message") + 1],
      join(root, "last.txt"),
    );
    assert.ok(args.includes('agents.default_subagent_reasoning_effort="low"'));
  });
});

test("a launch without any child definition is refused", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    await assert.rejects(
      buildHostLaunch(settings(root, { children: [] })),
      /at least one child agent/,
    );
  });
});

test("Claude analysis accepts any defined child and names each one missing from init", async () => {
  const agentCall = (type: string) => ({
    type: "assistant",
    message: {
      model: "model-o",
      content: [{
        type: "tool_use",
        name: "Agent",
        input: { subagent_type: type, prompt: "read skills/x/SKILL.md" },
      }],
    },
  });
  const childEvent = {
    type: "assistant",
    parent_tool_use_id: "toolu_1",
    message: { model: "model-c", content: [] },
  };
  const events = [
    { type: "system", subtype: "init", agents: ["interpreter"] },
    agentCall("interpreter"),
    agentCall("reviewer"),
    childEvent,
    { type: "result", result: "done" },
  ];
  const both = await analyzeHostStream("claude", events, {
    childNames: ["interpreter", "reviewer"],
  });
  assert.equal(both.freshFlagOk, true);
  assert.equal(both.finalText, "done");
  assert.deepEqual(both.childModels, ["model-c"]);
  assert.equal(both.childCount, 1);
  assert.deepEqual(both.skillsRead, ["skills/x/SKILL.md"]);
  assert.deepEqual(both.gaps, [
    "custom `reviewer` agent absent from the init event",
  ]);

  const one = await analyzeHostStream("claude", events, {
    childNames: ["interpreter"],
  });
  assert.equal(one.freshFlagOk, false, "an undefined child type was accepted");
});

test("Codex analysis reads children's model, effort and fork setting from rollouts", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    const sessions = join(root, "home/sessions/2026/10/21");
    await mkdir(sessions, { recursive: true });
    const rollout = (lines: unknown[]) =>
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    await writeFile(
      join(sessions, "rollout-1-parent.jsonl"),
      rollout([
        { type: "session_meta", payload: { source: "exec" } },
        { type: "turn_context", payload: { model: "gpt-o", effort: "high" } },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "spawn_agent",
            arguments: JSON.stringify({ fork_turns: "none" }),
          },
        },
      ]),
    );
    await writeFile(
      join(sessions, "rollout-2-child.jsonl"),
      rollout([
        { type: "session_meta", payload: { source: { subagent: {} } } },
        { type: "turn_context", payload: { model: "gpt-c", effort: "low" } },
      ]),
    );
    const analysis = await analyzeHostStream("codex", [], {
      childNames: ["interpreter"],
      codexHome: join(root, "home"),
    });
    assert.equal(analysis.childCount, 1);
    assert.deepEqual(analysis.childModels, ["gpt-c"]);
    assert.deepEqual(analysis.childEfforts, ["low"]);
    assert.deepEqual(analysis.models, ["gpt-o", "gpt-c"]);
    assert.equal(analysis.freshFlagOk, true);
  });
});

test("Codex auth is copied into the scratch home and removed again", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    await writeFile(join(root, "auth.json"), '{"token":"secret"}');
    const home = join(root, "home");
    await prepareCodexHome(home, join(root, "auth.json"));
    assert.equal(
      await readFile(join(home, "auth.json"), "utf8"),
      '{"token":"secret"}',
    );
    await removeCodexAuth(home);
    assert.equal(await exists(join(home, "auth.json")), false);
    // Removing it twice is not an error.
    await removeCodexAuth(home);
  });
});

test("JSON lines skip what is not a JSON object and SKILL.md paths are collected", () => {
  assert.deepEqual(
    parseJsonLines('{"a":1}\nnot json\n\n42\n{"b":2}\n'),
    [{ a: 1 }, { b: 2 }],
  );
  assert.deepEqual(
    skillPaths([
      '{"file_path":"skills/a/SKILL.md"}',
      "cat skills/b/SKILL.md skills/a/SKILL.md",
    ]),
    ["skills/a/SKILL.md", "skills/b/SKILL.md"],
  );
});

test("Claude allows the pinned sigil by name and by path when it is named", async () => {
  await withTempDir("agent-runner-hosts-", async (root) => {
    const launch = await buildHostLaunch(
      settings(root, {
        children: [INTERPRETER],
        allowedShell: ["sigilc", "sigil"],
      }),
    );
    const args = launch.args;
    const allowed = args.slice(
      args.indexOf("--allowedTools") + 1,
      args.indexOf("--agents"),
    );
    assert.deepEqual(
      allowed.filter((entry) => entry.includes("sigil")),
      [
        "Bash(sigilc *)",
        "Bash(./bin/sigilc *)",
        "Bash(sigil *)",
        "Bash(./bin/sigil *)",
      ],
    );
  });
});

test("Claude analysis reports the tool calls its result says were denied", async () => {
  const events = [
    { type: "assistant", message: { model: "model-o", content: [] } },
    {
      type: "result",
      result: "Hand-back state: failed",
      permission_denials: [
        { tool_name: "Bash", tool_input: { command: "./bin/sigil --version" } },
      ],
    },
  ];
  const claude = await analyzeHostStream("claude", events, {
    childNames: [],
  });
  assert.deepEqual(claude.permissionDenials, [
    'Bash: {"command":"./bin/sigil --version"}',
  ]);
  // Every turn ends with a result; a later turn's empty list must not hide
  // the denials of an earlier one.
  const turns = await analyzeHostStream("claude", [
    {
      type: "result",
      result: "first turn",
      permission_denials: [{ tool_name: "Bash", tool_input: { command: "x" } }],
    },
    { type: "result", result: "done", permission_denials: [] },
  ], { childNames: [] });
  assert.deepEqual(turns.permissionDenials, ['Bash: {"command":"x"}']);
  const clean = await analyzeHostStream("claude", [
    { type: "result", result: "done", permission_denials: [] },
  ], { childNames: [] });
  assert.deepEqual(clean.permissionDenials, []);
});
