import { resolve } from "node:path";
import {
  compile,
  loadCompilationConfiguration,
  resolveCompilationSettings,
} from "./compiler.ts";
import { SigilProposalWorkspace } from "./proposal-workspace.ts";
import { FileCompilationSessionStore } from "./session-store.ts";
import { SigilCompilationSession } from "./session.ts";
import { CompilerFailure } from "./status.ts";
import type {
  CompilationFocus,
  CompilationSessionRecord,
  CompilationSessionStartResult,
  CompilationTarget,
} from "./types.ts";

export interface CompilationSessionCreation {
  readonly session: SigilCompilationSession;
  readonly result: CompilationSessionStartResult;
}

// @sigil implements packages/compiler/src/session-factory.sigil::SigilCompilationSessionFactory interface,logic,cases
export class SigilCompilationSessionFactory {
  constructor(
    private readonly store: FileCompilationSessionStore =
      new FileCompilationSessionStore(),
  ) {}

  async create(
    workspacePath: string,
    target: CompilationTarget,
    profileName: string,
    focus: CompilationFocus,
  ): Promise<CompilationSessionCreation> {
    validateInvocation(target, profileName, focus);
    const configuration = await loadCompilationConfiguration(workspacePath);
    const settings = resolveCompilationSettings(configuration);
    await compile(workspacePath, target, {
      profile: profileName,
      requestedStage: "deterministic-foundation",
      disableHistory: true,
    });
    const identity = crypto.randomUUID();
    const workspace = await SigilProposalWorkspace.create(
      resolve(workspacePath),
      identity,
    );
    const expiresAt = new Date(
      Date.now() + settings.limits.sessionTtlMs,
    ).toISOString();
    const record: CompilationSessionRecord = {
      version: 1,
      sessionIdentity: identity,
      workspacePath: resolve(workspacePath),
      target,
      profileName,
      focus,
      lifecycle: "active",
      expiresAt,
      baseEpoch: 1,
      baseFingerprint: workspace.baseFingerprint,
      proposalWorkspace: workspace.workspace.persistedState(),
    };
    try {
      const created = await this.store.create(record);
      await created.lease.release();
    } catch (error) {
      await workspace.workspace.close().catch(() => {});
      throw error;
    }
    return {
      session: new SigilCompilationSession(
        identity,
        this.store,
        compile,
        settings.limits.sessionTtlMs,
      ),
      result: {
        sessionIdentity: identity,
        baseEpoch: 1,
        baseFingerprint: workspace.baseFingerprint,
        expiresAt,
      },
    };
  }
}

function validateInvocation(
  target: CompilationTarget,
  profileName: string,
  focus: CompilationFocus,
): void {
  if (!profileName || !["design", "implementation"].includes(focus)) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "Invalid session profile or focus.",
    );
  }
  const selector = target.kind === "component"
    ? target.name
    : target.kind === "file" || target.kind === "location"
    ? target.filePath
    : undefined;
  if (
    selector !== undefined &&
    (!selector || selector.startsWith("/") || selector.includes(".."))
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_INVOCATION",
      "Invalid compilation session target.",
    );
  }
}
