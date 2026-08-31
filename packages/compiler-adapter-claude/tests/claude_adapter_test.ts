import {
  AdapterFailure,
  type AdapterSubprocessInvocation,
  type AgentEvaluationRequest,
  resolveAdapterRegistration,
} from "@qoherent/sigil-compiler";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { ClaudeAdapter, parseClaudeEvents } from "../src/mod.ts";

function request(
  adapter: ClaudeAdapter,
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

// @sigil tests packages/compiler-adapter-claude/src/claude-adapter.sigil::SigilClaudeCompilerAdapter interface,logic,constraints,cases
Deno.test("Claude adapter invokes ephemeral read-only stream JSON mode", async () => {
  let observed: AdapterSubprocessInvocation | undefined;
  const adapter = new ClaudeAdapter("sonnet", (invocation) => {
    observed = invocation;
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              name: "Bash",
              input: { command: "sigil check ." },
            }],
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              cache_read_input_tokens: 2,
            },
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: '{"findings":[]}',
          total_cost_usd: 0.01,
        }),
      ].join("\n"),
    });
  });
  const result = await adapter.evaluate(request(adapter));
  if (!observed) throw new Error("Claude was not invoked.");
  assertEquals(observed.command, "claude");
  assertEquals(observed.args.includes("--no-session-persistence"), true);
  assertEquals(observed.args.includes("--safe-mode"), true);
  assertEquals(observed.args.includes("--bare"), false);
  assertEquals(observed.args.includes("--permission-mode"), true);
  const schema = JSON.parse(
    observed.args[observed.args.indexOf("--json-schema") + 1],
  );
  assertEquals(schema.required, ["findings"]);
  assertEquals(schema.properties.findings.type, "array");
  assertEquals(observed.args[observed.args.indexOf("--model") + 1], "sonnet");
  assertMatch(observed.input, /Return ONLY valid JSON/);
  assertEquals(result.findings, []);
  assertEquals(result.commands[0].command, "sigil check .");
  assertEquals(result.cost?.amount, 0.01);
});

Deno.test("Claude adapter rejects persistent requests before invocation", async () => {
  let invoked = false;
  const adapter = new ClaudeAdapter(undefined, () => {
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

Deno.test("Claude registrations match the optional model exactly", () => {
  const defaultModel = new ClaudeAdapter();
  const selectedModel = new ClaudeAdapter("sonnet");
  assertEquals(
    resolveAdapterRegistration([defaultModel, selectedModel], {
      provider: "claude",
      implementationId: "builtin.claude-cli",
      implementationVersion: "0.7.1",
      model: "sonnet",
    }),
    selectedModel,
  );
});

Deno.test("Claude framing rejects unsuccessful or duplicate result events", () => {
  const error = assertRejects(
    () =>
      Promise.resolve().then(() =>
        parseClaudeEvents(
          JSON.stringify({
            type: "result",
            subtype: "error_max_turns",
            is_error: true,
          }),
          1000,
          1000,
          1000,
        )
      ),
    AdapterFailure,
  );
  return error.then((value) => assertEquals(value.kind, "execution"));
});

Deno.test("Claude framing rejects narration around a fenced result", () => {
  const error = assertRejects(
    () =>
      Promise.resolve().then(() =>
        parseClaudeEvents(
          JSON.stringify({
            type: "result",
            subtype: "success",
            result: 'Before\\n```json\\n{"findings":[]}\\n```',
          }),
          1000,
          1000,
          1000,
        )
      ),
    AdapterFailure,
  );
  return error.then((value) =>
    assertEquals(value.kind, "final-result-protocol")
  );
});
