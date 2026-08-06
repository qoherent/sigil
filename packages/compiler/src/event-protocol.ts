import type { CompilationEvent } from "./types.ts";

export interface CompilationEventStream {
  readonly runId: string;
  emit(
    type: CompilationEvent["type"],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

// @sigil implements packages/compiler/src/event-protocol.sigil::SigilCompilationEventProtocol interface,constraints,cases
export function createCompilationEventStream(
  runId: string,
  sink?: (event: CompilationEvent) => void | Promise<void>,
): CompilationEventStream {
  let sequence = 0;
  let terminal = false;
  return {
    runId,
    async emit(type, payload) {
      if (terminal) throw new Error("Compilation event stream is settled.");
      await sink?.({
        protocolVersion: 1,
        runId,
        sequence: ++sequence,
        type,
        payload,
      });
      if (["completed", "failed", "cancelled"].includes(type)) terminal = true;
    },
  };
}
