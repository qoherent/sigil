import { diagnostic } from "./diagnostics.ts";
import type {
  ComponentDeclaration,
  ConceptBlock,
  ExpandDeclaration,
  ImportDeclaration,
  LiteralBlock,
  ParseOptions,
  ParseResult,
  Section,
  SemanticUnit,
  SigilDocument,
} from "./model/source.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import {
  SIGIL_VERSION,
  type SigilFormKind,
  type SigilSectionName,
  type SourceRange,
} from "./model/language.ts";
import { isModuleFile } from "./path.ts";

/**
 * A component states its own boundary, so an expansion cannot declare what the
 * component does not cover. `interface` is deliberately excluded here: reusing
 * an imported identifier in a matching expand's `interface` re-exposes that
 * identity downstream, which the language specifies.
 */
const COMPONENT_ONLY_SECTIONS = new Set<SigilSectionName>(["scope"]);

const SECTION_NAMES = new Set<SigilSectionName>([
  "goal",
  "interface",
  "scope",
  "state",
  "logic",
  "constraints",
  "decisions",
  "cases",
]);
const CONCEPT_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PREFERRED_CONCEPT_IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/;
const LITERAL_TYPE = /^[A-Za-z][A-Za-z0-9_+.-]*$/;
const PROSE_WIDTH = 79;

interface FormDraft {
  kind: SigilFormKind;
  name: string;
  startLine: number;
  sections: Section[];
}

interface SectionDraft {
  name: SigilSectionName;
  startLine: number;
  units: SemanticUnit[];
  concepts: ConceptBlock[];
  ungroupedUnits: SemanticUnit[];
  freeformBraceDepth: number;
}

interface ConceptDraft {
  identifier: string;
  startLine: number;
  units: SemanticUnit[];
  braceDepth: number;
}

interface ParagraphDraft {
  startLine: number;
  endLine: number;
  lines: string[];
  literalBlocks: LiteralBlock[];
}

/*
 * @sigil implements packages/core/src/parser.sigil::SigilParser::SourceDocumentParsing interface
 * @sigil implements packages/core/src/parser.sigil::SigilParser::SourceDocument logic,constraints,cases
 * @sigil implements packages/core/src/parser.sigil::SigilParser::LiteralBlock logic,constraints,cases
 * @sigil implements packages/core/src/parser.sigil::SigilParser::SemanticUnit constraints,cases
 */
export function parseSigilDocument(
  filePath: string,
  source: string,
  options: ParseOptions,
): ParseResult {
  const diagnostics: SigilDiagnostic[] = [];
  const imports: ImportDeclaration[] = [];
  const components: ComponentDeclaration[] = [];
  const expands: ExpandDeclaration[] = [];
  const lines = source.split(/\r?\n/);

  if (options.sigilVersion !== SIGIL_VERSION) {
    const unsupported = diagnostic(
      "SIGIL_UNSUPPORTED_VERSION",
      `Unsupported sigilVersion ${
        JSON.stringify(options.sigilVersion)
      }; supported version is ${SIGIL_VERSION}.`,
      { filePath, range: singlePointRange(1) },
    );
    const document: SigilDocument = {
      filePath,
      imports: [],
      components: [],
      expands: [],
      diagnostics: [unsupported],
    };
    return { document, diagnostics: [unsupported] };
  }

  const disallowedSections = new Set<string>();
  let form: FormDraft | undefined;
  let section: SectionDraft | undefined;
  let concept: ConceptDraft | undefined;
  let paragraph: ParagraphDraft | undefined;
  let blankBeforeCurrent = false;

  const flushParagraph = (): void => {
    if (!paragraph || !form || !section) return;
    const owner = concept ?? section;
    const unit = makeSemanticUnit(
      filePath,
      paragraph,
      form,
      section.name,
      concept?.identifier,
    );
    section.units.push(unit);
    if (concept) owner.units.push(unit);
    else section.ungroupedUnits.push(unit);
    paragraph = undefined;
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (section && form) {
      const fence = openingFence(trimmed);
      if (fence) {
        const hadPriorContent = Boolean(
          paragraph || concept?.units.length || section.units.length,
        );
        if (!paragraph) {
          diagnostics.push(diagnostic(
            blankBeforeCurrent && hadPriorContent
              ? "SIGIL_DETACHED_LITERAL_BLOCK"
              : "SIGIL_LITERAL_WITHOUT_INTRODUCTION",
            blankBeforeCurrent && hadPriorContent
              ? "A literal block must immediately follow its introducing prose without a blank line."
              : "A literal block requires preceding prose in the same section or concept block.",
            { filePath, range: lineRange(lineNumber, line) },
          ));
          paragraph = {
            startLine: lineNumber,
            endLine: lineNumber,
            lines: [],
            literalBlocks: [],
          };
        }
        if (fence.type !== undefined && !LITERAL_TYPE.test(fence.type)) {
          diagnostics.push(diagnostic(
            "SIGIL_INVALID_LITERAL_TYPE",
            `Invalid literal type ${JSON.stringify(fence.type)}.`,
            { filePath, range: lineRange(lineNumber, line) },
          ));
        }
        const parsed = parseLiteralBlock(
          lines,
          index,
          fence,
          filePath,
          diagnostics,
        );
        paragraph.literalBlocks.push(parsed.block);
        paragraph.endLine = parsed.endIndex + 1;
        index = parsed.endIndex;
        flushParagraph();
        blankBeforeCurrent = false;
        continue;
      }

      if (trimmed.length === 0) {
        flushParagraph();
        reportUngroupedInterfaceRegion(section, filePath, diagnostics);
        blankBeforeCurrent = true;
        continue;
      }

      if (
        trimmed === "}" && paragraph &&
        (concept ? concept.braceDepth === 1 : section.freeformBraceDepth === 0)
      ) {
        flushParagraph();
      }

      if (
        concept && trimmed === "}" && concept.braceDepth === 1 &&
        !paragraph
      ) {
        finishConcept(
          section,
          concept,
          lineNumber,
          line.length,
          filePath,
          diagnostics,
        );
        concept = undefined;
        blankBeforeCurrent = false;
        continue;
      }

      if (
        !concept && trimmed === "}" && section.freeformBraceDepth === 0 &&
        !paragraph
      ) {
        if (disallowedSections.has(section.name)) {
          disallowedSections.delete(section.name);
        } else {
          reportUngroupedInterfaceRegion(section, filePath, diagnostics);
          form.sections.push(finishSection(section, lineNumber, line.length));
        }
        section = undefined;
        blankBeforeCurrent = false;
        continue;
      }

      const header = !paragraph &&
          (concept ? concept.braceDepth : section.freeformBraceDepth) ===
            (concept ? 1 : 0)
        ? conceptHeader(trimmed)
        : undefined;
      if (header) {
        if (concept) {
          diagnostics.push(diagnostic(
            "SIGIL_NESTED_CONCEPT_BLOCK",
            "Concept blocks cannot nest.",
            { filePath, range: lineRange(lineNumber, line) },
          ));
        } else {
          reportUngroupedInterfaceRegion(section, filePath, diagnostics);
          validateConceptIdentifier(
            header.identifier,
            lineNumber,
            line,
            filePath,
            diagnostics,
          );
          concept = {
            identifier: header.identifier,
            startLine: lineNumber,
            units: [],
            braceDepth: 1,
          };
          blankBeforeCurrent = false;
          continue;
        }
      }

      reportProseWidth(line, lineNumber, filePath, diagnostics);
      paragraph ??= {
        startLine: lineNumber,
        endLine: lineNumber,
        lines: [],
        literalBlocks: [],
      };
      paragraph.lines.push(line);
      paragraph.endLine = lineNumber;
      if (concept) concept.braceDepth += braceDelta(line);
      else section.freeformBraceDepth += braceDelta(line);
      blankBeforeCurrent = false;
      continue;
    }

    if (form) {
      if (trimmed === "}") {
        const declaration = finishForm(form, lineNumber, line.length);
        if (declaration.kind === "component") components.push(declaration);
        else expands.push(declaration);
        form = undefined;
        continue;
      }
      const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\{\s*$/);
      if (sectionMatch) {
        const sectionName = sectionMatch[1];
        if (SECTION_NAMES.has(sectionName as SigilSectionName)) {
          if (
            form.kind === "expand" &&
            COMPONENT_ONLY_SECTIONS.has(sectionName as SigilSectionName)
          ) {
            // Read the body anyway, so one misplaced section reports once
            // instead of derailing the rest of the file.
            disallowedSections.add(sectionName);
            diagnostics.push(diagnostic(
              "SIGIL_SECTION_NOT_ALLOWED",
              `Section "${sectionName}" belongs to a component and cannot appear in expand ${form.name}.`,
              { filePath, range: lineRange(lineNumber, line) },
            ));
          }
          section = {
            name: sectionName as SigilSectionName,
            startLine: lineNumber,
            units: [],
            concepts: [],
            ungroupedUnits: [],
            freeformBraceDepth: 0,
          };
        } else {
          diagnostics.push(diagnostic(
            "SIGIL_UNKNOWN_SECTION",
            `Unknown section "${sectionName}".`,
            { filePath, range: lineRange(lineNumber, line) },
          ));
        }
        continue;
      }
      if (trimmed.length > 0) {
        diagnostics.push(diagnostic(
          "SIGIL_PARSE_STRUCTURE",
          `Unexpected content inside ${form.kind} ${form.name}.`,
          { filePath, range: lineRange(lineNumber, line) },
        ));
      }
      continue;
    }

    if (trimmed.length === 0) continue;
    const importMatch = trimmed.match(
      /^@(.+?)\s+import\s+\{\s*([^}]+?)\s*\}\s*$/,
    );
    if (importMatch) {
      const names = importMatch[2].split(",").map((name) => name.trim()).filter(
        Boolean,
      );
      imports.push({
        path: importMatch[1].trim(),
        names,
        nameRanges: importNameRanges(lineNumber, line, names),
        range: lineRange(lineNumber, line),
      });
      continue;
    }
    const formMatch = trimmed.match(
      /^(component|expand)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{\s*$/,
    );
    if (formMatch) {
      form = {
        kind: formMatch[1] as SigilFormKind,
        name: formMatch[2],
        startLine: lineNumber,
        sections: [],
      };
      continue;
    }
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      "Unexpected top-level content.",
      { filePath, range: lineRange(lineNumber, line) },
    ));
  }

  flushParagraph();
  if (concept && section && form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed concept ${concept.identifier}.`,
      { filePath, range: singlePointRange(concept.startLine) },
    ));
    finishConcept(
      section,
      concept,
      lines.length,
      lines.at(-1)?.length ?? 1,
      filePath,
      diagnostics,
    );
  }
  if (section && form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed section ${section.name}.`,
      { filePath, range: singlePointRange(section.startLine) },
    ));
    // Recovery keeps a partial declaration usable, but a section rejected
    // for its declaration form stays rejected: a consumer reading the
    // recovered expansion would otherwise see the boundary the diagnostic
    // denied.
    if (!disallowedSections.has(section.name)) {
      form.sections.push(
        finishSection(section, lines.length, lines.at(-1)?.length ?? 1),
      );
      reportUngroupedInterfaceRegion(section, filePath, diagnostics);
    }
  }
  if (form) {
    diagnostics.push(diagnostic(
      "SIGIL_PARSE_STRUCTURE",
      `Unclosed ${form.kind} ${form.name}.`,
      { filePath, range: singlePointRange(form.startLine) },
    ));
    const declaration = finishForm(
      form,
      lines.length,
      lines.at(-1)?.length ?? 1,
    );
    if (declaration.kind === "component") components.push(declaration);
    else expands.push(declaration);
  }

  for (const component of components) {
    const sectionNames = new Set(component.sections.map((item) => item.name));
    if (!sectionNames.has("goal")) {
      diagnostics.push(diagnostic(
        "SIGIL_MISSING_GOAL",
        `component ${component.name} is missing required goal section.`,
        { filePath, range: component.range },
      ));
    }
    if (!sectionNames.has("interface")) {
      diagnostics.push(diagnostic(
        "SIGIL_MISSING_INTERFACE",
        `component ${component.name} is missing required interface section.`,
        { filePath, range: component.range },
      ));
    }
  }
  if (isModuleFile(filePath) && components.length === 0) {
    diagnostics.push(diagnostic(
      "SIGIL_MODULE_WITHOUT_COMPONENT",
      "_module.sigil must declare at least one component.",
      { filePath },
    ));
  }
  const document: SigilDocument = {
    filePath,
    imports,
    components,
    expands,
    diagnostics,
  };
  return { document, diagnostics };
}

function openingFence(
  trimmed: string,
): { fenceLength: number; type?: string } | undefined {
  const match = trimmed.match(/^(`{3,})(.*)$/);
  if (!match) return undefined;
  const type = match[2].trim();
  return { fenceLength: match[1].length, type: type || undefined };
}

function parseLiteralBlock(
  lines: readonly string[],
  startIndex: number,
  opener: { fenceLength: number; type?: string },
  filePath: string,
  diagnostics: SigilDiagnostic[],
): { block: LiteralBlock; endIndex: number } {
  const openingLine = lines[startIndex];
  const indentation = firstColumn(openingLine) - 1;
  const bodyLines: string[] = [];
  let endIndex = lines.length - 1;
  let closed = false;
  for (let index = startIndex + 1; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    const close = trimmed.match(/^(`{3,})$/);
    if (close && close[1].length >= opener.fenceLength) {
      endIndex = index;
      closed = true;
      break;
    }
    bodyLines.push(lines[index]);
  }
  if (!closed) {
    diagnostics.push(diagnostic(
      "SIGIL_UNCLOSED_LITERAL_BLOCK",
      "Literal block is missing a closing backtick fence.",
      { filePath, range: lineRange(startIndex + 1, openingLine) },
    ));
  }
  const dedented = bodyLines.map((line) =>
    line.startsWith(" ".repeat(indentation)) ? line.slice(indentation) : line
  );
  return {
    block: {
      type: opener.type,
      body: dedented.join("\n"),
      sourceLines: bodyLines,
      fenceLength: opener.fenceLength,
      indentation,
      range: {
        start: lineRange(startIndex + 1, openingLine).start,
        end: lineRange(endIndex + 1, lines[endIndex] ?? "").end,
      },
      bodyRange: {
        start: { line: startIndex + 2, column: 1 },
        end: { line: Math.max(startIndex + 2, endIndex), column: 1 },
      },
    },
    endIndex,
  };
}

function makeSemanticUnit(
  filePath: string,
  paragraph: ParagraphDraft,
  form: FormDraft,
  sectionName: SigilSectionName,
  conceptIdentifier?: string,
): SemanticUnit {
  const prose = paragraph.lines.map((line) => line.trim()).join(" ");
  const lastLiteral = paragraph.literalBlocks.at(-1);
  const lastSourceLine = paragraph.lines.at(-1) ?? "";
  return {
    filePath,
    range: {
      start: paragraph.lines.length > 0
        ? lineRange(paragraph.startLine, paragraph.lines[0]).start
        : lastLiteral?.range.start ??
          singlePointRange(paragraph.startLine).start,
      end: lastLiteral?.range.end ??
        lineRange(paragraph.endLine, lastSourceLine).end,
    },
    ownerKind: form.kind,
    ownerName: form.name,
    sectionName,
    conceptIdentifier,
    prose,
    sourceLines: paragraph.lines,
    literalBlocks: paragraph.literalBlocks,
  };
}

function finishSection(
  section: SectionDraft,
  endLine: number,
  endColumn: number,
): Section {
  return {
    name: section.name,
    range: {
      start: { line: section.startLine, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    bodyRange: {
      start: { line: section.startLine + 1, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    units: section.units,
    concepts: section.concepts,
  };
}

function finishConcept(
  section: SectionDraft,
  concept: ConceptDraft,
  endLine: number,
  endColumn: number,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  const range = {
    start: { line: concept.startLine, column: 1 },
    end: { line: endLine, column: Math.max(1, endColumn + 1) },
  };
  if (concept.units.length === 0) {
    diagnostics.push(diagnostic(
      "SIGIL_EMPTY_CONCEPT_BLOCK",
      `Concept block ${concept.identifier} must contain at least one semantic unit.`,
      { filePath, range },
    ));
  }
  section.concepts.push({
    identifier: concept.identifier,
    range,
    bodyRange: {
      start: { line: concept.startLine + 1, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    units: concept.units,
  });
}

function reportUngroupedInterfaceRegion(
  section: SectionDraft,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  if (
    section.name !== "interface" || section.ungroupedUnits.length === 0
  ) {
    section.ungroupedUnits = [];
    return;
  }
  const first = section.ungroupedUnits[0];
  const last = section.ungroupedUnits.at(-1)!;
  diagnostics.push(diagnostic(
    "SIGIL_MISSING_CONCEPT_IDENTIFIER",
    "Interface content should be grouped under one or more concept identifiers.",
    {
      severity: "warning",
      filePath,
      range: { start: first.range.start, end: last.range.end },
    },
  ));
  section.ungroupedUnits = [];
}

function validateConceptIdentifier(
  identifier: string,
  lineNumber: number,
  line: string,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  if (!CONCEPT_IDENTIFIER.test(identifier)) {
    diagnostics.push(diagnostic(
      "SIGIL_INVALID_CONCEPT_IDENTIFIER",
      `Invalid concept identifier ${
        JSON.stringify(identifier)
      }; expected [A-Za-z][A-Za-z0-9_-]* with no spaces.`,
      { filePath, range: lineRange(lineNumber, line) },
    ));
  } else if (!PREFERRED_CONCEPT_IDENTIFIER.test(identifier)) {
    diagnostics.push(diagnostic(
      "SIGIL_CONCEPT_IDENTIFIER_STYLE",
      `Concept identifier ${identifier} is valid; prefer PascalCase without hyphens or underscores.`,
      {
        severity: "info",
        filePath,
        range: identifierRange(lineNumber, line, identifier),
      },
    ));
  }
}

function reportProseWidth(
  line: string,
  lineNumber: number,
  filePath: string,
  diagnostics: SigilDiagnostic[],
): void {
  const content = line.trimStart();
  if ([...content].length <= PROSE_WIDTH) return;
  const indivisible = content.split(/\s+/).some((token) =>
    [...token].length > PROSE_WIDTH
  );
  diagnostics.push(diagnostic(
    indivisible ? "SIGIL_UNFORMATTABLE_LINE" : "SIGIL_LINE_TOO_LONG",
    indivisible
      ? `An indivisible prose token exceeds ${PROSE_WIDTH} content characters.`
      : `Prose exceeds the canonical ${PROSE_WIDTH}-character content width.`,
    {
      severity: indivisible ? "error" : "info",
      filePath,
      range: lineRange(lineNumber, line),
    },
  ));
}

function importNameRanges(
  lineNumber: number,
  line: string,
  names: readonly string[],
): SourceRange[] {
  let cursor = line.indexOf("{") + 1;
  return names.map((name) => {
    const found = line.indexOf(name, cursor);
    cursor = found + name.length;
    return {
      start: { line: lineNumber, column: found + 1 },
      end: { line: lineNumber, column: found + name.length + 1 },
    };
  });
}

function conceptHeader(
  trimmed: string,
): { readonly identifier: string } | undefined {
  const match = trimmed.match(/^(.+?)\s*\{\s*$/);
  if (!match || trimmed.startsWith("@")) return undefined;
  const identifier = match[1].trim();
  if (/[=:()\[\]<>"'`]/.test(identifier)) return undefined;
  return { identifier };
}

function finishForm(
  form: FormDraft,
  endLine: number,
  endColumn: number,
): ComponentDeclaration | ExpandDeclaration {
  const base = {
    name: form.name,
    range: {
      start: { line: form.startLine, column: 1 },
      end: { line: endLine, column: Math.max(1, endColumn + 1) },
    },
    sections: form.sections,
  };
  return form.kind === "component"
    ? { kind: "component", ...base }
    : { kind: "expand", ...base };
}

function lineRange(lineNumber: number, line: string): SourceRange {
  return {
    start: { line: lineNumber, column: firstColumn(line) },
    end: { line: lineNumber, column: line.length + 1 },
  };
}

function identifierRange(
  lineNumber: number,
  line: string,
  identifier: string,
): SourceRange {
  const start = Math.max(0, line.indexOf(identifier));
  return {
    start: { line: lineNumber, column: start + 1 },
    end: { line: lineNumber, column: start + identifier.length + 1 },
  };
}

function singlePointRange(lineNumber: number): SourceRange {
  return {
    start: { line: lineNumber, column: 1 },
    end: { line: lineNumber, column: 1 },
  };
}

function firstColumn(line: string): number {
  const match = line.match(/\S/);
  return match ? match.index! + 1 : 1;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta++;
    if (char === "}") delta--;
  }
  return delta;
}
