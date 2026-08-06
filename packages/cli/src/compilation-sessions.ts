import {
  type CompilationEvent,
  type CompilationFocus,
  type CompilationProposal,
  type CompilationTarget,
  SigilCompilationSession,
  SigilCompilationSessionFactory,
} from "@qoherent/sigil-compiler";

export interface CompilationSessionHost {
  readonly factory?: SigilCompilationSessionFactory;
  readonly readStdin?: () => Promise<string>;
  readonly onEvent?: (event: CompilationEvent) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

// @sigil implements packages/cli/_module.sigil::SigilCli::CompilationSessionFacade logic,constraints,cases
export async function startCompilationSession(
  workspacePath: string,
  target: CompilationTarget,
  profile: string,
  focus: CompilationFocus,
  host: CompilationSessionHost = {},
) {
  const factory = host.factory ?? new SigilCompilationSessionFactory();
  return (await factory.create(workspacePath, target, profile, focus)).result;
}

export async function evaluateCompilationSession(
  sessionIdentity: string,
  host: CompilationSessionHost = {},
) {
  const text = await (host.readStdin ?? readStandardInput)();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Compilation proposal must be one JSON object: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const proposal = validateProposal(value);
  return new SigilCompilationSession(sessionIdentity).evaluate(proposal, {
    cancellationSignal: host.signal,
    onEvent: host.onEvent,
  });
}

export function refreshCompilationSession(sessionIdentity: string) {
  return new SigilCompilationSession(sessionIdentity).refresh();
}

export function closeCompilationSession(sessionIdentity: string) {
  return new SigilCompilationSession(sessionIdentity).close();
}

async function readStandardInput(): Promise<string> {
  return await new Response(Deno.stdin.readable).text();
}

function validateProposal(value: unknown): CompilationProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Compilation proposal must be an object.");
  }
  const sources = (value as Record<string, unknown>).sources;
  if (
    !sources || typeof sources !== "object" || Array.isArray(sources) ||
    Object.values(sources).some((source) => typeof source !== "string")
  ) {
    throw new Error(
      "Compilation proposal sources must map paths to complete source strings.",
    );
  }
  return { sources: sources as Readonly<Record<string, string>> };
}
