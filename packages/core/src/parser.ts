import { proseWidthDiagnostics } from "./prose-width.ts";
import { diagnostic, orderDiagnostics } from "./diagnostics.ts";
import {
  isSourceWhitespace,
  scanInlineContent,
  validTagName,
} from "./inline-content.ts";
import {
  captureSource,
  type PhysicalLine,
  type SourceInput,
} from "./source-text.ts";
import {
  SIGIL_VERSION,
  type SigilSectionName,
  type SourceRange,
} from "./model/language.ts";
import type {
  SigilDiagnostic,
  SigilDiagnosticCode,
} from "./model/diagnostics.ts";
import {
  type ComponentDeclaration,
  type EmbeddedContent,
  type Facet,
  type ImportDeclaration,
  type InvalidSourceRegion,
  type ParseOptions,
  type ParseResult,
  type Section,
  sourceOccurrenceId,
  type TagGroup,
} from "./model/source.ts";

const SECTIONS = new Set([
  "goal",
  "interface",
  "state",
  "logic",
  "constraints",
  "decisions",
  "cases",
]);
const trim = (text: string) => text.replace(/^[ \t]+|[ \t]+$/g, "");
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ComponentDraft = Mutable<ComponentDeclaration> & { sections: Section[] };
type SectionDraft = Mutable<Section> & { units: Facet[]; groups: TagGroup[] };
type GroupDraft = Mutable<TagGroup> & { units: Facet[]; groups: TagGroup[] };
type Frame =
  & ({ kind: "component"; node: ComponentDraft } | {
    kind: "section";
    node: SectionDraft;
  } | { kind: "group"; node: GroupDraft })
  & { suppressUnclosed?: boolean };

/*
 * @sigil implements packages/core/src/parser.sigil::SigilParser::SourceDocumentParsing interface
 * @sigil implements packages/core/src/parser.sigil::SigilParser::DocumentParsing logic,constraints
 * @sigil implements packages/core/src/parser.sigil::SigilParser::PhysicalSource constraints
 */
export function parseSigilDocument(
  filePath: string,
  input: SourceInput,
  options: ParseOptions,
): ParseResult {
  const capture = captureSource(filePath, input);
  const source = capture.source;
  const diagnostics: SigilDiagnostic[] = [...capture.diagnostics];
  const imports: ImportDeclaration[] = [];
  const components: ComponentDeclaration[] = [];
  const invalidRegions: InvalidSourceRegion[] = [];
  let complete = Boolean(source);
  const finish = (): ParseResult => {
    const ordered = orderDiagnostics(diagnostics);
    return {
      document: {
        filePath,
        source,
        rawBytes: capture.rawBytes,
        rawText: capture.rawText,
        valid: !ordered.some((d) => d.severity === "error"),
        complete,
        imports,
        components,
        invalidRegions,
        diagnostics: ordered,
      },
      diagnostics: ordered,
    };
  };
  if (options.sigilVersion !== SIGIL_VERSION) {
    diagnostics.push(
      diagnostic(
        "SIGIL_UNSUPPORTED_VERSION",
        `Unsupported sigilVersion ${
          JSON.stringify(options.sigilVersion)
        }; supported version is ${SIGIL_VERSION}.`,
        { filePath },
      ),
    );
    complete = false;
    return finish();
  }
  if (!source) return finish();
  const lines = source.lines;
  const stack: Frame[] = [];
  let paragraph: PhysicalLine[] = [];
  let lastFacet: { facet: Facet; parent: Frame } | undefined;
  let afterBlank = false;
  let index = 0;
  const point = { start: source.byteLength, end: source.byteLength };
  const error = (
    code: SigilDiagnosticCode,
    message: string,
    range: SourceRange,
    related: readonly SourceRange[] = [],
  ) =>
    diagnostics.push(
      diagnostic(code, message, {
        filePath,
        range,
        related: related.map((range) => ({ filePath, range })),
      }),
    );
  const byteRange = (start: number, end: number): SourceRange => ({
    start: source.byteOffsetAtUtf16(start)!,
    end: source.byteOffsetAtUtf16(end)!,
  });
  const nameRange = (
    line: PhysicalLine,
    name: string,
    from = 0,
  ): SourceRange => {
    const start = line.utf16Start + line.content.indexOf(name, from);
    return byteRange(start, start + name.length);
  };
  const rawLine = (line: PhysicalLine) =>
    line.number === 1 && line.content.startsWith("\uFEFF")
      ? line.content.slice(1)
      : line.content;
  const markIncomplete = (suppressUnclosed = false) => {
    complete = false;
    for (const frame of stack) {
      frame.node.complete = false;
      frame.node.valid = false;
      frame.suppressUnclosed ||= suppressUnclosed;
    }
  };
  const flush = (payload?: EmbeddedContent): void => {
    if (!paragraph.length) return;
    const parent = stack.at(-1)!;
    const component = stack.find((f) => f.kind === "component")?.node;
    const section = stack.find((f) => f.kind === "section")?.node;
    if (!component || !section) {
      throw new Error("Prose without a component and contract");
    }
    const proseRange = {
      start: paragraph[0].start,
      end: paragraph.at(-1)!.end,
    };
    const inline = scanInlineContent(filePath, source, proseRange);
    diagnostics.push(...inline.diagnostics);
    const group = parent.kind === "group" ? parent.node : undefined;
    const facet: Facet = {
      id: sourceOccurrenceId(filePath, "facet", proseRange.start),
      filePath,
      componentId: component.id,
      ownerKind: "component",
      ownerName: component.name,
      sectionName: section.name as SigilSectionName,
      groupingId: group?.id,
      groupingTag: group?.name,
      range: {
        start: proseRange.start,
        end: payload?.range.end ?? proseRange.end,
      },
      proseRange,
      prose: paragraph.map((l) => trim(l.content)).join(" "),
      sourceLines: paragraph.map((l) => l.content),
      literalBlocks: payload ? [payload] : [],
      definitions: inline.definitions,
      links: inline.links,
      eligible: inline.eligible,
      valid: !inline.diagnostics.length && (payload?.valid ?? true) &&
        (group?.valid ?? true),
      complete: payload?.complete ?? true,
    };
    section.units.push(facet);
    for (const frame of stack) {
      if (frame.kind === "group") frame.node.units.push(facet);
    }
    lastFacet = { facet, parent };
    paragraph = [];
  };
  const close = (
    end: number,
    bodyEnd: number,
    closed: boolean,
    suppress = false,
  ): void => {
    const frame = stack.pop()!;
    frame.node.range = { start: frame.node.range.start, end };
    if (frame.kind !== "component") {
      frame.node.bodyRange = {
        start: frame.node.bodyRange.start,
        end: bodyEnd,
      };
    }
    if (!closed) {
      frame.node.complete = false;
      frame.node.valid = false;
      complete = false;
      if (!suppress) {
        error(
          "SIGIL_UNCLOSED_BLOCK",
          `Unclosed ${frame.kind} block.`,
          frame.node.headerRange,
          [point],
        );
      }
    }
    if (
      frame.kind === "group" && frame.node.complete &&
      frame.node.units.length === 0
    ) {
      error(
        "SIGIL_EMPTY_TAG_GROUP",
        "A grouping Tag must contain a Facet.",
        frame.node.headerRange,
      );
      frame.node.valid = false;
    }
    if (frame.kind === "component") {
      if (frame.node.complete) {
        for (const required of ["goal", "interface"] as const) {
          const sections = frame.node.sections.filter((s) =>
            s.name === required && s.known
          );
          if (
            sections.length === 0 ||
            sections.every((s) => s.complete && s.units.length === 0)
          ) {
            error(
              required === "goal"
                ? "SIGIL_MISSING_GOAL"
                : "SIGIL_MISSING_INTERFACE",
              `A nonempty ${required} section is required.`,
              sections[0]?.headerRange ?? frame.node.nameRange,
            );
          }
        }
      }
      for (const name of SECTIONS) {
        const repeated = frame.node.sections.filter((s) =>
          s.name === name && s.known
        );
        if (repeated.length > 1) {
          error(
            "SIGIL_DUPLICATE_SECTION",
            `Section ${name} occurs more than once.`,
            repeated[0].nameRange,
            repeated.slice(1).map((s) => s.nameRange),
          );
          for (const section of repeated) {
            (section as Mutable<Section>).valid = false;
          }
        }
      }
      if (
        diagnostics.some((d) =>
          d.range && d.range.start >= frame.node.range.start &&
          d.range.start < end && d.severity === "error"
        )
      ) frame.node.valid = false;
    }
    afterBlank = false;
  };
  const readPayload = (): EmbeddedContent => {
    const opening = lines[index];
    const match = /^([ \t]*)(`{3,})(.*)$/s.exec(opening.content)!;
    const indentation = match[1],
      fenceLength = match[2].length,
      type = trim(match[3]) || undefined;
    let valid = type === undefined || /^[A-Za-z][A-Za-z0-9_+.-]*$/.test(type);
    if (!valid) {
      error(
        "SIGIL_INVALID_LITERAL_TYPE",
        "Fence type must be one valid notation label.",
        nameRange(opening, type!),
      );
    }
    let last = index + 1;
    while (last < lines.length) {
      const closer = /^[ \t]*(`{3,})[ \t]*$/.exec(lines[last].content);
      if (closer && closer[1].length >= fenceLength) break;
      last++;
    }
    const closing = lines[last];
    const bodyRange = {
      start: opening.end,
      end: closing?.start ?? source.byteLength,
    };
    const bodyLines = lines.slice(index + 1, last);
    const rawBody = source.slice(bodyRange);
    const body = bodyLines.map((line) =>
      (line.content.startsWith(indentation)
        ? line.content.slice(indentation.length)
        : line.content) + line.ending
    ).join("");
    if (!closing || opening.ending === "") {
      valid = false;
      error(
        "SIGIL_UNCLOSED_LITERAL_BLOCK",
        "Fenced payload has no qualifying closer.",
        { start: opening.start, end: opening.end },
        [point],
      );
      markIncomplete(true);
    }
    index = closing ? last + 1 : lines.length;
    return {
      type,
      indentation,
      fenceLength,
      rawBody,
      body,
      sourceLines: bodyLines.map((l) => l.content),
      range: { start: opening.start, end: closing?.end ?? source.byteLength },
      bodyRange,
      openingRange: { start: opening.start, end: opening.end },
      closingRange: closing
        ? { start: closing.start, end: closing.end }
        : undefined,
      valid,
      complete: Boolean(closing),
    };
  };
  const linkProtectsHeader = (lineIndex: number): boolean => {
    const line = lines[lineIndex];
    if (!line.content.includes("[")) return false;
    // The candidate line can contain a link opener, but later structural lines
    // delimit prose before inline recognition (lexical.region). Do not complete
    // an earlier paragraph's unfinished link across this attempted header.
    let end = lineIndex + 1;
    while (end < lines.length) {
      const content = trim(rawLine(lines[end]));
      if (
        !content || content === "}" || /^`{3,}/.test(content) ||
        content.endsWith("{")
      ) break;
      end++;
    }
    const brace = source.byteOffsetAtUtf16(
      line.utf16Start + line.content.lastIndexOf("{"),
    )!;
    return scanInlineContent(filePath, source, {
      start: line.start,
      end: lines[end - 1].end,
    }).links.some((link) =>
      link.range.start <= brace && brace < link.range.end
    );
  };
  while (index < lines.length) {
    const line = lines[index];
    const content = trim(rawLine(line));
    const frame = stack.at(-1);
    if (!content) {
      flush();
      afterBlank = true;
      index++;
      continue;
    }
    if (frame && frame.kind !== "component" && /^`{3,}/.test(content)) {
      const attached = paragraph.length > 0;
      const detachedFrom =
        !attached && afterBlank && lastFacet?.parent === frame &&
          lastFacet.facet.literalBlocks.length === 0
          ? lastFacet.facet
          : undefined;
      if (!attached) {
        error(
          detachedFrom
            ? "SIGIL_DETACHED_LITERAL_BLOCK"
            : "SIGIL_LITERAL_WITHOUT_INTRODUCTION",
          "A payload needs immediately preceding prose in the same container.",
          { start: line.start, end: line.end },
          detachedFrom ? [detachedFrom.proseRange] : [],
        );
      }
      const payload = readPayload();
      if (attached) flush(payload);
      else {invalidRegions.push({
          kind: "detached-payload",
          range: payload.range,
          valid: false,
          complete: payload.complete,
          payload,
        });}
      afterBlank = false;
      continue;
    }
    if (content === "}") {
      flush();
      if (frame) close(line.end, line.start, true);
      else {
        error("SIGIL_PARSE_STRUCTURE", "Unmatched closing brace.", {
          start: line.start,
          end: line.end,
        });
        invalidRegions.push({
          kind: "structure",
          range: { start: line.start, end: line.end },
          valid: false,
          complete: true,
        });
      }
      index++;
      continue;
    }
    if (
      frame && frame.kind !== "component" && content.endsWith("{") &&
      linkProtectsHeader(index)
    ) {
      paragraph.push(line);
      afterBlank = false;
      index++;
      continue;
    }
    const componentOpen =
      /^component[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*\{[ \t]*$/.exec(content);
    if (!frame && componentOpen) {
      flush();
      const range = { start: line.start, end: line.end };
      const node: ComponentDraft = {
        kind: "component",
        id: sourceOccurrenceId(filePath, "component", range.start),
        name: componentOpen[1],
        range,
        headerRange: range,
        nameRange: nameRange(
          line,
          componentOpen[1],
          line.content.indexOf("component") + 9,
        ),
        sections: [],
        valid: true,
        complete: true,
      };
      components.push(node);
      stack.push({ kind: "component", node });
      index++;
      afterBlank = false;
      continue;
    }
    if (!frame && content.startsWith("@")) {
      const prefix =
        /^@(.+?)[ \t]+from[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]+import[ \t]*\{/
          .exec(content);
      if (
        prefix && ![...prefix[1]].some(isSourceWhitespace) &&
        !/[*,{}]/.test(prefix[1])
      ) {
        const prefixAt = line.utf16Start + rawLine(line).indexOf("@") +
          (line.number === 1 && line.content.startsWith("\uFEFF") ? 1 : 0);
        const bodyStart = prefixAt + prefix[0].length;
        let last = index, closeUtf16: number | undefined;
        for (; last < lines.length; last++) {
          if (
            last > index &&
            /^(?:component[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*\{[ \t]*$|@.+[ \t]+from[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]+import[ \t]*\{)/
              .test(trim(lines[last].content))
          ) break;
          const from = last === index ? bodyStart - line.utf16Start : 0;
          const closeAt = lines[last].content.indexOf("}", from);
          if (closeAt >= 0) {
            closeUtf16 = lines[last].utf16Start + closeAt;
            break;
          }
        }
        const end = closeUtf16 === undefined
          ? (lines[last]?.start ?? source.byteLength)
          : lines[last].end;
        const bodyEnd = closeUtf16 ?? source.utf16OffsetAtByte(end)!;
        const body = source.text.slice(bodyStart, bodyEnd);
        const parts = body.split(",");
        let cursor = bodyStart, valid = closeUtf16 !== undefined;
        const selections = [];
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
          const part = parts[partIndex],
            leading = part.match(/^[ \t\r\n]*/)?.[0].length ?? 0;
          const name = part.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
          if (!name && partIndex === parts.length - 1 && partIndex > 0) break;
          const selectionValid = validTagName(name);
          valid &&= selectionValid;
          selections.push({
            name,
            range: byteRange(cursor + leading, cursor + leading + name.length),
            valid: selectionValid,
            complete: true,
          });
          cursor += part.length + 1;
        }
        if (
          closeUtf16 !== undefined &&
          trim(
              source.text.slice(
                closeUtf16 + 1,
                source.utf16OffsetAtByte(lines[last].contentEnd)!,
              ),
            ) !== ""
        ) valid = false;
        if (!valid) {
          error(
            "SIGIL_PARSE_STRUCTURE",
            "Malformed or incomplete Tag import selection list.",
            { start: line.start, end },
          );
        }
        const providerEnd = prefixAt + prefix[0].lastIndexOf("import") -
          (prefix[0].slice(0, prefix[0].lastIndexOf("import")).match(/[ \t]+$/)
            ?.[0].length ?? 0);
        imports.push({
          path: prefix[1],
          pathRange: nameRange(line, prefix[1]),
          provider: prefix[2],
          providerRange: byteRange(providerEnd - prefix[2].length, providerEnd),
          names: selections.map((s) => s.name),
          nameRanges: selections.map((s) => s.range),
          selections,
          range: { start: line.start, end },
          valid,
          complete: closeUtf16 !== undefined,
        });
        if (closeUtf16 === undefined) complete = false;
        index = closeUtf16 === undefined ? last : last + 1;
        continue;
      }
    }
    const header = /^(.*?)[ \t]*\{[ \t]*$/s.exec(content);
    if (frame && header && header[1]) {
      flush();
      const name = trim(header[1]),
        range = { start: line.start, end: line.end };
      if (frame.kind === "component") {
        const known = SECTIONS.has(name);
        const node: SectionDraft = {
          name,
          known,
          range,
          headerRange: range,
          nameRange: nameRange(line, name),
          bodyRange: { start: line.end, end: line.end },
          units: [],
          groups: [],
          valid: known,
          complete: true,
        };
        frame.node.sections.push(node);
        if (known) {
          stack.push({ kind: "section", node });
          index++;
        } else {
          error(
            "SIGIL_UNKNOWN_SECTION",
            `Unknown contract ${JSON.stringify(name)}.`,
            node.nameRange,
          );
          let depth = 1;
          index++;
          while (index < lines.length && depth > 0) {
            const skipped = trim(lines[index].content);
            if (/^`{3,}/.test(skipped)) {
              const payload = readPayload();
              if (!payload.complete) node.complete = false;
              continue;
            }
            if (skipped === "}") depth--;
            else if (/\{[ \t]*$/.test(skipped)) depth++;
            if (depth === 0) {
              node.bodyRange = { start: line.end, end: lines[index].start };
              node.range = { start: line.start, end: lines[index].end };
            }
            index++;
          }
          if (depth) {
            if (node.complete) {
              error(
                "SIGIL_UNCLOSED_BLOCK",
                "Unclosed unknown contract.",
                node.headerRange,
                [point],
              );
            }
            node.complete = false;
            node.bodyRange = { start: line.end, end: source.byteLength };
            node.range = { start: line.start, end: source.byteLength };
            markIncomplete();
          }
        }
      } else {
        const valid = validTagName(name) && frame.kind !== "group";
        const node: GroupDraft = {
          id: sourceOccurrenceId(filePath, "group", line.start),
          name,
          range,
          headerRange: range,
          nameRange: nameRange(line, name),
          bodyRange: { start: line.end, end: line.end },
          units: [],
          groups: [],
          valid,
          complete: true,
        };
        frame.node.groups.push(node);
        if (!validTagName(name)) {
          error(
            "SIGIL_INVALID_TAG_NAME",
            "Invalid grouping Tag name.",
            node.nameRange,
          );
        } else if (frame.kind === "group") {
          error(
            "SIGIL_NESTED_TAG_GROUP",
            "Grouping Tags cannot nest.",
            node.headerRange,
            [frame.node.headerRange],
          );
        }
        stack.push({ kind: "group", node });
        index++;
      }
      afterBlank = false;
      continue;
    }
    if (frame && frame.kind !== "component" && content !== "{") {
      paragraph.push(line);
      afterBlank = false;
      index++;
      continue;
    }
    flush();
    error(
      "SIGIL_PARSE_STRUCTURE",
      "Text does not fit this structural context.",
      { start: line.start, end: line.end },
    );
    invalidRegions.push({
      kind: "structure",
      range: { start: line.start, end: line.end },
      valid: false,
      complete: true,
    });
    index++;
  }
  flush();
  while (stack.length) {
    close(
      source.byteLength,
      source.byteLength,
      false,
      stack.at(-1)!.suppressUnclosed ?? false,
    );
  }
  diagnostics.push(
    ...proseWidthDiagnostics(
      filePath,
      source,
      components.flatMap((c) => c.sections.flatMap((s) => s.units)),
    ),
  );
  return finish();
}
