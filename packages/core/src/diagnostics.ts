import type {
  DiagnosticLocation,
  DiagnosticStage,
  RelatedDiagnosticLocation,
  SigilDiagnostic,
  SigilDiagnosticCode,
} from "./model/diagnostics.ts";
import { canonicalJson } from "./canonical.ts";

// @sigil implements packages/core/src/diagnostics.sigil::SigilDiagnostics::DiagnosticConstruction interface,constraints,cases
export function diagnostic(
  code: SigilDiagnosticCode,
  message: string,
  options: DiagnosticLocation & {
    readonly severity?: SigilDiagnostic["severity"];
    readonly stage?: DiagnosticStage;
    readonly related?: readonly RelatedDiagnosticLocation[];
  } = {},
): SigilDiagnostic {
  return {
    code,
    stage: options.stage ?? diagnosticStage(code),
    severity: options.severity ?? "error",
    message,
    filePath: options.filePath,
    range: options.range,
    sourceDigest: options.sourceDigest,
    implementationRange: options.implementationRange,
    related: [...(options.related ?? [])].sort(compareLocations),
  };
}

export function compareScalarText(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}

function compareLocations(
  a: DiagnosticLocation,
  b: DiagnosticLocation,
): number {
  if (a.filePath === undefined && b.filePath !== undefined) return -1;
  if (a.filePath !== undefined && b.filePath === undefined) return 1;
  return compareScalarText(a.filePath ?? "", b.filePath ?? "") ||
    (a.range?.start ?? -1) - (b.range?.start ?? -1) ||
    (a.range?.end ?? -1) - (b.range?.end ?? -1) ||
    compareScalarText(
      canonicalJson(a.implementationRange ?? null),
      canonicalJson(b.implementationRange ?? null),
    );
}

function compareRelated(
  a: readonly RelatedDiagnosticLocation[],
  b: readonly RelatedDiagnosticLocation[],
): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareLocations(a[i], b[i]);
    if (order) return order;
  }
  return a.length - b.length;
}

/** Canonical order and complete-record coalescing; distinct evidence survives. */
export function orderDiagnostics(
  input: readonly SigilDiagnostic[],
): SigilDiagnostic[] {
  const distinct = new Map<string, SigilDiagnostic>();
  for (const d of input) {
    const value = { ...d, related: [...d.related].sort(compareLocations) };
    distinct.set(canonicalJson(value), value);
  }
  return [...distinct.values()].sort((a, b) =>
    compareLocations(a, b) || compareScalarText(a.code, b.code) ||
    compareRelated(a.related, b.related) ||
    compareScalarText(canonicalJson(a), canonicalJson(b))
  );
}

function diagnosticStage(code: SigilDiagnosticCode): DiagnosticStage {
  if (/^SIGIL_(CONFIG|NESTED_CONFIG|UNSUPPORTED_VERSION)/.test(code)) {
    return "workspace";
  }
  if (
    /^SIGIL_(IMPLEMENTATION|RETRIEVAL|BOUNDARY|GLOSSARY|FORMAT_CONTEXT)/.test(
      code,
    )
  ) {
    return "host";
  }
  if (
    /^SIGIL_(LINK_TARGET|INTERPRETATION|SEMANTIC|LAYOUT_DEPENDENT)/.test(code)
  ) return "interpretation";
  if (
    /^SIGIL_(UNRESOLVED|DUPLICATE_COMPONENT|DUPLICATE_TAG|TAG_NAME_COLLISION|UNUSED_TAG)/
      .test(code)
  ) return "resolution";
  if (/^SIGIL_(MISSING|DUPLICATE_SECTION|EMPTY_TAG|NESTED_TAG)/.test(code)) {
    return "structure";
  }
  return "parsing";
}
