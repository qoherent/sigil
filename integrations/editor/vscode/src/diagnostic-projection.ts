import {
  diagnosticGroups,
  type NativeFinding,
  type NativeReport,
} from "./compilation.ts";
import { type EditorRange, nativeLocationRange } from "./coordinates.ts";

export interface ProjectionDocument {
  readonly version: number;
  readonly isDirty: boolean;
  getText(): string;
}

export interface ProjectedDiagnostic {
  readonly source: string;
  readonly range: EditorRange;
  readonly finding: NativeFinding;
}

/** Publish once, only while the operation and every captured document are current. */
export async function publishCompilationDiagnostics(
  report: NativeReport,
  host: {
    loadSource(source: string): Promise<{
      bytes: Uint8Array;
      document: ProjectionDocument;
    }>;
    isCurrent(): boolean;
    publish(diagnostics: readonly ProjectedDiagnostic[]): void;
  },
): Promise<void> {
  const diagnostics: ProjectedDiagnostic[] = [];
  const snapshots = new Map<
    string,
    { bytes: Uint8Array; document: ProjectionDocument; version: number }
  >();
  for (const group of diagnosticGroups(report)) {
    for (const finding of group.items) {
      for (const location of finding.locations) {
        let range: EditorRange = {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        };
        if (location.range || location.implementation_range) {
          let snapshot = snapshots.get(location.source);
          if (!snapshot) {
            const { bytes, document } = await host.loadSource(location.source);
            snapshot = { bytes, document, version: document.version };
            snapshots.set(location.source, snapshot);
          }
          const { bytes, document } = snapshot;
          if (document.isDirty) {
            throw new Error(
              `Stale source: ${location.source}; save and compile again.`,
            );
          }
          range = nativeLocationRange(location, bytes, document.getText()) ??
            range;
        }
        diagnostics.push({ source: location.source, range, finding });
      }
    }
  }
  if (!host.isCurrent()) return;
  if (
    [...snapshots.values()].some(({ document, version }) =>
      document.isDirty || document.version !== version
    )
  ) {
    throw new Error(
      "Source changed during diagnostic projection; compile again.",
    );
  }
  host.publish(diagnostics);
}
