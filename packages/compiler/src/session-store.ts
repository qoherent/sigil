import { join } from "node:path";
import { sessionParent } from "./proposal-workspace.ts";
import { CompilerFailure } from "./status.ts";
import type { CompilationSessionRecord } from "./types.ts";

export class CompilationSessionLease {
  private released = false;
  constructor(
    readonly sessionIdentity: string,
    readonly directory: string,
    private readonly file: Deno.FsFile,
  ) {}

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      await this.file.unlock();
    } finally {
      this.file.close();
    }
  }

  assertActive(): void {
    if (this.released) {
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Session lease has been released.",
      );
    }
  }
}

export interface OpenCompilationSession {
  readonly record: CompilationSessionRecord;
  readonly lease: CompilationSessionLease;
}

// @sigil implements packages/compiler/src/session-store.sigil::SigilCompilationSessionStore interface,logic,constraints,cases
export class FileCompilationSessionStore {
  async create(
    record: CompilationSessionRecord,
  ): Promise<OpenCompilationSession> {
    validateRecord(record);
    const directory = sessionDirectory(record.sessionIdentity);
    try {
      await Deno.mkdir(sessionParent(), { recursive: true, mode: 0o700 });
      await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
      await Deno.chmod(directory, 0o700).catch(() => {});
      await Deno.writeTextFile(
        join(directory, ".owner.json"),
        JSON.stringify({
          formatVersion: 1,
          sessionIdentity: record.sessionIdentity,
        }),
        { createNew: true, mode: 0o600 },
      );
      const lease = await acquire(record.sessionIdentity, directory);
      try {
        await writeRecord(directory, record, true);
        return { record, lease };
      } catch (error) {
        await lease.release();
        throw error;
      }
    } catch (error) {
      if (error instanceof CompilerFailure) throw error;
      throw hostFailure("Could not create compilation session", error);
    }
  }

  async open(sessionIdentity: string): Promise<OpenCompilationSession> {
    validateIdentity(sessionIdentity);
    const directory = sessionDirectory(sessionIdentity);
    await verifyEnvelope(directory, sessionIdentity);
    const lease = await acquire(sessionIdentity, directory);
    try {
      const record = JSON.parse(
        await Deno.readTextFile(join(directory, "record.json")),
      );
      validateRecord(record);
      if (record.sessionIdentity !== sessionIdentity) {
        throw new CompilerFailure(
          "COMPILER_WORKSPACE_STATE",
          "Session record identity mismatch.",
        );
      }
      return { record, lease };
    } catch (error) {
      await lease.release();
      if (error instanceof CompilerFailure) throw error;
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Session record is missing or malformed.",
        { cause: error },
      );
    }
  }

  async commit(
    lease: CompilationSessionLease,
    record: CompilationSessionRecord,
  ): Promise<void> {
    lease.assertActive();
    await verifyEnvelope(lease.directory, lease.sessionIdentity);
    validateRecord(record);
    if (record.sessionIdentity !== lease.sessionIdentity) {
      throw new CompilerFailure(
        "COMPILER_WORKSPACE_STATE",
        "Session record identity mismatch.",
      );
    }
    try {
      await writeRecord(lease.directory, record, false);
    } catch (error) {
      if (error instanceof CompilerFailure) throw error;
      throw hostFailure("Could not commit compilation session", error);
    }
  }

  async remove(lease: CompilationSessionLease): Promise<void> {
    lease.assertActive();
    await verifyEnvelope(lease.directory, lease.sessionIdentity);
    try {
      await Deno.remove(join(lease.directory, "record.json")).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
      await Deno.remove(join(lease.directory, ".owner.json"));
      await Deno.remove(join(lease.directory, "session.lock"));
      await Deno.remove(lease.directory);
      await lease.release();
    } catch (error) {
      throw hostFailure("Could not remove compilation session", error);
    }
  }
}

function sessionDirectory(identity: string): string {
  return join(sessionParent(), identity);
}

async function acquire(
  identity: string,
  directory: string,
): Promise<CompilationSessionLease> {
  const file = await Deno.open(join(directory, "session.lock"), {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  });
  try {
    if (!await file.tryLock(true)) {
      file.close();
      throw new CompilerFailure(
        "COMPILER_SESSION_BUSY",
        "Compilation session is busy.",
      );
    }
    return new CompilationSessionLease(identity, directory, file);
  } catch (error) {
    try {
      file.close();
    } catch { /* already closed */ }
    if (error instanceof CompilerFailure) throw error;
    throw hostFailure("Could not acquire compilation session lock", error);
  }
}

async function verifyEnvelope(
  directory: string,
  identity: string,
): Promise<void> {
  try {
    const directoryInfo = await Deno.lstat(directory);
    const markerPath = join(directory, ".owner.json");
    const markerInfo = await Deno.lstat(markerPath);
    if (
      !directoryInfo.isDirectory || directoryInfo.isSymlink ||
      !markerInfo.isFile || markerInfo.isSymlink
    ) throw new Error("unsafe storage envelope");
    const marker = JSON.parse(await Deno.readTextFile(markerPath));
    if (marker.formatVersion !== 1 || marker.sessionIdentity !== identity) {
      throw new Error("ownership marker mismatch");
    }
  } catch (error) {
    throw new CompilerFailure(
      "COMPILER_WORKSPACE_OWNERSHIP_UNVERIFIED",
      "Compilation session ownership could not be verified.",
      { cause: error },
    );
  }
}

async function writeRecord(
  directory: string,
  record: CompilationSessionRecord,
  createOnly: boolean,
): Promise<void> {
  const target = join(directory, "record.json");
  if (createOnly) {
    await Deno.writeTextFile(target, `${JSON.stringify(record)}\n`, {
      createNew: true,
      mode: 0o600,
    });
    return;
  }
  const temporary = join(directory, `record-${crypto.randomUUID()}.tmp`);
  const file = await Deno.open(temporary, {
    createNew: true,
    write: true,
    mode: 0o600,
  });
  try {
    await file.write(new TextEncoder().encode(`${JSON.stringify(record)}\n`));
    await file.sync();
  } finally {
    file.close();
  }
  try {
    await Deno.rename(temporary, target);
  } catch (error) {
    await Deno.remove(temporary).catch(() => {});
    throw error;
  }
}

function validateRecord(
  value: unknown,
): asserts value is CompilationSessionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CompilerFailure(
      "COMPILER_WORKSPACE_STATE",
      "Invalid session record.",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 || typeof record.sessionIdentity !== "string" ||
    typeof record.workspacePath !== "string" ||
    typeof record.profileName !== "string" ||
    !["design", "implementation"].includes(String(record.focus)) ||
    typeof record.expiresAt !== "string" ||
    !Number.isSafeInteger(record.baseEpoch) ||
    typeof record.baseFingerprint !== "string" || !record.proposalWorkspace ||
    typeof record.proposalWorkspace !== "object"
  ) {
    throw new CompilerFailure(
      "COMPILER_WORKSPACE_STATE",
      "Invalid version-1 session record.",
    );
  }
  validateIdentity(record.sessionIdentity);
}

function validateIdentity(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(value)
  ) {
    throw new CompilerFailure(
      "COMPILER_INVALID_SESSION_IDENTITY",
      "Invalid compilation session identity.",
    );
  }
}

function hostFailure(message: string, cause: unknown): CompilerFailure {
  return new CompilerFailure(
    "COMPILER_WORKSPACE_HOST_FAILURE",
    `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}
