import {
  type AgentRunRequest,
  type HandbackState,
  orchestratorPrompt,
  parseHandbackState,
  runOrchestrator,
} from "./agents.ts";
import { exists } from "./files.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fakeHost(root: string, body: string): Promise<string> {
  const path = `${root}/host.sh`;
  await Deno.writeTextFile(
    path,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'fake 1.2.3\\n'; exit 0; fi\n${body}\n`,
  );
  await Deno.chmod(path, 0o755);
  return path;
}

type Context = Omit<AgentRunRequest, "agent" | "requestedModel" | "executable">;

async function context(root: string): Promise<Context> {
  const passDir = `${root}/pass`;
  await Deno.mkdir(`${passDir}/run`, { recursive: true });
  await Deno.mkdir(`${root}/bin`);
  await Deno.writeTextFile(
    `${root}/auth.json`,
    '{"token":"secret-credential"}',
  );
  return {
    passDir,
    binDir: `${root}/bin`,
    evidenceDir: `${root}/evidence`,
    codexAuthPath: `${root}/auth.json`,
    piSubagentsEntry: `${root}/pi-subagents/index.js`,
    timeoutMs: 5_000,
  };
}

/** A host body that records its arguments, working directory and PATH. */
const RECORD = `printf '%s\\n' "$@" > argv.txt
pwd > cwd.txt
printf '%s\\n' "$PATH" > path.txt
printf '%s\\n' "\${CODEX_HOME:-}" > codex-home.txt
if [ -n "\${CODEX_HOME:-}" ]; then
  if [ -f "$CODEX_HOME/auth.json" ]; then echo present > auth-during.txt; else echo absent > auth-during.txt; fi
fi`;

Deno.test("Claude adapter runs in the pass directory with the orchestrator settings and keeps exact final bytes", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `${RECORD}
printf '%s\\n' '{"type":"assistant","message":{"model":"claude-sonnet-observed","content":[{"type":"text","text":"draft"}]}}'
printf '%s\\n' '{"type":"result","result":"Final: ok\\nHand-back state: loose\\n"}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "sonnet",
      reasoning: "medium",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(result.hostVersion === "fake 1.2.3", "host version missing");
    assert(result.requestedEffort === "medium", "effort not recorded");
    assert(
      result.modelVerification === "observed" &&
        result.observedModels.join() === "claude-sonnet-observed",
      "served model not observed",
    );
    assert(result.finalResponsePath !== null, "response path missing");
    assert(
      await Deno.readTextFile(result.finalResponsePath) ===
        "Final: ok\nHand-back state: loose\n",
      "final response bytes changed",
    );
    assert(
      (await Deno.readTextFile(result.stdoutPath)).includes("draft"),
      "raw event absent",
    );

    // The host ran inside the pass directory, with the pinned binary first on PATH.
    const real = await Deno.realPath(options.passDir);
    assert(
      (await Deno.readTextFile(`${options.passDir}/cwd.txt`)).trim() === real,
      "wrong working directory",
    );
    const path = (await Deno.readTextFile(`${options.passDir}/path.txt`))
      .trim();
    assert(
      path.startsWith(`${options.binDir}:`),
      `pinned bin not first on PATH: ${path}`,
    );

    // Flags: effort, restrictions, the shell the skill needs, and the child.
    const settings = [...result.settings];
    const at = (flag: string) => settings.indexOf(flag);
    assert(settings[at("--effort") + 1] === "medium", "effort flag missing");
    assert(settings[at("--model") + 1] === "sonnet", "model flag missing");
    assert(settings.includes("--restricted"), "restrictions missing");
    assert(settings.includes("--strict-mcp-config"), "MCP not strict");
    assert(
      !settings.includes("--safe-mode"),
      "--safe-mode disables --agents and must not be passed",
    );
    assert(
      settings[at("--tools") + 1] === "Bash,Read,Write,Glob,Grep,Agent",
      "tool set wrong",
    );
    const allowed = settings.slice(
      at("--allowedTools") + 1,
      at("--agents"),
    );
    for (
      const entry of [
        "Bash(sigilc *)",
        "Bash(./bin/sigilc *)",
        "Bash(cp *)",
        "Bash(mv *)",
        "Bash(mkdir *)",
        "Read",
        "Write",
        "Agent",
      ]
    ) {
      assert(allowed.includes(entry), `allowedTools lacks ${entry}`);
    }
    const agents = JSON.parse(settings[at("--agents") + 1]);
    assert(
      agents.interpreter.model === "sonnet" &&
        agents.interpreter.effort === "medium" &&
        agents.interpreter.tools.join() === "Read,Glob,Grep,Write",
      `child definition wrong: ${JSON.stringify(agents)}`,
    );
    assert(
      result.children.effortVerification === "unverified" &&
        result.children.efforts.length === 0,
      "Claude child effort cannot be observed",
    );
    assert(
      result.isolationLimits.some((limit) => limit.includes("unverified")),
      "limits do not say the child effort is unverified",
    );
    // The pass directory is evidence: it stays.
    assert(await exists(options.passDir), "pass directory was removed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the prompt names the staged skill, root, store, run directory, model, effort and fresh children", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"result","result":"x"}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "model-x",
      reasoning: "low",
      executable,
    });
    const prompt = await Deno.readTextFile(result.promptPath);
    for (
      const needle of [
        "skills/sigil-compute-design/SKILL.md",
        "references/computed-evaluation.md",
        "`root`",
        "`store`",
        "`run`",
        "model model-x",
        "reasoning effort low",
        "fresh child",
        'subagent_type "interpreter"',
        "Hand-back state: STATE",
      ]
    ) {
      assert(prompt.includes(needle), `prompt lacks ${needle}`);
    }
    // Child instructions live in the skill, not in the benchmark prompt.
    assert(
      !prompt.includes("return nothing") && !prompt.includes('"context"'),
      "context-row rule is back in the prompt",
    );
    assert(!prompt.includes("fixture-answer-key"), "answer key in prompt");
    // Host-specific spawn sentences.
    assert(
      orchestratorPrompt({
        spawnInstruction: "X",
        model: "m",
        effort: null,
      }).includes("the host's default reasoning effort"),
      "default effort not described",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Codex adapter sets sandbox, effort keys and scratch home, observes children from rollouts, and removes credentials", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `${RECORD}
output=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--output-last-message' ]; then output="$arg"; fi
  prev="$arg"
done
dir="$CODEX_HOME/sessions/2026/10/08"
mkdir -p "$dir"
cat > "$dir/rollout-parent.jsonl" <<'EOF'
{"type":"session_meta","payload":{"source":"exec"}}
{"type":"turn_context","payload":{"model":"gpt-served","effort":"medium"}}
{"type":"response_item","payload":{"type":"function_call","name":"spawn_agent","arguments":"{\\"fork_turns\\":\\"none\\"}"}}
EOF
cat > "$dir/rollout-child.jsonl" <<'EOF'
{"type":"session_meta","payload":{"source":{"subagent":{}}}}
{"type":"turn_context","payload":{"model":"gpt-served","effort":"medium"}}
EOF
printf 'done\\nHand-back state: incomplete\\n' > "$output"
printf '%s\\n' '{"type":"thread.started"}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "codex",
      requestedModel: "gpt-requested",
      reasoning: "medium",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    const settings = [...result.settings];
    assert(settings[0] === "exec" && settings.includes("--json"), "not exec");
    assert(!settings.includes("--ephemeral"), "--ephemeral hides the child");
    assert(settings.includes("--ignore-user-config"), "user config read");
    assert(settings.includes("--ignore-rules"), "rules read");
    assert(settings.includes("--skip-git-repo-check"), "git check kept");
    const at = (flag: string) => settings.indexOf(flag);
    assert(
      settings[at("--enable") + 1] === "skip_host_skill_discovery",
      "installed skills not skipped",
    );
    assert(
      settings[at("--sandbox") + 1] === "workspace-write",
      "sandbox wrong",
    );
    const real = await Deno.realPath(options.passDir);
    assert(
      settings[at("-C") + 1] === options.passDir ||
        settings[at("-C") + 1] === real,
      "-C is not the pass directory",
    );
    assert(
      settings.includes('model_reasoning_effort="medium"'),
      "parent effort missing",
    );
    assert(
      settings.includes('agents.default_subagent_reasoning_effort="medium"'),
      "child effort key missing",
    );
    assert(
      !settings.some((entry) => entry.includes("multi_agent_reasoning_effort")),
      "multi_agent_reasoning_effort is not a Codex key",
    );
    assert(
      settings[at("--model") + 1] === "gpt-requested",
      "model flag missing",
    );

    // A scratch CODEX_HOME held the credentials only while the host ran.
    const home = (await Deno.readTextFile(`${options.passDir}/codex-home.txt`))
      .trim();
    assert(home === `${options.evidenceDir}/codex-home`, `home is ${home}`);
    assert(
      (await Deno.readTextFile(`${options.passDir}/auth-during.txt`)).trim() ===
        "present",
      "auth was not available to the host",
    );
    assert(
      !await exists(`${home}/auth.json`),
      "credentials were left in retained evidence",
    );
    assert(
      await exists(`${home}/sessions/2026/10/08/rollout-child.jsonl`),
      "rollouts were not retained",
    );
    // Child model and effort come from the rollouts.
    assert(result.children.count === 1, `children ${result.children.count}`);
    assert(result.children.models.join() === "gpt-served", "child model");
    assert(
      result.children.efforts.join() === "medium" &&
        result.children.effortVerification === "observed",
      "child effort not observed",
    );
    assert(
      result.observedModels.join() === "gpt-served" &&
        result.modelVerification === "observed",
      "served model not taken from the rollouts",
    );
    assert(
      result.children.freshEvidence.some((e) => e.includes("fork_turns=none")),
      "fresh spawn not recorded",
    );
    const prompt = await Deno.readTextFile(result.promptPath);
    assert(
      prompt.includes('spawn_agent tool and set fork_turns to "none"'),
      "prompt does not require a fresh spawn",
    );
    assert(result.finalResponsePath !== null, "response missing");
    assert(
      parseHandbackState(await Deno.readTextFile(result.finalResponsePath)) ===
        "incomplete",
      "hand-back not read from the last message",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Codex credentials are removed even when the run is cut off, and a missing auth file is a launch failure", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(root, `while :; do :; done`);
    const result = await runOrchestrator({
      ...options,
      agent: "codex",
      requestedModel: "m",
      executable,
      timeoutMs: 400,
    });
    assert(result.status === "timeout", `status ${result.status}`);
    assert(
      !await exists(`${options.evidenceDir}/codex-home/auth.json`),
      "credentials kept after a timeout",
    );
    // No effort requested: neither effort key is passed.
    assert(
      !result.settings.some((entry) => entry.includes("reasoning_effort")),
      "an effort was passed although none was requested",
    );
    assert(result.requestedEffort === null, "effort recorded");

    const missing = await runOrchestrator({
      ...options,
      evidenceDir: `${root}/evidence-2`,
      agent: "codex",
      requestedModel: "m",
      executable,
      codexAuthPath: `${root}/no-such-auth.json`,
    });
    assert(
      missing.status === "failed" && missing.failureStep === "launch",
      "missing auth did not fail the launch",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Pi adapter loads pi-subagents explicitly, defines a fresh child with the requested thinking, and is labelled untested", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `${RECORD}
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"xai","model":"model-a","content":[{"type":"text","text":"first"}]}}'
printf '%s\\n' '{"type":"tool_execution_end","toolName":"subagent","result":{"model":"xai/model-a","thinking":"high"}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"xai","model":"model-a","content":[{"type":"text","text":"Hand-back state: coherent\\n"}]}}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "pi",
      requestedModel: "xai/model-a",
      reasoning: "high",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    const settings = [...result.settings];
    const at = (flag: string) => settings.indexOf(flag);
    assert(settings.includes("--no-extensions"), "extensions not disabled");
    assert(
      settings[at("-e") + 1] === options.piSubagentsEntry,
      "pi-subagents path not passed with -e",
    );
    assert(
      settings[at("--thinking") + 1] === "high",
      "thinking level missing",
    );
    assert(settings[at("--tools") + 1] === "read,bash,subagent", "tools");
    assert(settings.includes("--no-skills"), "host skills not disabled");
    const agent = await Deno.readTextFile(
      `${options.passDir}/.pi/agents/interpreter.md`,
    );
    assert(agent.includes("thinking: high"), "child thinking missing");
    assert(agent.includes("model: xai/model-a"), "child model missing");
    assert(agent.includes("inheritSkills: false"), "child inherits skills");
    assert(
      agent.includes("tools: read, write, grep, find, ls"),
      "child tools wrong",
    );
    const prompt = await Deno.readTextFile(result.promptPath);
    assert(
      prompt.includes('context "fresh"') && prompt.includes("subagent tool"),
      "prompt does not require a fresh subagent",
    );
    assert(
      result.isolationLimits.some((limit) => limit.includes("untested")),
      "Pi is not labelled untested",
    );
    assert(
      result.children.efforts.join() === "high" &&
        result.children.effortVerification === "observed",
      "Pi child effort not read from the subagent result",
    );
    assert(result.finalResponsePath !== null, "response path missing");
    assert(
      await Deno.readTextFile(result.finalResponsePath) ===
        "Hand-back state: coherent\n",
      "Pi bytes changed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Pi marks two served model IDs mixed", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","model":"model-a","content":[{"type":"text","text":"first"}]}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","model":"model-b","content":[{"type":"text","text":"second\\n"}]}}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "pi",
      requestedModel: "provider/model-a",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(result.modelVerification === "mixed", "mixed run attributed to one");
    assert(
      result.observedModels.join() === "model-a,model-b",
      "model IDs lost",
    );
    assert(
      !result.settings.includes("--thinking"),
      "thinking passed although no effort was requested",
    );
    assert(
      await Deno.readTextFile(result.finalResponsePath!) === "second\n",
      "Pi bytes changed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Claude rate-limit synthetic assistant is not a served model", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"assistant","is_api_error_message":true,"message":{"model":"<synthetic>","content":[{"type":"text","text":"rate limit"}]}}'
printf '%s\\n' '{"type":"result","is_error":true,"result":"rate limit"}'
exit 1`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "sonnet",
      executable,
    });
    assert(result.status === "failed", "error was treated as completed");
    assert(
      result.modelVerification === "unverified" &&
        result.observedModels.length === 0,
      "synthetic error attributed to a model",
    );
    assert(result.finalResponsePath === null, "error text became a hand-back");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a Codex host that exposes no rollouts leaves model and effort unverified", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `output=''
prev=''
for arg in "$@"; do
  if [ "$prev" = '--output-last-message' ]; then output="$arg"; fi
  prev="$arg"
done
printf 'Hand-back state: failed\\n' > "$output"
printf '%s\\n' '{"type":"thread.started","model":"requested-only"}'`,
    );
    const result = await runOrchestrator({
      ...options,
      agent: "codex",
      requestedModel: "requested-only",
      reasoning: "medium",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(
      result.modelVerification === "unverified" &&
        result.observedModels.length === 0,
      "request echo was trusted",
    );
    assert(
      result.children.effortVerification === "unverified" &&
        result.children.count === 0,
      "missing rollouts were not reported as unverified",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hand-back states are read from the last well-formed line", () => {
  const cases: [string, HandbackState | null][] = [
    ["Hand-back state: coherent", "coherent"],
    ["notes\n**Hand-back state:** Disjoint\n", "disjoint"],
    ["Hand-back state: loose\nHand-back state: incomplete", "incomplete"],
    ["`Hand-back state: failed`", "failed"],
    ["Hand-back state: unknown", null],
    ["the check is coherent", null],
  ];
  for (const [text, expected] of cases) {
    assert(
      parseHandbackState(text) === expected,
      `${JSON.stringify(text)} -> ${parseHandbackState(text)}`,
    );
  }
});

Deno.test("launch failure is recorded and does not poison another host", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const failed = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "missing",
      executable: `${root}/does-not-exist`,
    });
    assert(
      failed.status === "failed" && failed.failureStep === "launch",
      "missing host not recorded",
    );
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const succeeded = await runOrchestrator({
      ...options,
      evidenceDir: `${root}/evidence-2`,
      agent: "claude",
      requestedModel: "available",
      executable,
    });
    assert(succeeded.status === "completed", "later host did not run");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a hanging version probe obeys the pass timeout", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-version-test-" });
  try {
    const options = await context(root);
    const executable = `${root}/host.sh`;
    await Deno.writeTextFile(
      executable,
      `#!/bin/sh
if [ "$1" = "--version" ]; then exec sleep 10; fi
printf '%s\\n' '{"type":"result","result":"unexpected"}'
`,
    );
    await Deno.chmod(executable, 0o755);
    const started = Date.now();
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "fake",
      executable,
      timeoutMs: 150,
    });
    assert(result.status === "timeout", `wrong status: ${result.status}`);
    assert(Date.now() - started < 3_000, "version probe stalled the batch");
    assert(result.finalResponsePath === null, "main host was launched");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a version probe's descendant cannot hold its output open", async () => {
  const root = await Deno.makeTempDir({
    prefix: "slotted-version-child-test-",
  });
  try {
    const options = await context(root);
    const executable = `${root}/host.sh`;
    await Deno.writeTextFile(
      executable,
      `#!/bin/sh
if [ "$1" = "--version" ]; then sleep 8 & printf 'fake 1.2.3\\n'; exit 0; fi
printf '%s\\n' '{"type":"result","result":"[]"}'
`,
    );
    await Deno.chmod(executable, 0o755);
    const started = Date.now();
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "fake",
      executable,
      timeoutMs: 5_000,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(result.hostVersion === "fake 1.2.3", "version output was lost");
    assert(
      Date.now() - started < 3_000,
      "version descendant stalled the attempt",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a host's descendant cannot hold output pipes open for the next attempt", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-descendant-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `if [ ! -e descendant-started ]; then touch descendant-started; sleep 8 & fi\nprintf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const started = Date.now();
    const first = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "first",
      executable,
      timeoutMs: 5_000,
    });
    assert(first.status === "completed", JSON.stringify(first));
    assert(
      Date.now() - started < 3_000,
      "descendant kept the first attempt open",
    );

    const second = await runOrchestrator({
      ...options,
      evidenceDir: `${root}/second-evidence`,
      agent: "claude",
      requestedModel: "second",
      executable,
      timeoutMs: 5_000,
    });
    assert(second.status === "completed", "later attempt did not proceed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cancellation remains active while host output drains", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-drain-cancel-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `if [ "$1" = "--version" ]; then exit 0; fi\n(trap '' TERM; while :; do sleep 1; done) &\nprintf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const result = await runOrchestrator({
      ...options,
      agent: "claude",
      requestedModel: "cancel-during-drain",
      executable,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    assert(result.status === "cancelled", `wrong status: ${result.status}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

for (const termination of ["timeout", "cancelled"] as const) {
  Deno.test(`${termination} ends the host and retains partial output`, async () => {
    const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
    try {
      const options = await context(root);
      const executable = await fakeHost(
        root,
        `printf '%s\\n' '{"type":"assistant","message":{"model":"model-a"}}'
while :; do :; done`,
      );
      const controller = new AbortController();
      if (termination === "cancelled") {
        setTimeout(() => controller.abort(), 300);
      }
      const result = await runOrchestrator({
        ...options,
        agent: "claude",
        requestedModel: "model-a",
        executable,
        timeoutMs: 500,
        signal: termination === "cancelled" ? controller.signal : undefined,
      });
      assert(
        result.status === termination,
        `wrong termination: ${result.status}`,
      );
      assert(
        (await Deno.readTextFile(result.stdoutPath)).includes("model-a"),
        "partial event lost",
      );
      assert(
        result.finalResponsePath === null,
        "partial output became a hand-back",
      );
      assert(await exists(options.passDir), "pass directory was removed");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
}
