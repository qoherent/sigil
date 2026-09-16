import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CompilationFocus = "design" | "implementation";
export type DesignState = "Coherent" | "Loose" | "Disjoint";
export type ImplementationState = "Closed" | "Converged" | "Drift";
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
export interface NativeFinding {
  readonly code: string;
  readonly side: CompilationFocus;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly locations: readonly NativeLocation[];
  readonly omitted_locations: number;
  readonly witness?: unknown;
}
export interface NativeDiagnostics {
  readonly items: readonly NativeFinding[];
  readonly omitted: number;
}
export interface DesignReport {
  readonly version: 2;
  readonly world: { readonly state: DesignState };
  readonly diagnostics: NativeDiagnostics;
  readonly scope?: unknown;
}
export interface ImplementationReport {
  readonly version: 2;
  readonly design: DesignReport;
  readonly implementation: unknown | null;
  readonly comparison: {
    readonly implementation: ImplementationState;
    readonly design: DesignState;
  } | null;
  readonly diagnostics: NativeDiagnostics;
  readonly reason?: string;
  readonly scope?: unknown;
}
export type NativeReport = DesignReport | ImplementationReport;
export interface CompilationProcess {
  readonly result: Promise<NativeReport>;
  cancel(): void;
}
export interface CompilationOptions {
  readonly executable: string;
  readonly languageExecutable: string;
  readonly cwd: string;
  readonly focus: CompilationFocus;
  readonly file?: string;
  readonly selection?: string;
  readonly onLog: (text: string) => void;
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,logic,constraints,cases
export function runCompilationProcess(
  options: CompilationOptions,
): CompilationProcess {
  const controller = new AbortController();
  const signal = controller.signal;
  const result = (async () => {
    if (options.focus === "implementation" && !options.selection) {
      throw new Error(
        "Set sigil.compile.selection to a native Implementation selection JSON file.",
      );
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), "sigil-editor-"));
    try {
      const exported = await runJson(
        options.languageExecutable,
        ["export", "design", ".", "--root", options.cwd],
        options.cwd,
        signal,
        options.onLog,
      );
      const frontend = path.join(directory, "frontend.json");
      if (exported.code !== 0) {
        options.onLog(
          JSON.stringify(
            object(exported.value)
              ? exported.value.diagnostics
              : exported.value,
          ),
        );
        throw new Error(
          `Language export failed (exit ${exported.code}); see language diagnostics in Sigil output.`,
        );
      }
      if (
        !object(exported.value) || exported.value.schemaVersion !== 2 ||
        exported.value.languageVersion !== "0.8.0"
      ) {
        throw new Error(
          "Incompatible language export; Sigil 0.8 schema 2 is required.",
        );
      }
      await writeFile(frontend, JSON.stringify(exported.value));
      const args = [
        "compile",
        options.focus,
        "--root",
        options.cwd,
        "--frontend",
        frontend,
      ];
      if (options.file) {
        const implementation = options.focus === "implementation"
          ? JSON.parse(
            await readFile(
              path.resolve(options.cwd, options.selection!),
              "utf8",
            ),
          )
          : { exclude: ["**"], allowEmpty: true };
        const scope = path.join(directory, "scope.json");
        await writeFile(
          scope,
          JSON.stringify({
            version: 1,
            design: { paths: [options.file] },
            implementation,
          }),
        );
        args.push("--scope", scope);
      } else if (options.focus === "implementation") {
        args.push("--selection", path.resolve(options.cwd, options.selection!));
      }
      const native = await runJson(
        options.executable,
        args,
        options.cwd,
        signal,
        options.onLog,
      );
      return parseNativeReport(native.value, options.focus, native.code);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
function position(value: unknown): value is { line: number; column: number } {
  return object(value) && count(value.line) && value.line > 0 &&
    count(value.column) && value.column > 0;
}
function location(value: unknown): boolean {
  if (
    !object(value) ||
    !["design", "implementation"].includes(String(value.side)) ||
    typeof value.source !== "string" || !value.source ||
    path.isAbsolute(value.source) || value.source.split(/[\\/]/).includes("..")
  ) return false;
  if (
    !["utf8-bytes", "utf16-lines"].includes(String(value.coordinate_system))
  ) return false;
  if (
    value.source_digest !== undefined &&
    (typeof value.source_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.source_digest))
  ) return false;
  if (value.coordinate_system === "utf8-bytes") {
    if (value.implementation_range !== undefined) return false;
    return value.range === undefined || (object(value.range) &&
      count(value.range.start) && count(value.range.end) &&
      value.range.end >= value.range.start &&
      typeof value.source_digest === "string");
  }
  if (value.range !== undefined) return false;
  const range = value.implementation_range;
  return range === undefined || (typeof value.source_digest === "string" &&
    object(range) && position(range.start) && position(range.end) &&
    (range.end.line > range.start.line ||
      (range.end.line === range.start.line &&
        range.end.column >= range.start.column)));
}
function diagnostics(value: unknown): value is NativeDiagnostics {
  return object(value) && count(value.omitted) && Array.isArray(value.items) &&
    value.items.length <= 1000 &&
    value.items.every((item) =>
      object(item) && typeof item.code === "string" &&
      typeof item.message === "string" &&
      ["design", "implementation"].includes(String(item.side)) &&
      ["error", "warning", "info"].includes(String(item.severity)) &&
      count(item.omitted_locations) && Array.isArray(item.locations) &&
      item.locations.length <= 8 && item.locations.every(location)
    );
}
function designReport(value: unknown): value is DesignReport {
  return object(value) && value.version === 2 && object(value.world) &&
    ["Coherent", "Loose", "Disjoint"].includes(String(value.world.state)) &&
    diagnostics(value.diagnostics);
}

// @sigil implements integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface constraints,cases
export function parseNativeReport(
  value: unknown,
  focus: CompilationFocus,
  exit: number,
): NativeReport {
  if (focus === "design") {
    if (
      designReport(value) && exit === (value.world.state === "Disjoint" ? 1 : 0)
    ) return value;
  } else if (
    object(value) && value.version === 2 && designReport(value.design) &&
    diagnostics(value.diagnostics)
  ) {
    if (
      exit === 3 && value.implementation === null &&
      value.comparison === null && typeof value.reason === "string"
    ) return value as unknown as ImplementationReport;
    const comparison = value.comparison;
    if (
      object(value.implementation) && object(comparison) &&
      comparison.design === value.design.world.state &&
      comparison.design !== "Disjoint" &&
      ["Closed", "Converged", "Drift"].includes(
        String(comparison.implementation),
      ) &&
      (comparison.implementation !== "Closed" ||
        comparison.design === "Coherent") &&
      exit === (comparison.implementation === "Drift" ? 1 : 0)
    ) return value as unknown as ImplementationReport;
  }
  throw new Error(
    `Incompatible ${focus} report or gate exit ${exit}; configure current sigil and sigilc executables.`,
  );
}

export function nativeState(
  report: NativeReport,
): DesignState | ImplementationState | undefined {
  return "world" in report
    ? report.world.state
    : report.comparison?.implementation;
}
export function diagnosticGroups(
  report: NativeReport,
): readonly NativeDiagnostics[] {
  return "world" in report
    ? [report.diagnostics]
    : [report.diagnostics, report.design.diagnostics];
}
