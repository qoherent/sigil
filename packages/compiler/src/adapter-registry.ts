import type { AgentAdapter, AgentProvider } from "./types.ts";
import { AdapterFailure } from "./adapter-runtime.ts";
import { ClaudeAdapter } from "./claude-adapter.ts";
import { CodexAdapter } from "./codex-adapter.ts";
import { OpenCodeAdapter } from "./opencode-adapter.ts";
import { PiAdapter } from "./pi-adapter.ts";

// @sigil implements packages/compiler/src/adapter-registry.sigil::SigilAgentAdapterRegistry::AgentAdapterRegistry interface,logic,constraints
export function resolveAgentAdapter(
  provider: AgentProvider,
  model?: string,
  id: string = provider,
): AgentAdapter {
  if (model !== undefined && !validModelIdentifier(model)) {
    throw new AdapterFailure(
      "AGENT_REQUEST_INVALID",
      `Evaluator ${
        JSON.stringify(id)
      } model must be a non-empty provider-native identifier.`,
    );
  }
  switch (provider) {
    case "codex":
      return new CodexAdapter(model, undefined, id);
    case "claude":
      return new ClaudeAdapter(model, id);
    case "opencode":
      return new OpenCodeAdapter(model, undefined, id);
    case "pi":
      return new PiAdapter(model, undefined, id);
  }
}

export function validModelIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.trim() === value &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    });
}
