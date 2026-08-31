import {
  type AdapterExecutionHandle,
  type AdapterExecutionResources,
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AgentEvaluationRequest,
  coordinateAdapterExecution,
  createAdapterSubprocessHandle,
  resolveAdapterRegistration,
  runAdapterSubprocess,
} from "@qoherent/sigil-compiler";
import { OpenCodeAdapter, parseOpenCodeEvents } from "../src/mod.ts";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";

function request(
  adapter: OpenCodeAdapter,
  persistence: "ephemeral" | "persistent" = "persistent",
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

function testExecutionHandle(): AdapterExecutionHandle {
  return {
    identity: "test.opencode@1",
    cleanup: async () => {},
  };
}

const testExecutionResources: AdapterExecutionResources = {
  declareResource() {},
  declareResultInput() {},
  observeResource() {},
  observeResultInput() {},
  reportResourceObservation() {},
  reportResultInputObservation() {},
  cleanupAttempt() {},
};

// @sigil tests packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter interface,logic,cases
Deno.test("OpenCode adapter invokes JSON run with restrictive persistent configuration", async () => {
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new OpenCodeAdapter("openai/gpt-5", (invocation) => {
    observed = invocation;
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "text", part: { text: '{"findings":' } }),
        JSON.stringify({ type: "text", part: { text: "[]}" } }),
        JSON.stringify({
          type: "step_finish",
          part: {
            tokens: { input: 12, output: 3, cache: { read: 2 } },
            cost: 0.01,
          },
        }),
      ].join("\n"),
    });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("OpenCode was not invoked.");
  assertEquals(observed.command, "opencode");
  assertEquals(observed.handle?.identity, "builtin.opencode-cli@0.7.1");
  assertEquals(observed.args.slice(0, 3), ["run", "--format", "json"]);
  assertEquals(observed.args.includes("--ephemeral"), false);
  assertEquals(
    observed.args.slice(observed.args.indexOf("--model") + 1)[0],
    "openai/gpt-5",
  );
  assertMatch(observed.input, /Return ONLY valid JSON/);
  assertMatch(observed.input, /\{"findings":\[\]\}/);
  const config = JSON.parse(observed.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
  assertEquals(config.permission.read, "allow");
  for (
    const permission of [
      "edit",
      "webfetch",
      "task",
      "external_directory",
      "question",
    ]
  ) assertEquals(config.permission[permission], "deny");
  assertEquals(adapter.capabilities.statePersistence, "persistent");
  assertEquals(result.findings, []);
  assertEquals(result.usage?.inputTokens, 12);
  assertEquals(result.cost?.amount, 0.01);
});

// @sigil tests packages/compiler-adapter-opencode/src/opencode-adapter.sigil::SigilOpenCodeCompilerAdapter::OpenCodeAdapter cases
Deno.test("OpenCode adapter rejects ephemeral requests before invocation", async () => {
  let invoked = false;
  const adapter = new OpenCodeAdapter(undefined, () => {
    invoked = true;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  const error = await assertRejects(
    () => adapter.evaluate(request(adapter, "ephemeral")),
    AdapterFailure,
  );
  assertEquals(error.kind, "capability-mismatch");
  assertEquals(invoked, false);
});

Deno.test("OpenCode registrations match the optional model exactly", () => {
  const defaultModel = new OpenCodeAdapter();
  const selectedModel = new OpenCodeAdapter("openai/gpt-5");
  assertEquals(
    resolveAdapterRegistration([defaultModel, selectedModel], {
      provider: "opencode",
      implementationId: "builtin.opencode-cli",
      implementationVersion: "0.7.1",
      model: "openai/gpt-5",
    }),
    selectedModel,
  );
});

Deno.test("OpenCode framing requires one bounded terminal result", () => {
  const error = assertRejects(
    () =>
      Promise.resolve().then(() =>
        parseOpenCodeEvents(
          `${JSON.stringify({ type: "text", part: { text: "{}" } })}\n${
            JSON.stringify({ type: "text", part: { text: "{}" } })
          }`,
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

Deno.test("OpenCode adapter ignores narration before the terminal stop turn", async () => {
  const stdout = [
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m1", type: "step-start" },
    }),
    JSON.stringify({
      type: "text",
      part: {
        messageID: "m1",
        type: "text",
        text: "Let me inspect the contract.",
      },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          input: { command: "read example.sigil" },
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", type: "step-finish", reason: "tool-calls" },
    }),
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m2", type: "step-start" },
    }),
    JSON.stringify({
      type: "text",
      part: { messageID: "m2", type: "text", text: '{"findings":[]}' },
    }),
    JSON.stringify({
      type: "step_finish",
      part: {
        messageID: "m2",
        type: "step-finish",
        reason: "stop",
        tokens: { input: 50, output: 5, cache: { read: 3 } },
        cost: 0.02,
      },
    }),
  ].join("\n");
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new OpenCodeAdapter(undefined, (invocation) => {
    observed = invocation;
    return Promise.resolve({ code: 0, stderr: "", stdout });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("OpenCode was not invoked.");
  assertEquals(result.findings, []);
  assertEquals(result.commands.length, 1);
  assertEquals(result.commands[0].command, "read example.sigil");
  assertEquals(result.usage?.inputTokens, 50);
  assertEquals(result.cost?.amount, 0.02);
});

Deno.test("parseOpenCodeEvents strips a markdown code fence around the result", () => {
  const stdout = [
    JSON.stringify({
      type: "text",
      part: {
        messageID: "m1",
        type: "text",
        text: '```json\n{"findings":[]}\n```',
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", reason: "stop" },
    }),
  ].join("\n");
  const result = parseOpenCodeEvents(stdout, 10_000, 10_000, 10_000);
  assertEquals(result.findings, []);
});

Deno.test("parseOpenCodeEvents reports the last finish reason without a stop turn", () => {
  const stdout = [
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m1", type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          input: { command: "read example.sigil" },
        },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m1", type: "step-finish", reason: "tool-calls" },
    }),
    JSON.stringify({
      type: "step_start",
      part: { messageID: "m2", type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "c2",
        state: { status: "completed", input: { command: "read other.sigil" } },
      },
    }),
    JSON.stringify({
      type: "step_finish",
      part: { messageID: "m2", type: "step-finish", reason: "tool-calls" },
    }),
  ].join("\n");
  let caught: AdapterFailure | undefined;
  try {
    parseOpenCodeEvents(stdout, 10_000, 10_000, 10_000);
  } catch (error) {
    caught = error as AdapterFailure;
  }
  if (!caught) throw new Error("parseOpenCodeEvents was expected to throw.");
  assertEquals(caught.kind, "final-result-protocol");
  assertMatch(caught.message, /last finish reason: tool-calls/);
});

Deno.test("coordinator rejects elapsed preflight without invoking provider", async () => {
  let invoked = false;
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now() - 10,
        elapsedTimeMs: 1,
        implementationIdentity: "test.opencode@1",
        handle: testExecutionHandle(),
        invoke: () => {
          invoked = true;
          return Promise.resolve("unexpected");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "elapsed-time");
  assertEquals(invoked, false);
});

Deno.test("coordinator does not invoke a provider after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        implementationIdentity: "test.opencode@1",
        handle: testExecutionHandle(),
        signal: controller.signal,
        invoke: () => {
          invoked = true;
          return Promise.resolve("unexpected");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "cancelled");
  assertEquals(invoked, false);
});

Deno.test("coordinator cleans an unstarted handle after pre-invocation cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  let cleaned = false;
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        providerCleanupMs: 10,
        implementationIdentity: "test.opencode@1",
        signal: controller.signal,
        handle: {
          identity: "test.opencode@1",
          cleanup: async () => {
            cleaned = true;
            await Promise.resolve();
          },
        },
        invoke: () => {
          invoked = true;
          return Promise.resolve("unexpected");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "cancelled");
  assertEquals(invoked, false);
  assertEquals(cleaned, true);
});

Deno.test("coordinator starts the provider before an in-transition cancellation submits", async () => {
  const controller = new AbortController();
  let invoked = false;
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        providerCleanupMs: 10,
        implementationIdentity: "test.opencode@1",
        handle: {
          identity: "test.opencode@1",
          cleanup: async () => {},
        },
        signal: controller.signal,
        invoke: () => {
          invoked = true;
          controller.abort();
          return new Promise<void>(() => {});
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "cancelled");
  assertEquals(invoked, true);
});

Deno.test("coordinator arbitrates cancellation before provider completion", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const providerFinished = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleaned = false;
  const execution = coordinateAdapterExecution({
    elapsedOrigin: performance.now(),
    elapsedTimeMs: 1_000,
    providerCleanupMs: 100,
    implementationIdentity: "test.opencode@1",
    handle: {
      identity: "test.opencode@1",
      cleanup: async () => {
        cleaned = true;
        await Promise.resolve();
      },
    },
    signal: controller.signal,
    invoke: async () => {
      await providerFinished;
      return "late result";
    },
  });
  controller.abort();
  const error = await assertRejects(() => execution, AdapterFailure);
  assertEquals(error.kind, "cancelled");
  assertEquals(cleaned, true);
  release();
});

Deno.test("coordinator records result inputs separately in cleanup evidence", async () => {
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        providerCleanupMs: 10,
        implementationIdentity: "test.opencode@1",
        handle: {
          identity: "test.opencode@1",
          cleanup: async () => {},
        },
        invoke: (_signal, resources) => {
          resources.declareResource("process:test");
          resources.observeResource("process:test", "active");
          resources.declareResultInput("stdout");
          resources.observeResultInput("stdout", "open");
          throw new AdapterFailure("execution", "test failure");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "cleanup");
  assertEquals(error.recovery?.resources[0].identity, "process:test");
  assertEquals(error.recovery?.resources[0].latestState, "active");
  assertEquals(error.recovery?.resources[0].observationStatus, "observed");
  assertEquals(
    typeof error.recovery?.resources[0].latestStateObservedAt,
    "number",
  );
  assertEquals(error.recovery?.resultInputs[0].identity, "stdout");
  assertEquals(error.recovery?.resultInputs[0].latestState, "open");
  assertEquals(error.recovery?.resultInputs[0].observationStatus, "observed");
  assertEquals(
    typeof error.recovery?.resultInputs[0].latestStateObservedAt,
    "number",
  );
});

Deno.test("coordinator waits for registered result inputs before accepting a result", async () => {
  let settleInput!: () => void;
  const execution = coordinateAdapterExecution({
    elapsedOrigin: performance.now(),
    elapsedTimeMs: 1_000,
    implementationIdentity: "test.opencode@1",
    handle: testExecutionHandle(),
    invoke: async (_signal, resources) => {
      resources.declareResultInput("stdout");
      resources.observeResultInput("stdout", "open");
      settleInput = () => resources.observeResultInput("stdout", "closed");
      await Promise.resolve();
      return "result";
    },
  });
  await Promise.resolve();
  assertEquals(
    await Promise.race([
      execution.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 0)),
    ]),
    true,
  );
  settleInput();
  assertEquals(await execution, "result");
});

Deno.test("coordinator exposes provider terminal submission and rejects a second result", async () => {
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        implementationIdentity: "test.opencode@1",
        handle: testExecutionHandle(),
        invoke: (_signal, _resources, _terminationControl, submit) => {
          submit({ kind: "result", value: "first" });
          submit({ kind: "result", value: "second" });
          return new Promise(() => {});
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "final-result-protocol");
});

Deno.test("coordinator preserves terminal proof after later observation failure", async () => {
  const error = await assertRejects(
    () =>
      coordinateAdapterExecution({
        elapsedOrigin: performance.now(),
        elapsedTimeMs: 1_000,
        providerCleanupMs: 10,
        implementationIdentity: "test.opencode@1",
        handle: {
          identity: "test.opencode@1",
          cleanup: async (_kind, _deadline, resources) => {
            resources.observeResource("process:test", "terminal");
            resources.reportResourceObservation(
              "process:test",
              "failed",
              "post-terminal status poll failed",
            );
            resources.observeResultInput("stdout", "cancelled");
            await Promise.resolve();
          },
        },
        invoke: async (_signal, resources) => {
          resources.declareResource("process:test");
          resources.observeResource("process:test", "active");
          resources.declareResultInput("stdout");
          resources.observeResultInput("stdout", "open");
          resources.declareResultInput("stderr");
          resources.observeResultInput("stderr", "open");
          await Promise.resolve();
          throw new AdapterFailure("execution", "test failure");
        },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "cleanup");
  assertEquals(error.recovery?.resources[0].latestState, "terminal");
  assertEquals(error.recovery?.resources[0].observationStatus, "observed");
  assertEquals(error.recovery?.resources[0].observationEvidence, [
    "post-terminal status poll failed",
  ]);
  assertEquals(error.recovery?.resultInputs[0].latestState, "cancelled");
  assertEquals(error.recovery?.resultInputs[0].observationStatus, "observed");
  assertEquals(error.recovery?.resultInputs[1].identity, "stderr");
  assertEquals(error.recovery?.resultInputs[1].latestState, "open");
});

Deno.test("OpenCode reports invalid request evidence without invoking its runner", async () => {
  let invoked = false;
  const adapter = new OpenCodeAdapter(undefined, () => {
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

Deno.test("OpenCode classifies initial request overflow as an operational limit", async () => {
  let invoked = false;
  const adapter = new OpenCodeAdapter(undefined, () => {
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

Deno.test("subprocess cancellation performs bounded verified cleanup", async () => {
  const controller = new AbortController();
  setTimeout(
    () =>
      controller.abort(
        new AdapterFailure("elapsed-time", "test deadline expired"),
      ),
    30,
  );
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.opencode@1",
        command: Deno.execPath(),
        args: ["eval", "setInterval(() => {}, 1000)"],
        cwd: Deno.cwd(),
        input: "",
        signal: controller.signal,
        providerCleanupMs: 500,
        maxInitialRequestChars: 1_000,
        maxProviderFrameChars: 1_000,
        handle: createAdapterSubprocessHandle("test.opencode@1"),
        resources: testExecutionResources,
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "elapsed-time");
});

Deno.test("subprocess frame-limit failure performs bounded verified cleanup", async () => {
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.opencode@1",
        command: Deno.execPath(),
        args: [
          "eval",
          'console.log("x".repeat(100)); setInterval(() => {}, 1000)',
        ],
        cwd: Deno.cwd(),
        input: "",
        signal: new AbortController().signal,
        providerCleanupMs: 500,
        maxInitialRequestChars: 1_000,
        maxProviderFrameChars: 10,
        handle: createAdapterSubprocessHandle("test.opencode@1"),
        resources: testExecutionResources,
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "operational-limit");
});

Deno.test("subprocess stderr frame-limit failure participates in live settlement", async () => {
  const error = await assertRejects(
    () =>
      runAdapterSubprocess({
        implementationIdentity: "test.opencode@1",
        command: Deno.execPath(),
        args: [
          "eval",
          'console.error("x".repeat(100)); setInterval(() => {}, 1000)',
        ],
        cwd: Deno.cwd(),
        input: "",
        signal: new AbortController().signal,
        providerCleanupMs: 500,
        maxInitialRequestChars: 1_000,
        maxProviderFrameChars: 10,
        handle: createAdapterSubprocessHandle("test.opencode@1"),
        resources: testExecutionResources,
        terminationControl: { requestPreventiveBudgetTermination() {} },
      }),
    AdapterFailure,
  );
  assertEquals(error.kind, "operational-limit");
});

Deno.test("subprocess handle rejects a second process attachment", () => {
  const handle = createAdapterSubprocessHandle("test.opencode@1");
  const child = {
    kill() {},
    unref() {},
  } as unknown as Deno.ChildProcess;
  handle.attach(
    child,
    Promise.resolve({ success: true, code: 0, signal: null }),
    Promise.resolve(""),
    Promise.resolve(""),
    testExecutionResources,
    ["process:test", "result-input:stdout", "result-input:stderr"],
  );
  const error = assertRejects(
    async () => {
      await handle.attach(
        child,
        Promise.resolve({ success: true, code: 0, signal: null }),
        Promise.resolve(""),
        Promise.resolve(""),
        testExecutionResources,
        ["process:test2", "result-input:stdout", "result-input:stderr"],
      );
    },
    AdapterFailure,
  );
  return error.then((failure) => assertEquals(failure.kind, "execution"));
});

Deno.test("subprocess reports frames from both output channels", async () => {
  const frames: { channel: string; text: string }[] = [];
  const result = await runAdapterSubprocess({
    implementationIdentity: "test.opencode@1",
    command: Deno.execPath(),
    args: ["eval", 'console.log("out"); console.error("err")'],
    cwd: Deno.cwd(),
    input: "",
    signal: new AbortController().signal,
    maxInitialRequestChars: 1_000,
    maxProviderFrameChars: 1_000,
    handle: createAdapterSubprocessHandle("test.opencode@1"),
    resources: testExecutionResources,
    terminationControl: { requestPreventiveBudgetTermination() {} },
    onFrame: (frame) => {
      frames.push(frame);
    },
  });
  assertEquals(result.code, 0);
  assertEquals(frames.map((frame) => frame.channel).sort(), [
    "stderr",
    "stdout",
  ]);
});
