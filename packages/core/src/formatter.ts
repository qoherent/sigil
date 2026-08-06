import type { FormatResult, SemanticUnit, SigilDocument } from "./model.ts";

const PROSE_WIDTH = 79;

/*
 * @sigil implements packages/core/src/formatter.sigil::SigilFormatter::Formatting interface,logic,cases
 * @sigil implements packages/core/src/formatter.sigil::SigilFormatter::DeterministicFormatting constraints
 */
export function formatSigilDocument(
  document: SigilDocument,
  source: string,
): FormatResult {
  const errors = document.diagnostics.filter((item) =>
    item.severity === "error"
  );
  if (errors.length > 0) {
    return { changed: false, diagnostics: document.diagnostics };
  }

  const hadFinalNewline = source.endsWith("\n");
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (hadFinalNewline) lines.pop();
  const units = [...document.components, ...document.expands]
    .flatMap((declaration) =>
      declaration.sections.flatMap((section) => section.units)
    )
    .sort((left, right) => right.range.start.line - left.range.start.line);

  for (const unit of units) {
    const start = unit.range.start.line - 1;
    const count = unit.range.end.line - unit.range.start.line + 1;
    lines.splice(start, count, ...renderUnit(unit));
  }

  const canonical: string[] = [];
  let blank = false;
  let literalFenceLength: number | undefined;
  for (const raw of lines) {
    if (literalFenceLength !== undefined) {
      canonical.push(raw);
      const close = raw.trim().match(/^(`{3,})$/);
      if (close && close[1].length >= literalFenceLength) {
        literalFenceLength = undefined;
        blank = false;
      }
      continue;
    }

    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      if (!blank) canonical.push("");
      blank = true;
    } else {
      canonical.push(line);
      blank = false;
      const opener = line.trim().match(
        /^(`{3,})(?:[A-Za-z][A-Za-z0-9_+.-]*)?$/,
      );
      if (opener) literalFenceLength = opener[1].length;
    }
  }
  while (canonical[0] === "") canonical.shift();
  while (canonical.at(-1) === "") canonical.pop();
  const formattedSource = canonical.join("\n") + (hadFinalNewline ? "\n" : "");
  return {
    formattedSource,
    changed: formattedSource !== source,
    diagnostics: document.diagnostics,
  };
}

function renderUnit(unit: SemanticUnit): string[] {
  const indentation = " ".repeat(Math.max(0, unit.range.start.column - 1));
  const result = wrapProse(unit.prose).map((line) => indentation + line);
  for (const literal of unit.literalBlocks) {
    const ticks = "`".repeat(literal.fenceLength);
    result.push(
      indentation + ticks + (literal.type ? literal.type : ""),
      ...literal.sourceLines,
      indentation + ticks,
    );
  }
  return result;
}

function wrapProse(prose: string): string[] {
  if (!prose) return [];
  const words = prose.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ([...current].length + 1 + [...word].length <= PROSE_WIDTH) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
