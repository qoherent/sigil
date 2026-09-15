import { decodeHTMLStrict } from "entities/decode";
import { diagnostic } from "./diagnostics.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type { SourceRange } from "./model/language.ts";
import type { SourceText } from "./source-text.ts";

export interface InlineLink {
  readonly raw: string;
  readonly label: string;
  readonly destination: string;
  readonly title?: string;
  readonly image: boolean;
  readonly range: SourceRange;
  /** Includes angle brackets when present; exempt from physical width. */
  readonly destinationRange: SourceRange;
}

export interface InlineTagDefinition {
  readonly name: string;
  readonly raw: string;
  readonly range: SourceRange;
  readonly nameRange: SourceRange;
  readonly valid: boolean;
}

export interface InlineContent {
  readonly links: readonly InlineLink[];
  readonly definitions: readonly InlineTagDefinition[];
  /** Original physical prose regions eligible for later bare-reference scanning. */
  readonly eligible: readonly SourceRange[];
  readonly diagnostics: readonly SigilDiagnostic[];
}

export function isSourceWhitespace(character: string | undefined): boolean {
  if (character?.length !== 1) return false;
  const cp = character.charCodeAt(0);
  return (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x2000 && cp <= 0x200a) ||
    [0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(
      cp,
    );
}

export function validTagName(name: string): boolean {
  const chars = [...name];
  return chars.length > 0 && !isSourceWhitespace(chars[0]) &&
    !isSourceWhitespace(chars.at(-1)) &&
    !/[*,{}\r\n\0\ud800-\udfff]/u.test(name);
}

const escapedPunctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/;
function escaped(text: string, at: number): boolean {
  return text[at] === "\\" && escapedPunctuation.test(text[at + 1] ?? "");
}

function decode(text: string): string {
  return text.replace(
    /\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (token) => token[0] === "\\" ? token.slice(1) : decodeHTMLStrict(token),
  );
}

interface LinkTail {
  end: number;
  destinationStart: number;
  destinationEnd: number;
  destination: string;
  title?: string;
}

/** CommonMark link separators allow at most one physical ending. */
function separator(text: string, at: number): number {
  while (text[at] === " " || text[at] === "\t") at++;
  if (text[at] === "\r" || text[at] === "\n") {
    at += text[at] === "\r" && text[at + 1] === "\n" ? 2 : 1;
    while (text[at] === " " || text[at] === "\t") at++;
  }
  return at;
}

function linkTail(text: string, open: number): LinkTail | undefined {
  if (text[open] !== "(") return undefined;
  let at = separator(text, open + 1);
  const destinationStart = at;
  let rawDestination: string;
  if (text[at] === "<") {
    const content = ++at;
    while (at < text.length && text[at] !== ">") {
      if (/[<\r\n\0]/.test(text[at])) return undefined;
      at += escaped(text, at) ? 2 : 1;
    }
    if (text[at] !== ">") return undefined;
    rawDestination = text.slice(content, at++);
  } else {
    let depth = 0;
    while (at < text.length) {
      const character = text[at];
      if (escaped(text, at)) {
        at += 2;
        continue;
      }
      if (character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f) {
        break;
      }
      if (character === "(") depth++;
      if (character === ")") {
        if (depth === 0) break;
        depth--;
      }
      at++;
    }
    if (depth) return undefined;
    rawDestination = text.slice(destinationStart, at);
  }
  const destinationEnd = at;
  const afterSpace = separator(text, at);
  let title: string | undefined;
  if (afterSpace > at && ['"', "'", "("].includes(text[afterSpace])) {
    const opener = text[afterSpace];
    const closer = opener === "(" ? ")" : opener;
    at = afterSpace + 1;
    const titleStart = at;
    while (at < text.length && text[at] !== closer) {
      if (text[at] === "\0" || (opener === "(" && text[at] === "(")) {
        return undefined;
      }
      if (/^(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.test(text.slice(at))) {
        return undefined;
      }
      at += escaped(text, at) ? 2 : 1;
    }
    if (text[at] !== closer) return undefined;
    title = decode(text.slice(titleStart, at));
    at = separator(text, at + 1);
  } else at = afterSpace;
  if (text[at] !== ")") return undefined;
  return {
    end: at + 1,
    destinationStart,
    destinationEnd,
    destination: decode(rawDestination),
    title,
  };
}

/** Scan one maximal prose paragraph. Block boundaries are supplied by the parser. */
// @sigil implements packages/core/src/parser.sigil::SigilParser::PhysicalSource constraints
export function scanInlineContent(
  filePath: string,
  source: SourceText,
  range: SourceRange,
): InlineContent {
  const text = source.slice(range);
  const base = source.utf16OffsetAtByte(range.start)!;
  const span = (start: number, end: number): SourceRange => ({
    start: source.byteOffsetAtUtf16(base + start)!,
    end: source.byteOffsetAtUtf16(base + end)!,
  });
  const links: InlineLink[] = [];
  const brackets: {
    start: number;
    labelStart: number;
    image: boolean;
    active: boolean;
  }[] = [];
  for (let at = 0; at < text.length; at++) {
    if (escaped(text, at)) {
      at++;
      continue;
    }
    if (text[at] === "[") {
      brackets.push({
        start: at,
        labelStart: at + 1,
        image: false,
        active: true,
      });
    } else if (text[at] === "!" && text[at + 1] === "[") {
      brackets.push({
        start: at,
        labelStart: at + 2,
        image: true,
        active: true,
      });
      at++;
    } else if (text[at] === "]") {
      const opener = brackets.pop();
      if (!opener?.active) continue;
      const tail = linkTail(text, at + 1);
      if (!tail) continue;
      links.push({
        raw: text.slice(opener.start, tail.end),
        label: text.slice(opener.labelStart, at),
        destination: tail.destination,
        title: tail.title,
        image: opener.image,
        range: span(opener.start, tail.end),
        destinationRange: span(tail.destinationStart, tail.destinationEnd),
      });
      if (!opener.image) {
        for (const bracket of brackets) {
          if (!bracket.image) bracket.active = false;
        }
      }
      at = tail.end - 1;
    }
  }
  links.sort((a, b) =>
    a.range.start - b.range.start || b.range.end - a.range.end
  );
  const definitions: InlineTagDefinition[] = [];
  const diagnostics: SigilDiagnostic[] = [];
  const eligible: SourceRange[] = [];
  const outer = (character: string | undefined) =>
    character === undefined || character === "," || character === "." ||
    isSourceWhitespace(character);
  const firstLine = (source.locationAtByte(range.start)?.line ?? 1) - 1;
  const lastLine = source.locationAtByte(range.end)?.line ??
    source.lines.length;
  for (const line of source.lines.slice(firstLine, lastLine)) {
    if (line.contentEnd <= range.start || line.start >= range.end) continue;
    let chunks: SourceRange[] = [{
      start: Math.max(line.start, range.start),
      end: Math.min(line.contentEnd, range.end),
    }];
    for (const link of links) {
      chunks = chunks.flatMap((chunk) => {
        if (
          link.range.end <= chunk.start || link.range.start >= chunk.end
        ) return [chunk];
        const out: SourceRange[] = [];
        if (link.range.start > chunk.start) {
          out.push({ start: chunk.start, end: link.range.start });
        }
        if (link.range.end < chunk.end) {
          out.push({ start: link.range.end, end: chunk.end });
        }
        return out;
      });
    }
    for (const chunk of chunks) {
      const start = source.utf16OffsetAtByte(chunk.start)!;
      const end = source.utf16OffsetAtByte(chunk.end)!;
      let unprotectedStart = start;
      for (let at = start; at < end; at++) {
        if (source.text[at] !== "*") continue;
        const before = at === line.utf16Start ? undefined : source.text[at - 1];
        const first = source.text[at + 1];
        if (
          !outer(before) || first === undefined || isSourceWhitespace(first)
        ) continue;
        const close = source.text.indexOf("*", at + 1);
        if (close < 0 || close >= end) {
          diagnostics.push(
            diagnostic(
              "SIGIL_INCOMPLETE_TAG",
              "Inline Tag has no closing asterisk on this eligible physical region.",
              {
                filePath,
                range: { start: source.byteOffsetAtUtf16(at)!, end: chunk.end },
              },
            ),
          );
          break;
        }
        const after = close + 1 === line.utf16Start + line.content.length
          ? undefined
          : source.text[close + 1];
        if (isSourceWhitespace(source.text[close - 1]) || !outer(after)) {
          continue;
        }
        const name = source.text.slice(at + 1, close);
        const candidate = {
          name,
          raw: source.text.slice(at, close + 1),
          range: {
            start: source.byteOffsetAtUtf16(at)!,
            end: source.byteOffsetAtUtf16(close + 1)!,
          },
          nameRange: {
            start: source.byteOffsetAtUtf16(at + 1)!,
            end: source.byteOffsetAtUtf16(close)!,
          },
          valid: validTagName(name),
        };
        definitions.push(candidate);
        if (!candidate.valid) {
          diagnostics.push(
            diagnostic(
              "SIGIL_INVALID_TAG_NAME",
              "Tag name contains forbidden content.",
              { filePath, range: candidate.nameRange },
            ),
          );
        }
        if (unprotectedStart < at) {
          eligible.push({
            start: source.byteOffsetAtUtf16(unprotectedStart)!,
            end: candidate.range.start,
          });
        }
        unprotectedStart = close + 1;
        at = close;
      }
      if (unprotectedStart < end) {
        eligible.push({
          start: source.byteOffsetAtUtf16(unprotectedStart)!,
          end: chunk.end,
        });
      }
    }
  }
  return { links, definitions, eligible, diagnostics };
}
