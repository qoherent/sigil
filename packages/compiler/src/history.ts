import { COMPILATION_REPORT_VERSION } from "./types.ts";
import type {
  CompilationHistoryStore,
  CompilationReport,
  CompilationTarget,
  CompilerDiagnostic,
  EffectiveProfile,
} from "./types.ts";

// @sigil implements packages/compiler/src/history-store.sigil::SigilCompilationHistoryStore::CompilationHistoryStore interface,logic,constraints,cases
export class FileCompilationHistoryStore implements CompilationHistoryStore {
  constructor(private readonly directory: string) {}

  async read(key: string): Promise<CompilationReport | undefined> {
    try {
      const value = JSON.parse(
        await Deno.readTextFile(`${this.directory}/${key}.json`),
      );
      return isCompatibleReport(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async write(key: string, report: CompilationReport): Promise<void> {
    await Deno.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.directory, 0o700).catch(() => {});
    const temporary = await Deno.makeTempFile({
      dir: this.directory,
      prefix: `${key}.`,
      suffix: ".tmp",
    });
    try {
      await Deno.chmod(temporary, 0o600).catch(() => {});
      const file = await Deno.open(temporary, { write: true, truncate: true });
      try {
        await file.write(
          new TextEncoder().encode(`${JSON.stringify(report)}\n`),
        );
        await file.sync();
      } finally {
        file.close();
      }
      await Deno.rename(temporary, `${this.directory}/${key}.json`);
    } catch (error) {
      await Deno.remove(temporary).catch(() => {});
      throw error;
    }
  }
}

export async function compilationHistoryKey(
  workspaceRoot: string,
  target: CompilationTarget,
  profile: EffectiveProfile,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({
      reportVersion: COMPILATION_REPORT_VERSION,
      workspaceRoot: workspaceRoot.replaceAll("\\", "/"),
      target,
      profile: profile.fingerprint,
    })),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function applyDiagnosticLifecycle(
  current: readonly CompilerDiagnostic[],
  previous?: CompilationReport,
): readonly CompilerDiagnostic[] {
  if (!previous) return current;
  const prior = new Map(previous.diagnostics.map((item) => [
    item.fingerprint,
    item,
  ]));
  const active = current.map((item) => {
    const earlier = prior.get(item.fingerprint);
    return {
      ...item,
      lifecycle: earlier
        ? earlier.lifecycle === "resolved" ? "regressed" : "unchanged"
        : "new",
    } as CompilerDiagnostic;
  });
  const fingerprints = new Set(current.map((item) => item.fingerprint));
  return [
    ...active,
    ...previous.diagnostics
      .filter((item) =>
        item.lifecycle !== "resolved" && !fingerprints.has(item.fingerprint)
      )
      .map((item) => ({ ...item, lifecycle: "resolved" as const })),
  ];
}

function isCompatibleReport(value: unknown): value is CompilationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report.reportVersion === COMPILATION_REPORT_VERSION &&
    typeof report.runId === "string" &&
    typeof report.workspaceRoot === "string" &&
    isCompilationTarget(report.target) &&
    !!report.requestedScope && typeof report.requestedScope === "object" &&
    !!report.selection && typeof report.selection === "object" &&
    Array.isArray(report.componentNames) &&
    report.componentNames.every((item) => typeof item === "string") &&
    ["red", "yellow", "green"].includes(String(report.status)) &&
    typeof report.startedAt === "string" &&
    typeof report.completedAt === "string" &&
    typeof report.sourceFingerprint === "string" &&
    (report.requestedStage === undefined ||
      typeof report.requestedStage === "string") &&
    Array.isArray(report.stages) &&
    Array.isArray(report.diagnostics) &&
    report.diagnostics.every(isCompatibleDiagnostic) &&
    !!report.profile && typeof report.profile === "object" &&
    typeof (report.profile as Record<string, unknown>).fingerprint === "string";
}

function isCompilationTarget(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "workspace") return true;
  if (target.kind === "component") {
    return typeof target.name === "string" &&
      (target.declarationPath === undefined ||
        typeof target.declarationPath === "string");
  }
  if (
    !["file", "location"].includes(String(target.kind)) ||
    typeof target.filePath !== "string"
  ) return false;
  return target.kind !== "location" ||
    (isPositiveInteger(target.line) && isPositiveInteger(target.column));
}

function isCompatibleDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  return [
    "code",
    "fingerprint",
    "stage",
    "skill",
    "message",
    "evidence",
    "impact",
    "correction",
    "evaluator",
  ].every((name) => typeof diagnostic[name] === "string") &&
    ["error", "warning", "optimization", "information"].includes(
      String(diagnostic.severity),
    ) &&
    ["new", "unchanged", "resolved", "regressed"].includes(
      String(diagnostic.lifecycle),
    ) &&
    (diagnostic.filePath === undefined ||
      typeof diagnostic.filePath === "string") &&
    (diagnostic.range === undefined || isRange(diagnostic.range)) &&
    Array.isArray(diagnostic.semanticSubjects) &&
    diagnostic.semanticSubjects.every(isSemanticSubject);
}

function isSemanticSubject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const subject = value as Record<string, unknown>;
  return ["direct", "governing", "related"].includes(
    String(subject.relation),
  ) &&
    typeof subject.sigilPath === "string" &&
    typeof subject.componentName === "string" &&
    ["component", "expand"].includes(String(subject.ownerKind)) &&
    typeof subject.ownerName === "string" &&
    [
      "goal",
      "interface",
      "state",
      "logic",
      "constraints",
      "decisions",
      "cases",
    ].includes(String(subject.sectionName)) &&
    (subject.conceptIdentifier === undefined ||
      typeof subject.conceptIdentifier === "string") &&
    (subject.semanticUnit === undefined ||
      isSemanticUnit(subject.semanticUnit));
}

function isSemanticUnit(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const unit = value as Record<string, unknown>;
  return isRange(unit.range) && typeof unit.fingerprint === "string";
}

function isRange(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  return isPositiveInteger(position.line) &&
    isPositiveInteger(position.column);
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}
