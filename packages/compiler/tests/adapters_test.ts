import type { PurposeRetrievalResult } from "@qoherent/sigil-core";
import { assertEquals, assertRejects } from "@std/assert";
import {
  AdapterFailure,
  type AgentEvaluationRequest,
  CodexAdapter,
  COMPILER_AGENT_CAPABILITIES,
  OpenCodeAdapter,
  PiAdapter,
  type ProviderProcessRequest,
  resolveAgentAdapter,
} from "../src/mod.ts";

function request(root: string): AgentEvaluationRequest {
  const retrieval = {
    schema: "sigil-purpose-retrieval/v1",
    policyVersion: 1,
    workspaceSnapshotIdentity: "snapshot",
    target: {
      kind: "component",
      componentName: "Example",
      pathStatus: "accepted",
      path: "main.sigil",
    },
    purpose: "semantic",
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [],
    fingerprint: "sha256:test",
  } satisfies PurposeRetrievalResult;
  return {
    stage: "semantic-readiness",
    skill: "Inspect selected evidence.",
    allowedRules: ["SEMANTIC_AMBIGUITY"],
    implementationEvidence: "context-only",
    workspaceAccess: {
      kind: "snapshot-read-only",
      agentRoot: root,
      workspaceSnapshotIdentity: "snapshot",
    },
    target: {
      componentName: "Example",
      sigilFile: "main.sigil",
      initialPaths: ["main.sigil"],
    },
    retrieval,
    outputSchema: {},
    capabilities: COMPILER_AGENT_CAPABILITIES,
    budgets: {
      elapsedTimeMs: 30_000,
      maxCommands: 4,
      maxCommandOutputChars: 10_000,
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
    },
    maxInputChars: 1_000_000,
  };
}

// @sigil tests packages/compiler/src/adapter-registry.sigil::SigilAgentAdapterRegistry::AgentAdapterRegistry interface,logic,cases
Deno.test("adapter registry binds OpenCode and Pi models without rewriting them", async () => {
  const openCode = resolveAgentAdapter(
    "opencode",
    "anthropic/claude-sonnet-4-5",
    "primary",
  );
  const pi = resolveAgentAdapter("pi", "openai/gpt-5", "reviewer");
  assertEquals(openCode.provider, "opencode");
  assertEquals(openCode.model, "anthropic/claude-sonnet-4-5");
  assertEquals(openCode.id, "primary");
  assertEquals(pi.provider, "pi");
  assertEquals(pi.model, "openai/gpt-5");
  assertEquals(pi.id, "reviewer");
  await assertRejects(
    async () => {
      resolveAgentAdapter("pi", "");
      await Promise.resolve();
    },
    AdapterFailure,
    "non-empty",
  );
});

// @sigil tests packages/compiler/src/opencode-adapter.sigil::SigilOpenCodeAdapter::OpenCodeInvocation logic,constraints
Deno.test("OpenCode adapter isolates configuration and parses JSON events", async () => {
  const root = await Deno.makeTempDir();
  try {
    let invocation: ProviderProcessRequest | undefined;
    const adapter = new OpenCodeAdapter(
      "anthropic/claude-sonnet-4-5",
      (value) => {
        invocation = value;
        return Promise.resolve({
          code: 0,
          stdout: [
            JSON.stringify({ type: "step_start", part: {} }),
            JSON.stringify({
              type: "tool_use",
              part: {
                tool: "read",
                callID: "tool-1",
                state: { status: "completed", output: "source" },
              },
            }),
            JSON.stringify({
              type: "text",
              part: { text: JSON.stringify({ findings: [] }) },
            }),
            JSON.stringify({
              type: "step_finish",
              part: {
                tokens: { input: 20, output: 4 },
                modelID: "anthropic/claude-sonnet-4-5",
              },
            }),
          ].join("\n"),
        });
      },
    );
    const result = await adapter.evaluate(request(root));
    assertEquals(invocation?.command, "opencode");
    assertEquals(invocation?.args.includes("--pure"), true);
    assertEquals(invocation?.args.includes("--model"), true);
    assertEquals(
      invocation?.env?.OPENCODE_CONFIG_CONTENT.includes('"bash":false'),
      true,
    );
    assertEquals(result.commands[0].canonicalCommandFamily, "workspace.read");
    assertEquals(result.usage, { inputTokens: 20, outputTokens: 4 });
    assertEquals(result.resolvedModel, "anthropic/claude-sonnet-4-5");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/pi-adapter.sigil::SigilPiAdapter::PiInvocation logic,constraints
Deno.test("Pi adapter uses its safe tool allowlist and preserves provider/model", async () => {
  const root = await Deno.makeTempDir();
  try {
    let invocation: ProviderProcessRequest | undefined;
    const adapter = new PiAdapter(
      "openai/gpt-5",
      (value) => {
        invocation = value;
        return Promise.resolve({
          code: 0,
          stdout: [
            JSON.stringify({ type: "session", version: 3, cwd: root }),
            JSON.stringify({ type: "agent_start" }),
            JSON.stringify({
              type: "tool_execution_start",
              toolCallId: "tool-1",
              toolName: "grep",
              args: { pattern: "Example" },
            }),
            JSON.stringify({
              type: "tool_execution_end",
              toolCallId: "tool-1",
              toolName: "grep",
              result: { content: [{ type: "text", text: "main.sigil" }] },
              isError: false,
            }),
            JSON.stringify({
              type: "message_end",
              message: {
                role: "assistant",
                content: [{
                  type: "text",
                  text: JSON.stringify({ findings: [] }),
                }],
                usage: { input: 30, output: 5 },
                model: "openai/gpt-5",
              },
            }),
            JSON.stringify({ type: "agent_end", messages: [] }),
          ].join("\n"),
        });
      },
      "pi",
    );
    const result = await adapter.evaluate(request(root));
    assertEquals(invocation?.command, "sandbox-exec");
    assertEquals(invocation?.args.includes("--no-session"), true);
    assertEquals(invocation?.args.includes("--no-extensions"), true);
    assertEquals(
      invocation?.args[invocation.args.indexOf("--tools") + 1],
      "read,grep,find,ls",
    );
    assertEquals(
      invocation?.args.slice(invocation.args.indexOf("--model") + 1)[0],
      "openai/gpt-5",
    );
    assertEquals(result.commands[0].canonicalCommandFamily, "workspace.grep");
    assertEquals(result.resolvedModel, "openai/gpt-5");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/codex-adapter.sigil::SigilCodexAdapter::CodexInvocation logic,cases
Deno.test("Codex adapter uses the last completed message as findings", async () => {
  const root = await Deno.makeTempDir();
  try {
    const adapter = new CodexAdapter(undefined, () =>
      Promise.resolve([
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Reviewing evidence." },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command: `/bin/zsh -lc "nl -ba adapter.sigil | sed -n '1,40p'"`,
            status: "completed",
            exit_code: 0,
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ findings: [] }),
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      ].join("\n")));
    const result = await adapter.evaluate(request(root));
    assertEquals(result.findings, []);
    assertEquals(result.commands[0].canonicalCommandFamily, "workspace.read");
    assertEquals(result.usage, { inputTokens: 10, outputTokens: 2 });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/pi-adapter.sigil::SigilPiAdapter::PiInvocation logic,constraints,cases
Deno.test("Pi command budget counts sequential operation starts", async () => {
  const root = await Deno.makeTempDir();
  try {
    const adapter = new PiAdapter(undefined, () =>
      Promise.resolve({
        code: 0,
        stdout: [
          JSON.stringify({ type: "agent_start" }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-1",
            toolName: "read",
            args: { path: "main.sigil" },
          }),
          JSON.stringify({
            type: "tool_execution_end",
            toolCallId: "tool-1",
            result: "source",
          }),
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "tool-2",
            toolName: "read",
            args: { path: "other.sigil" },
          }),
        ].join("\n"),
      }));
    const evaluation = request(root);
    await assertRejects(
      () =>
        adapter.evaluate({
          ...evaluation,
          budgets: { ...evaluation.budgets, maxCommands: 1 },
        }),
      AdapterFailure,
      "command budget",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/src/adapter.sigil::SigilAgentAdapter::ModelBinding constraints,cases
Deno.test("provider model mismatch rejects the complete result", async () => {
  const root = await Deno.makeTempDir();
  try {
    const adapter = new OpenCodeAdapter(
      "configured/model",
      () =>
        Promise.resolve({
          code: 0,
          stdout: [
            JSON.stringify({ type: "step_start", part: {} }),
            JSON.stringify({
              type: "text",
              part: { text: JSON.stringify({ findings: [] }) },
            }),
            JSON.stringify({
              type: "step_finish",
              part: {
                tokens: { input: 1, output: 1 },
                modelID: "different/model",
              },
            }),
          ].join("\n"),
        }),
    );
    await assertRejects(
      () => adapter.evaluate(request(root)),
      AdapterFailure,
      "different from the configured model",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
