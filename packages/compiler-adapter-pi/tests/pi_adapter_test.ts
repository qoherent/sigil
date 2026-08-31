import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AgentEvaluationRequest,
  resolveAdapterRegistration,
} from "@qoherent/sigil-compiler";
import { parsePiEvents, PiAdapter } from "../src/mod.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";

function request(
  adapter: PiAdapter,
  persistence: "ephemeral" | "persistent" = "ephemeral",
): AgentEvaluationRequest {
  return {
    stage: "semantic-readiness",
    purpose: "semantic",
    skill: "Inspect the selected Sigil.",
    allowedRules: ["SEMANTIC_AMBIGUITY"],
    implementationEvidence: "context-only",
    workspaceRoot: Deno.cwd(),
    workspaceSnapshotIdentity: "sha256:test-snapshot",
    target: {
      componentName: "Example",
      sigilFile: "example.sigil",
      initialPaths: ["example.sigil"],
      retrieval: {
        schema: "sigil-purpose-retrieval/v1",
        policyVersion: 1,
        workspaceSnapshotIdentity: "sha256:test-snapshot",
        target: {
          kind: "component",
          componentName: "Example",
          pathStatus: "accepted",
          path: "example.sigil",
        },
        purpose: "semantic",
        graph: { nodes: [], edges: [] },
        evidence: [],
        inclusionReasons: [],
        exclusions: [],
        context: { sections: [] },
        diagnostics: [],
        fingerprint: "sha256:test-retrieval",
      },
      retrievalBrief: {
        purpose: "semantic",
        componentName: "Example",
        sigilFile: "example.sigil",
        retrievalFingerprint: "sha256:test-retrieval",
        markdown: "Example retrieval context",
        allowedDirectReadPaths: ["example.sigil"],
      },
    },
    capabilities: {
      schemaVersion: 1,
      workspaceAccess: "read-only",
      agentToolNetwork: false,
      approvalEscalation: false,
      statePersistence: persistence,
    },
    commandPolicy: {
      allowedCommands: ["sigil check", "rg", "sed"],
      forbiddenCommands: ["file mutation", "network clients"],
    },
    observability: adapter.observability,
    budgets: {
      elapsedTimeMs: 30_000,
      maxCommands: 10,
      maxCommandOutputChars: 10_000,
      maxInputTokens: 1_000,
      maxOutputTokens: 1_000,
    },
    limits: {
      maxInitialRequestChars: 1_000_000,
      maxProviderFrameChars: 1_000_000,
      maxFinalResultChars: 1_000_000,
      maxRetainedCommandOutputChars: 10_000,
      providerCleanupMs: 100,
    },
  };
}

// @sigil tests packages/compiler-adapter-pi/src/pi-adapter.sigil::SigilPiCompilerAdapter::PiAdapter interface,logic,cases
Deno.test("Pi adapter invokes print JSON mode with ephemeral read-only tools", async () => {
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new PiAdapter("openai/gpt-5", (invocation) => {
    observed = invocation;
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "session", version: 3, id: "test" }),
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: '{"findings":[]}' }],
            stopReason: "stop",
            usage: {
              input: 12,
              output: 3,
              cacheRead: 2,
              cost: { total: 0.01 },
            },
          },
        }),
      ].join("\n"),
    });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("Pi was not invoked.");
  assertEquals(observed.command, "pi");
  assertEquals(observed.handle?.identity, "builtin.pi-cli@0.7.1");
  assertEquals(observed.args.includes("--print"), true);
  assertEquals(observed.args.includes("--mode"), true);
  assertEquals(
    observed.args[observed.args.indexOf("--mode") + 1],
    "json",
  );
  assertEquals(observed.args.includes("--no-session"), true);
  assertEquals(observed.args.includes("--no-skills"), true);
  assertEquals(observed.args.includes("--no-context-files"), true);
  assertEquals(observed.args.includes("--no-extensions"), true);
  assertEquals(observed.args.includes("--no-approve"), true);
  assertEquals(observed.args.includes("--offline"), true);
  assertEquals(
    observed.args[observed.args.indexOf("--tools") + 1],
    "read,grep,find,ls,bash",
  );
  assertEquals(
    observed.args[observed.args.indexOf("--model") + 1],
    "openai/gpt-5",
  );
  assertMatch(observed.input, /Return ONLY valid JSON/);
  assertMatch(observed.input, /\{"findings":\[\]\}/);
  assertEquals(adapter.capabilities.statePersistence, "ephemeral");
  assertEquals(result.findings, []);
  assertEquals(result.usage?.inputTokens, 12);
  assertEquals(result.cost?.amount, 0.01);
});

// @sigil tests packages/compiler-adapter-pi/src/pi-adapter.sigil::SigilPiCompilerAdapter::PiAdapter cases
Deno.test("Pi adapter rejects persistent requests before invocation", async () => {
  let invoked = false;
  const adapter = new PiAdapter(undefined, () => {
    invoked = true;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  const error = await assertRejects(
    () => adapter.evaluate(request(adapter, "persistent")),
    AdapterFailure,
  );
  assertEquals(error.kind, "capability-mismatch");
  assertEquals(invoked, false);
});

Deno.test("Pi reports invalid request evidence without invoking its runner", async () => {
  let invoked = false;
  const adapter = new PiAdapter(undefined, () => {
    invoked = true;
    throw new Error("runner should not be called");
  });
  const valid = request(adapter);
  const error = await assertRejects(
    () =>
      adapter.evaluate({
        ...valid,
        target: { ...valid.target, retrieval: undefined as never },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "incomplete-evidence");
  assertEquals(invoked, false);
});

Deno.test("Pi classifies initial request overflow as an operational limit", async () => {
  let invoked = false;
  const adapter = new PiAdapter(undefined, () => {
    invoked = true;
    throw new Error("runner should not be called");
  });
  const valid = request(adapter);
  const error = await assertRejects(
    () =>
      adapter.evaluate({
        ...valid,
        limits: { ...valid.limits, maxInitialRequestChars: 1 },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "operational-limit");
  assertEquals(invoked, false);
});

Deno.test("Pi registrations match the optional model exactly", () => {
  const defaultModel = new PiAdapter();
  const selectedModel = new PiAdapter("openai/gpt-5");
  assertEquals(
    resolveAdapterRegistration([defaultModel, selectedModel], {
      provider: "pi",
      implementationId: "builtin.pi-cli",
      implementationVersion: "0.7.1",
      model: "openai/gpt-5",
    }),
    selectedModel,
  );
});

Deno.test("Pi framing requires one bounded terminal result", () => {
  const error = assertRejects(
    () =>
      Promise.resolve().then(() =>
        parsePiEvents(
          [
            JSON.stringify({
              type: "message_end",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "{}" }],
                stopReason: "toolUse",
              },
            }),
            JSON.stringify({
              type: "message_end",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "{}" }],
                stopReason: "toolUse",
              },
            }),
          ].join("\n"),
          1_000,
          1_000,
          1_000,
        )
      ),
    AdapterFailure,
  );
  return error.then((value) =>
    assertEquals(value.kind, "final-result-protocol")
  );
});

Deno.test("Pi adapter ignores narration before the terminal stop turn", async () => {
  const stdout = [
    JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "sigil check ." },
    }),
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      result: "ok",
      isError: false,
    }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Let me inspect the contract." }],
        stopReason: "toolUse",
      },
    }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: '{"findings":[]}' }],
        stopReason: "stop",
        usage: {
          input: 50,
          output: 5,
          cacheRead: 3,
          cost: { total: 0.02 },
        },
      },
    }),
  ].join("\n");
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new PiAdapter(undefined, (invocation) => {
    observed = invocation;
    return Promise.resolve({ code: 0, stderr: "", stdout });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("Pi was not invoked.");
  assertEquals(result.findings, []);
  assertEquals(result.commands.length, 2);
  assertMatch(result.commands[0].command, /bash/);
  assertEquals(result.usage?.inputTokens, 50);
  assertEquals(result.cost?.amount, 0.02);
});

Deno.test("parsePiEvents strips a markdown code fence around the result", () => {
  const stdout = [
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: '```json\n{"findings":[]}\n```' }],
        stopReason: "stop",
      },
    }),
  ].join("\n");
  const result = parsePiEvents(stdout, 10_000, 10_000, 10_000);
  assertEquals(result.findings, []);
});

Deno.test("parsePiEvents reports the last stop reason without a stop turn", () => {
  const stdout = [
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "read",
      result: "ok",
      isError: false,
    }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "still working" }],
        stopReason: "toolUse",
      },
    }),
  ].join("\n");
  let caught: AdapterFailure | undefined;
  try {
    parsePiEvents(stdout, 10_000, 10_000, 10_000);
  } catch (error) {
    caught = error as AdapterFailure;
  }
  if (!caught) throw new Error("parsePiEvents was expected to throw.");
  assertEquals(caught.kind, "final-result-protocol");
  assertMatch(caught.message, /last stop reason: toolUse/);
});
