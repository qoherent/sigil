import { diagnostic } from "./diagnostics.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type { SourceRange } from "./model/language.ts";
import type { Facet } from "./model/source.ts";
import type { SourceText } from "./source-text.ts";
export const PROSE_WIDTH = 79;

/** Count original scalars, subtracting the union of raw link destination spans. */
export function proseContentWidth(
  source: SourceText,
  range: SourceRange,
  destinations: readonly SourceRange[],
): number {
  let width = [...source.slice(range)].length, coveredEnd = range.start;
  for (
    const destination of [...destinations].sort((a, b) => a.start - b.start)
  ) {
    const start = Math.max(range.start, destination.start, coveredEnd),
      end = Math.min(range.end, destination.end);
    if (end > start) {
      width -= [...source.slice({ start, end })].length;
      coveredEnd = end;
    }
  }
  return width;
}

export function proseWidthDiagnostics(
  filePath: string,
  source: SourceText,
  facets: readonly Facet[],
  references: readonly { range: SourceRange }[] = [],
): SigilDiagnostic[] {
  const diagnostics: SigilDiagnostic[] = [];
  for (const facet of facets) {
    const destinations = facet.links.map((l) => l.destinationRange);
    const protectedSpans = [
      ...facet.definitions.map((d) => d.range),
      ...facet.links.map((l) => l.range),
      ...references.filter((r) =>
        r.range.start >= facet.proseRange.start &&
        r.range.end <= facet.proseRange.end
      ).map((r) => r.range),
    ];
    const first = (source.locationAtByte(facet.proseRange.start)?.line ?? 1) -
      1;
    for (
      let i = first;
      i < source.lines.length && source.lines[i].start < facet.proseRange.end;
      i++
    ) {
      const line = source.lines[i],
        indent = line.content.match(/^[ \t]*/)?.[0].length ?? 0;
      const range = {
        start: source.byteOffsetAtUtf16(line.utf16Start + indent)!,
        end: line.contentEnd,
      };
      if (proseContentWidth(source, range, destinations) <= PROSE_WIDTH) {
        continue;
      }
      const tokens = [...line.content.matchAll(/[^ \t]+/g)].map((m) => ({
        start: source.byteOffsetAtUtf16(line.utf16Start + m.index)!,
        end: source.byteOffsetAtUtf16(line.utf16Start + m.index + m[0].length)!,
      }));
      const indivisible = [...tokens, ...protectedSpans].some((span) => {
        const start = Math.max(span.start, range.start),
          end = Math.min(span.end, range.end);
        return end > start &&
          proseContentWidth(source, { start, end }, destinations) > PROSE_WIDTH;
      });
      diagnostics.push(
        diagnostic(
          indivisible ? "SIGIL_UNFORMATTABLE_LINE" : "SIGIL_LINE_TOO_LONG",
          indivisible
            ? "An indivisible prose span exceeds 79 content characters."
            : "Prose exceeds 79 content characters on a physical line.",
          { filePath, range: { start: line.start, end: line.contentEnd } },
        ),
      );
    }
  }
  return diagnostics;
}
