import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type CompilationFocus = "design" | "implementation";
export type DesignState = "coherent" | "loose" | "disjoint" | "incomplete";
export type ImplementationState =
  | "closed"
  | "converged"
  | "drift"
  | "incomplete";
export interface NativeLocation {
  readonly side: CompilationFocus;
  readonly source: string;
  readonly coordinate_system: "utf8-bytes" | "utf16-lines";
  readonly source_digest?: string;
  readonly range?: { readonly start: number; readonly end: number };
  readonly implementation_range?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}
export interface DesignFinding {
  readonly class:
    | "contradiction"
    | "ownership-conflict"
    | "unmet-obligation"
    | "interpretation"
    | "flow"
    | "gap";
  readonly law: string;
  readonly subject: string;
  readonly object: string;
  readonly claims: readonly string[];
  readonly component: string;
  readonly section: string;
  readonly detail: string;
  readonly locations?: readonly NativeLocation[];
}
export interface ImplementationFinding {
  readonly law: string;
  readonly subject: string;
  readonly object: string;
  readonly detail: string;
  readonly claims: readonly string[];
  readonly codeRows: readonly unknown[];
  readonly locations: readonly NativeLocation[];
}
/** The editor presentation of a native law finding. */
export interface NativeFinding {
  readonly code: string;
  readonly side: CompilationFocus;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly locations: readonly NativeLocation[];
}
export interface NativeDiagnostics {
  readonly items: readonly NativeFinding[];
}
export interface DesignReport {
  readonly version: 6;
  readonly source: string;
  readonly state: DesignState;
  readonly identity: Readonly<Record<string, unknown>>;
  readonly iterations: number;
  readonly findings: readonly DesignFinding[];
  readonly linked?: { readonly workspaceDigest: string };
  readonly unread?: readonly {
    source: string;
    component: string;
    section: string;
    facets: readonly string[];
    refusal?: string;
  }[];
  readonly unresolvedImports?: readonly {
    source: string;
    path: string;
    provider: string;
    status: string;
  }[];
}
export interface ImplementationReport {
  readonly version: 1;
  readonly source: "workspace";
  readonly state: ImplementationState;
  readonly designState: DesignState;
  readonly identity: Readonly<Record<string, unknown>>;
  readonly iterations: number;
  readonly incompleteReasons: readonly string[];
  readonly findings: readonly ImplementationFinding[];
  readonly undesignedFiles: readonly string[];
  readonly undesignedElements: readonly string[];
  readonly unanswered: readonly ImplementationFinding[];
  readonly unreadFiles: readonly string[];
  readonly selection: unknown;
  readonly designFindings: readonly DesignFinding[];
}
export type NativeReport = DesignReport | ImplementationReport;
export interface CompilationProcess {
  readonly result: Promise<NativeReport>;
  cancel(): void;
}
export interface CompilationOptions {
  readonly executable: string;
  readonly cwd: string;
  readonly focus: CompilationFocus;
  readonly file?: string;
  readonly onLog: (text: string) => void;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,logic,constraints,cases
export function runCompilationProcess(
  options: CompilationOptions,
): CompilationProcess {
  const controller = new AbortController();
  const signal = controller.signal;
  const result = (async () => {
    const focus = options.file?.endsWith(".sigil") ? "design" : options.focus;
    const args = focus === "implementation" ? ["align", "check"] : ["check"];
    args.push("--root", options.cwd);
    if (focus === "design" && options.file?.endsWith(".sigil")) {
      args.push("--source", options.file);
    }
    const native = await runJson(
      options.executable,
      args,
      options.cwd,
      signal,
      options.onLog,
    );
    const summary = native.value;
    if (
      !object(summary) || native.code > 1 ||
      summary.version !== (focus === "design" ? 6 : 1) ||
      !validState(summary.state, focus, native.code) ||
      typeof summary.scope !== "string" || !count(summary.findings) ||
      typeof summary.report !== "string" ||
      typeof summary.workspaceDigest !== "string" ||
      typeof summary.guidanceFingerprint !== "string" ||
      !count(summary.vocabularyGeneration)
    ) {
      throw incompatible(focus, native.code);
    }
    const reportPath = await realpath(
      path.resolve(options.cwd, summary.report),
    );
    const relative = path.relative(
      await realpath(path.join(options.cwd, ".sigil", "claims")),
      reportPath,
    );
    if (
      !relative || path.isAbsolute(relative) ||
      relative.split(path.sep).includes("..")
    ) {
      throw new Error(
        "Incompatible native report path outside the workspace claims store.",
      );
    }
    if ((await stat(reportPath)).size > 64 * 1024 * 1024) {
      throw new Error("Compiler JSON exceeds 64 MiB.");
    }
    const report = parseNativeReport(
      JSON.parse(await readFile(reportPath, "utf8")),
      focus,
      native.code,
    );
    if (signal.aborted) throw new Error("Compilation cancelled.");
    if (
      report.state !== summary.state || report.source !== summary.scope ||
      report.findings.length !== summary.findings ||
      summary.workspaceDigest !==
        (report.version === 6
          ? report.linked?.workspaceDigest
          : report.identity.workspaceDigest) ||
      summary.guidanceFingerprint !== report.identity.guidanceFingerprint ||
      summary.vocabularyGeneration !== report.identity.vocabularyGeneration ||
      (report.version === 1 && (report.designState !== summary.designState ||
        JSON.stringify(report.incompleteReasons) !==
          JSON.stringify(summary.incompleteReasons)))
    ) {
      throw new Error(
        "Incompatible native summary and stored report; compile again.",
      );
    }
    return report;
  })();
  return { result, cancel: () => controller.abort() };
}

/** One bounded subprocess; cleanup waits for exit, including forced termination. */
function runJson(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  onLog: (text: string) => void,
): Promise<{ value: unknown; code: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Compilation cancelled."));
      return;
    }
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      killTimer.unref();
    };
    const abort = () => fail(new Error("Compilation cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => fail(new Error("Compilation exceeded 120 seconds.")),
      120_000,
    );
    timeout.unref();
    child.once("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) {
        fail(new Error("Compiler JSON exceeds 64 MiB."));
        return;
      }
      if (!failure) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) {
        fail(new Error("Compiler stderr exceeds 1 MiB."));
        return;
      }
      if (!failure) onLog(chunk.toString("utf8"));
    });
    child.once("close", (code, closeSignal) => {
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (failure) {
        reject(failure);
        return;
      }
      if (closeSignal || code === null) {
        reject(
          new Error(`Compiler terminated: ${closeSignal ?? "unknown exit"}.`),
        );
        return;
      }
      try {
        resolve({
          value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          code,
        });
      } catch {
        reject(
          new Error(
            `Expected a current native JSON report from ${executable} (exit ${code}). See Sigil output and executable settings.`,
          ),
        );
      }
    });
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}
function location(value: unknown): boolean {
  if (
    !object(value) ||
    !["design", "implementation"].includes(String(value.side)) ||
    typeof value.source !== "string" || !value.source ||
    path.isAbsolute(value.source) ||
    value.source.split(/[\\/]/).includes("..") ||
    value.coordinate_system !== "utf8-bytes" ||
    typeof value.source_digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.source_digest) ||
    value.implementation_range !== undefined
  ) return false;
  return object(value.range) && count(value.range.start) &&
    count(value.range.end) && value.range.end >= value.range.start;
}
function finding(value: unknown, focus: CompilationFocus): boolean {
  if (
    !object(value) ||
    !["law", "subject", "object", "detail"].every((key) =>
      typeof value[key] === "string"
    ) ||
    !strings(value.claims) || (value.locations !== undefined &&
      (!Array.isArray(value.locations) || !value.locations.every(location)))
  ) return false;
  return focus === "design"
    ? [
      "contradiction",
      "ownership-conflict",
      "unmet-obligation",
      "interpretation",
      "flow",
      "gap",
    ].includes(String(value.class)) &&
      typeof value.component === "string" && typeof value.section === "string"
    : Array.isArray(value.codeRows) && Array.isArray(value.locations);
}
function findings(value: unknown, focus: CompilationFocus): boolean {
  return Array.isArray(value) && value.every((item) => finding(item, focus));
}
function validState(
  value: unknown,
  focus: CompilationFocus,
  exit: number,
): boolean {
  const states = focus === "design"
    ? ["coherent", "loose", "disjoint", "incomplete"]
    : ["closed", "converged", "drift", "incomplete"];
  const index = states.indexOf(String(value));
  return index >= 0 && exit === (index < 2 ? 0 : 1);
}
function incompatible(focus: CompilationFocus, exit: number): Error {
  return new Error(
    `Incompatible ${focus} report or gate exit ${exit}; configure the current sigilc executable.`,
  );
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface constraints,cases
export function parseNativeReport(
  value: unknown,
  focus: CompilationFocus,
  exit: number,
): NativeReport {
  if (
    object(value) && value.version === (focus === "design" ? 6 : 1) &&
    typeof value.source === "string" && object(value.identity) &&
    count(value.iterations) &&
    validState(value.state, focus, exit) && findings(value.findings, focus)
  ) {
    if (focus === "design") {
      if (
        (value.unread === undefined ||
          (Array.isArray(value.unread) &&
            value.unread.every((item) =>
              object(item) && typeof item.source === "string" &&
              typeof item.component === "string" &&
              typeof item.section === "string" && strings(item.facets)
            ))) &&
        (value.unresolvedImports === undefined ||
          (Array.isArray(value.unresolvedImports) &&
            value.unresolvedImports.every((item) =>
              object(item) &&
              ["source", "path", "provider", "status"].every((key) =>
                typeof item[key] === "string"
              )
            )))
      ) return value as unknown as DesignReport;
    } else if (
      value.source === "workspace" &&
      ["coherent", "loose", "disjoint", "incomplete"].includes(
        String(value.designState),
      ) &&
      strings(value.incompleteReasons) && strings(value.undesignedFiles) &&
      strings(value.undesignedElements) &&
      strings(value.unreadFiles) && object(value.selection) &&
      findings(value.unanswered, "implementation") &&
      findings(value.designFindings, "design")
    ) return value as unknown as ImplementationReport;
  }
  throw incompatible(focus, exit);
}

export function nativeState(report: NativeReport): string {
  return report.state[0].toUpperCase() + report.state.slice(1);
}
export function incompleteExplanation(report: NativeReport): string {
  if (report.state !== "incomplete") return "";
  if (report.version === 6) {
    const reasons = [
      ...(report.unread ?? []).map((unit) =>
        `Unread ${unit.source}: ${unit.component} ${unit.section}${
          unit.refusal ? ` (${unit.refusal})` : ""
        }`
      ),
      ...(report.unresolvedImports ?? []).map((item) =>
        `Unresolved import ${item.path} from ${item.source}: ${item.status}`
      ),
    ];
    return [...reasons, "Run sigil-compute-design to supply design readings."]
      .join("\n");
  }
  return [
    ...report.incompleteReasons,
    ...report.unreadFiles.map((file) => `Unread ${file}`),
    "Run sigil-compute-design for design readings and sigil-compute-align for implementation readings.",
  ].join("\n");
}

export function diagnosticGroups(
  report: NativeReport,
): readonly NativeDiagnostics[] {
  const design = (findings: readonly DesignFinding[]): NativeDiagnostics => ({
    items: findings.map((f) => ({
      code: f.law,
      side: "design",
      severity: f.class === "contradiction" || f.class === "ownership-conflict"
        ? "error"
        : "warning",
      message: f.detail,
      locations: f.locations ?? [],
    })),
  });
  if (report.version === 6) return [design(report.findings)];
  const implementation = (
    findings: readonly ImplementationFinding[],
  ): NativeDiagnostics => ({
    items: findings.map((f) => ({
      code: f.law,
      side: "implementation",
      severity: "error",
      message: f.detail,
      locations: f.locations,
    })),
  });
  return [
    implementation(report.findings),
    design(report.designFindings),
  ];
}
