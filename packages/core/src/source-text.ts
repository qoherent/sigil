import { diagnostic } from "./diagnostics.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type {
  SourceLocation,
  SourceRange,
  Utf16Position,
} from "./model/language.ts";

/** A string is supplied text, never evidence of a disk file's encoding. */
export type SourceInput = string | Uint8Array;

export interface PhysicalLine {
  readonly number: number;
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly utf16Start: number;
  readonly content: string;
  readonly ending: "" | "\n" | "\r" | "\r\n";
}

export interface SourceCapture {
  readonly source?: SourceText;
  readonly diagnostics: readonly SigilDiagnostic[];
  readonly rawBytes?: Uint8Array;
  readonly rawText?: string;
}

// @sigil implements packages/core/src/model/source.sigil::SigilSourceModel::SourceModel interface
export class SourceText {
  readonly text: string;
  readonly origin: "disk" | "text";
  readonly byteLength: number;
  readonly lines: readonly PhysicalLine[];
  readonly #rawBytes?: Uint8Array;
  readonly #byteToUtf16 = new Map<number, number>();
  readonly #utf16ToByte = new Map<number, number>();

  /** Call captureSource: text must already be a validated Unicode scalar sequence. */
  constructor(text: string, rawBytes?: Uint8Array) {
    this.text = text;
    this.origin = rawBytes ? "disk" : "text";
    this.#rawBytes = rawBytes?.slice();
    let byte = 0;
    let utf16 = 0;
    this.#byteToUtf16.set(0, 0);
    this.#utf16ToByte.set(0, 0);
    for (const character of text) {
      const cp = character.codePointAt(0)!;
      byte += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      utf16 += character.length;
      this.#byteToUtf16.set(byte, utf16);
      this.#utf16ToByte.set(utf16, byte);
    }
    this.byteLength = byte;
    const lines: PhysicalLine[] = [];
    let start = 0;
    const append = (end: number, ending: PhysicalLine["ending"]) => {
      lines.push(Object.freeze({
        number: lines.length + 1,
        start: this.#utf16ToByte.get(start)!,
        contentEnd: this.#utf16ToByte.get(end)!,
        end: this.#utf16ToByte.get(end + ending.length)!,
        utf16Start: start,
        content: text.slice(start, end),
        ending,
      }));
      start = end + ending.length;
    };
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\r") {
        const ending = text[i + 1] === "\n" ? "\r\n" : "\r";
        append(i, ending);
        if (ending.length === 2) i++;
      } else if (text[i] === "\n") append(i, "\n");
    }
    append(text.length, "");
    this.lines = Object.freeze(lines);
  }

  get rawBytes(): Uint8Array | undefined {
    return this.#rawBytes?.slice();
  }
  byteOffsetAtUtf16(offset: number): number | undefined {
    return this.#utf16ToByte.get(offset);
  }
  utf16OffsetAtByte(offset: number): number | undefined {
    return this.#byteToUtf16.get(offset);
  }

  #lineAtByte(offset: number): PhysicalLine | undefined {
    if (!this.#byteToUtf16.has(offset)) return undefined;
    let low = 0, high = this.lines.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.lines[mid].start <= offset) low = mid;
      else high = mid - 1;
    }
    const line = this.lines[low];
    return offset <= line.contentEnd ? line : undefined;
  }

  locationAtByte(offset: number): SourceLocation | undefined {
    const line = this.#lineAtByte(offset);
    if (!line) return undefined;
    return {
      line: line.number,
      column:
        [...this.text.slice(line.utf16Start, this.#byteToUtf16.get(offset))]
          .length + 1,
    };
  }

  byteOffsetAtLocation(location: SourceLocation): number | undefined {
    const line = this.lines[location.line - 1];
    if (!line || !Number.isInteger(location.column) || location.column < 1) {
      return undefined;
    }
    const characters = [...line.content];
    if (location.column > characters.length + 1) return undefined;
    return this.#utf16ToByte.get(
      line.utf16Start +
        characters.slice(0, location.column - 1).join("").length,
    );
  }

  utf16PositionAtByte(offset: number): Utf16Position | undefined {
    const line = this.#lineAtByte(offset);
    return line
      ? {
        line: line.number - 1,
        character: this.#byteToUtf16.get(offset)! - line.utf16Start,
      }
      : undefined;
  }

  byteOffsetAtUtf16Position(position: Utf16Position): number | undefined {
    const line = this.lines[position.line];
    if (
      !line || !Number.isInteger(position.character) ||
      position.character < 0 || position.character > line.content.length
    ) return undefined;
    return this.#utf16ToByte.get(line.utf16Start + position.character);
  }

  slice(range: SourceRange): string {
    const start = this.#byteToUtf16.get(range.start),
      end = this.#byteToUtf16.get(range.end);
    if (start === undefined || end === undefined || end < start) {
      throw new RangeError("Range is not on original UTF-8 boundaries");
    }
    return this.text.slice(start, end);
  }
}

export function captureSource(
  filePath: string,
  input: SourceInput,
): SourceCapture {
  const rawBytes = typeof input === "string" ? undefined : input.slice();
  if (rawBytes) {
    const range = invalidUtf8(rawBytes);
    if (range) {
      return {
        rawBytes,
        diagnostics: [
          diagnostic("SIGIL_INVALID_ENCODING", "Source is not valid UTF-8.", {
            filePath,
            range,
          }),
        ],
      };
    }
  }
  const text = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      rawBytes,
    );
  for (const character of text) {
    const cp = character.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      return {
        rawText: text,
        diagnostics: [
          diagnostic(
            "SIGIL_INVALID_CHARACTER",
            "Supplied text contains an unpaired UTF-16 surrogate; no faithful UTF-8 range exists.",
            { filePath },
          ),
        ],
      };
    }
  }
  const source = new SourceText(text, rawBytes);
  const diagnostics: SigilDiagnostic[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0) {
      const start = source.byteOffsetAtUtf16(i)!;
      diagnostics.push(
        diagnostic(
          "SIGIL_INVALID_CHARACTER",
          "NUL is not a valid source character.",
          { filePath, range: { start, end: start + 1 } },
        ),
      );
    }
  }
  return {
    source,
    diagnostics,
    rawBytes,
    rawText: typeof input === "string" ? text : undefined,
  };
}

function invalidUtf8(bytes: Uint8Array): SourceRange | undefined {
  for (let i = 0; i < bytes.length;) {
    const start = i, lead = bytes[i++];
    if (lead < 0x80) continue;
    const count = lead >= 0xc2 && lead <= 0xdf
      ? 1
      : lead >= 0xe0 && lead <= 0xef
      ? 2
      : lead >= 0xf0 && lead <= 0xf4
      ? 3
      : -1;
    if (count < 0) return { start, end: i };
    for (let j = 0; j < count; j++) {
      if (i === bytes.length) return { start, end: i };
      const continuation = bytes[i++];
      const min = j === 0 && lead === 0xe0
        ? 0xa0
        : j === 0 && lead === 0xf0
        ? 0x90
        : 0x80;
      const max = j === 0 && lead === 0xed
        ? 0x9f
        : j === 0 && lead === 0xf4
        ? 0x8f
        : 0xbf;
      if (continuation < min || continuation > max) return { start, end: i };
    }
  }
}
