import { createHash } from "node:crypto";
import {
  captureSource,
  SourceText,
} from "../../../../packages/core/src/source-text.ts";
import type { NativeLocation } from "./compilation.ts";

type Position = { line: number; character: number };
export type EditorRange = { start: Position; end: Position };

/** Source bytes remain original; VS Code hides a disk BOM in its text model. */
export class EditorProtocolSource extends SourceText {
  readonly #hiddenBom: number;
  constructor(source: SourceText) {
    super(source.text, source.rawBytes);
    this.#hiddenBom =
      source.origin === "disk" && source.text.startsWith("\uFEFF") ? 1 : 0;
  }
  override utf16PositionAtByte(offset: number): Position | undefined {
    const point = super.utf16PositionAtByte(offset);
    if (!point || (point.line === 0 && point.character < this.#hiddenBom)) {
      return undefined;
    }
    return {
      line: point.line,
      character: point.character - (point.line === 0 ? this.#hiddenBom : 0),
    };
  }
  override byteOffsetAtUtf16Position(point: Position): number | undefined {
    return super.byteOffsetAtUtf16Position({
      line: point.line,
      character: point.character + (point.line === 0 ? this.#hiddenBom : 0),
    });
  }
}

export function sourceDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Verify both the captured bytes and the editor's only permitted normalizations. */
export function nativeLocationRange(
  location: NativeLocation,
  bytes: Uint8Array,
  visibleText: string,
): EditorRange | undefined {
  if (!location.range && !location.implementation_range) return undefined;
  if (
    !location.source_digest || sourceDigest(bytes) !== location.source_digest
  ) {
    throw new Error(`Stale source: ${location.source}; compile again.`);
  }
  const raw = captureSource(location.source, bytes).source;
  const visible = captureSource(location.source, visibleText).source;
  const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n");
  if (
    !raw || !visible ||
    normalize(raw.text.replace(/^\uFEFF/, "")) !== normalize(visible.text)
  ) {
    throw new Error(
      `Source does not match the editor: ${location.source}; compile again.`,
    );
  }
  const source = new EditorProtocolSource(raw);
  function implementationPoint(
    point: { line: number; column: number },
  ): Position | undefined {
    const offset = raw!.byteOffsetAtUtf16Position({
      line: point.line - 1,
      character: point.column - 1,
    });
    return offset === undefined
      ? undefined
      : source.utf16PositionAtByte(offset);
  }
  const range = location.coordinate_system === "utf8-bytes" && location.range
    ? {
      start: source.utf16PositionAtByte(location.range.start),
      end: source.utf16PositionAtByte(location.range.end),
    }
    : location.implementation_range
    ? {
      start: implementationPoint(location.implementation_range.start),
      end: implementationPoint(location.implementation_range.end),
    }
    : undefined;
  if (
    !range?.start || !range.end ||
    visible.byteOffsetAtUtf16Position(range.start) === undefined ||
    visible.byteOffsetAtUtf16Position(range.end) === undefined
  ) {
    throw new Error(`Invalid source range: ${location.source}.`);
  }
  return { start: range.start, end: range.end };
}
