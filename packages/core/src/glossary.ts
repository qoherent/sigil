import { globMatches } from "./config.ts";
import { diagnostic } from "./diagnostics.ts";
import type {
  GlossaryContextProjection,
  GlossaryOccurrence,
  GlossaryParseResult,
  GlossaryProjection,
  GlossaryScope,
  GlossaryTerm,
  ResolvedGlossaryContext,
  SemanticUnit,
  SigilDiagnostic,
  SigilDocument,
  SigilWorkspace,
  SourceLocation,
  SourceRange,
  WorkspaceGlossary,
} from "./model.ts";
import { SIGIL_GLOSSARY_PATH } from "./model.ts";
import { normalizePath, relativePath } from "./path.ts";

export const GLOSSARY_SCHEMA_VERSION = 1 as const;

// @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::GlossaryInterpretation interface,logic,constraints,cases
export function parseSigilGlossary(
  source: string,
  filePath: string = SIGIL_GLOSSARY_PATH,
): GlossaryParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      diagnostics: [diagnostic(
        "SIGIL_GLOSSARY_PARSE",
        `Unable to parse ${SIGIL_GLOSSARY_PATH} JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { filePath },
      )],
    };
  }

  const messages: string[] = [];
  if (!isObject(value)) {
    messages.push("Glossary must be a JSON object.");
  } else {
    rejectUnknown(
      value,
      ["schemaVersion", "terms", "contexts"],
      "glossary",
      messages,
    );
    if (value.schemaVersion !== GLOSSARY_SCHEMA_VERSION) {
      messages.push(
        `schemaVersion must equal ${GLOSSARY_SCHEMA_VERSION}.`,
      );
    }
    validateTermArray(value.terms, "terms", messages);
    validateContexts(value.contexts, messages);
  }

  if (messages.length > 0) {
    return {
      diagnostics: messages.map((message) =>
        diagnostic(
          message.includes(" collides with ")
            ? "SIGIL_GLOSSARY_TERM_COLLISION"
            : "SIGIL_GLOSSARY_INVALID",
          message,
          { filePath },
        )
      ),
    };
  }

  const raw = value as {
    schemaVersion: 1;
    terms: RawGlossaryTerm[];
    contexts: RawGlossaryContext[];
  };
  const rangeFinder = new TermRangeFinder(source);
  const workspaceScope: GlossaryScope = { kind: "workspace" };
  const terms = raw.terms.map((entry) =>
    toTerm(entry, workspaceScope, rangeFinder)
  );
  const contexts = raw.contexts.map((context) => {
    const scope: GlossaryScope = { kind: "context", id: context.id };
    return {
      id: context.id,
      include: [...context.include],
      exclude: [...context.exclude],
      terms: context.terms.map((entry) => toTerm(entry, scope, rangeFinder)),
    };
  });
  return {
    glossary: {
      schemaVersion: GLOSSARY_SCHEMA_VERSION,
      filePath,
      terms,
      contexts,
    },
    diagnostics: [],
  };
}

/*
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolutionEngine interface
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::ContextResolution logic,constraints,cases
 */
export function resolveGlossaryForFile(
  glossary: WorkspaceGlossary,
  filePath: string,
): {
  readonly context: ResolvedGlossaryContext;
  readonly diagnostics: readonly SigilDiagnostic[];
} {
  const normalized = normalizeRelative(filePath);
  const matches = glossary.contexts.filter((context) =>
    context.include.some((pattern) => globMatches(pattern, normalized)) &&
    !context.exclude.some((pattern) => globMatches(pattern, normalized))
  );
  if (matches.length > 1) {
    return {
      context: { filePath: normalized, entries: glossary.terms },
      diagnostics: [diagnostic(
        "SIGIL_GLOSSARY_CONTEXT_OVERLAP",
        `Sigil source ${normalized} matches multiple glossary contexts: ${
          matches.map((context) => context.id).join(", ")
        }.`,
        { filePath },
      )],
    };
  }

  const matched = matches[0];
  const entries = matched
    ? mergeEffectiveTerms(glossary.terms, matched.terms)
    : glossary.terms;
  return {
    context: {
      filePath: normalized,
      contextId: matched?.id,
      entries,
    },
    diagnostics: [],
  };
}

/*
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognitionEngine interface
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognition logic,constraints,cases
 */
export function glossaryOccurrencesForDocument(
  context: ResolvedGlossaryContext,
  document: SigilDocument,
): readonly GlossaryOccurrence[] {
  if (context.entries.length === 0) return [];
  const spellings = context.entries.flatMap((term) =>
    [term.term, ...term.aliases].map((spelling) => ({ spelling, term }))
  ).sort((left, right) =>
    right.spelling.length - left.spelling.length ||
    left.spelling.localeCompare(right.spelling)
  );
  const units = [...document.components, ...document.expands]
    .flatMap((declaration) =>
      declaration.sections.flatMap((section) => section.units)
    )
    .sort((left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.column - right.range.start.column
    );

  const occurrences: GlossaryOccurrence[] = [];
  for (const unit of units) {
    occurrences.push(...matchUnit(unit, spellings));
  }
  return occurrences;
}

/*
 * @sigil implements packages/core/_module.sigil::SigilCore::GlossaryInspectionFacade interface
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::GlossaryInspection interface,logic,constraints,cases
 * @sigil implements packages/core/_module.sigil::SigilCore::GlossaryInspection logic,cases
 */
export function glossaryProjectionForWorkspace(
  workspace: SigilWorkspace,
): GlossaryProjection {
  const glossaryDiagnostics = workspace.diagnostics.filter((item) =>
    item.code.startsWith("SIGIL_GLOSSARY_")
  );
  if (!workspace.glossary) {
    return {
      workspaceSnapshotIdentity: workspace.workspaceSnapshotIdentity,
      glossaryPath: workspace.glossaryPath,
      terms: [],
      contexts: [],
      resolvedContexts: [],
      occurrences: [],
      diagnostics: glossaryDiagnostics,
    };
  }

  const resolvedContexts: ResolvedGlossaryContext[] = [];
  const occurrences: GlossaryOccurrence[] = [];
  const diagnostics = [...glossaryDiagnostics];
  for (const file of workspace.files) {
    const relative = relativePath(workspace.root, file.path);
    const resolved = resolveGlossaryForFile(workspace.glossary, relative);
    resolvedContexts.push(resolved.context);
    diagnostics.push(...resolved.diagnostics);
    if (resolved.diagnostics.length === 0) {
      occurrences.push(
        ...glossaryOccurrencesForDocument(resolved.context, file.document),
      );
    }
  }
  return {
    workspaceSnapshotIdentity: workspace.workspaceSnapshotIdentity,
    glossaryPath: workspace.glossary.filePath,
    schemaVersion: workspace.glossary.schemaVersion,
    terms: workspace.glossary.terms,
    contexts: workspace.glossary.contexts,
    resolvedContexts,
    occurrences,
    diagnostics,
  };
}

/*
 * @sigil implements packages/core/_module.sigil::SigilCore::GlossaryInspectionFacade interface
 * @sigil implements packages/core/src/glossary.sigil::SigilGlossaryEngine::GlossaryInspection interface,logic,constraints,cases
 * @sigil implements packages/core/_module.sigil::SigilCore::GlossaryInspection logic,cases
 */
export function glossaryContextForFiles(
  projection: GlossaryProjection,
  filePaths: readonly string[],
): GlossaryContextProjection {
  const selectedPaths = filePaths.map(normalizePath);
  const selectedOccurrences = projection.occurrences.filter((occurrence) =>
    occurrence.term.agentContext &&
    pathIsSelected(occurrence.filePath, selectedPaths)
  );
  const selectedTermKeys = new Set(
    selectedOccurrences.map((occurrence) => glossaryTermKey(occurrence.term)),
  );
  const terms = [
    ...projection.terms,
    ...projection.contexts.flatMap((context) => context.terms),
  ].filter((term) => selectedTermKeys.has(glossaryTermKey(term)));
  const resolvedContexts = projection.resolvedContexts
    .filter((context) => pathIsSelected(context.filePath, selectedPaths))
    .map((context) => ({
      ...context,
      entries: context.entries.filter((term) =>
        selectedTermKeys.has(glossaryTermKey(term))
      ),
    }));
  return {
    glossaryPath: projection.glossaryPath,
    terms,
    resolvedContexts,
    occurrences: selectedOccurrences,
  };
}

interface RawGlossaryTerm {
  readonly term: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly agentContext?: boolean;
}

interface RawGlossaryContext {
  readonly id: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly terms: readonly RawGlossaryTerm[];
}

function glossaryTermKey(term: GlossaryTerm): string {
  const scope = term.scope.kind === "workspace"
    ? "workspace"
    : `context:${normalizeSpelling(term.scope.id)}`;
  return `${scope}:${normalizeSpelling(term.term)}`;
}

function pathIsSelected(
  filePath: string,
  selectedPaths: readonly string[],
): boolean {
  const normalized = normalizePath(filePath);
  return selectedPaths.some((selected) =>
    selected === normalized ||
    selected.endsWith(`/${normalized}`) ||
    normalized.endsWith(`/${selected}`)
  );
}

function validateContexts(value: unknown, messages: string[]): void {
  if (!Array.isArray(value)) {
    messages.push("contexts must be an array.");
    return;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const owner = `contexts[${index}]`;
    if (!isObject(item)) {
      messages.push(`${owner} must be an object.`);
      return;
    }
    rejectUnknown(item, ["id", "include", "exclude", "terms"], owner, messages);
    if (
      typeof item.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id)
    ) {
      messages.push(
        `${owner}.id must match [A-Za-z][A-Za-z0-9_-]*.`,
      );
    } else {
      const normalized = normalizeSpelling(item.id);
      if (ids.has(normalized)) {
        messages.push(
          "Glossary context ids must be unique without regard to case.",
        );
      }
      ids.add(normalized);
    }
    validateGlobArray(item.include, `${owner}.include`, true, messages);
    validateGlobArray(item.exclude, `${owner}.exclude`, false, messages);
    validateTermArray(item.terms, `${owner}.terms`, messages);
  });
}

function validateTermArray(
  value: unknown,
  owner: string,
  messages: string[],
): void {
  if (!Array.isArray(value)) {
    messages.push(`${owner} must be an array.`);
    return;
  }
  const spellings = new Map<string, string>();
  value.forEach((item, index) => {
    const entryOwner = `${owner}[${index}]`;
    if (!isObject(item)) {
      messages.push(`${entryOwner} must be an object.`);
      return;
    }
    rejectUnknown(
      item,
      ["term", "definition", "aliases", "agentContext"],
      entryOwner,
      messages,
    );
    validateTrimmedString(item.term, `${entryOwner}.term`, messages);
    validateTrimmedString(
      item.definition,
      `${entryOwner}.definition`,
      messages,
    );
    if (
      item.aliases !== undefined &&
      (!Array.isArray(item.aliases) ||
        item.aliases.some((alias) => !isTrimmedString(alias)))
    ) {
      messages.push(
        `${entryOwner}.aliases must be an array of trimmed non-empty strings.`,
      );
    }
    if (
      item.agentContext !== undefined &&
      typeof item.agentContext !== "boolean"
    ) {
      messages.push(`${entryOwner}.agentContext must be a boolean.`);
    }
    const entrySpellings = typeof item.term === "string"
      ? [
        item.term,
        ...(Array.isArray(item.aliases)
          ? item.aliases.filter((alias): alias is string =>
            typeof alias === "string"
          )
          : []),
      ]
      : [];
    for (const spelling of entrySpellings) {
      if (!isTrimmedString(spelling)) continue;
      const normalized = normalizeSpelling(spelling);
      const previous = spellings.get(normalized);
      if (previous !== undefined) {
        messages.push(
          `${entryOwner} spelling ${JSON.stringify(spelling)} collides with ${
            JSON.stringify(previous)
          } in the same scope.`,
        );
      } else {
        spellings.set(normalized, spelling);
      }
    }
  });
}

function validateGlobArray(
  value: unknown,
  owner: string,
  nonEmpty: boolean,
  messages: string[],
): void {
  if (
    !Array.isArray(value) || (nonEmpty && value.length === 0) ||
    value.some((item) => !isTrimmedString(item))
  ) {
    messages.push(
      `${owner} must be ${
        nonEmpty ? "a non-empty" : "an"
      } array of trimmed non-empty strings.`,
    );
    return;
  }
  if (value.some((pattern) => !isWorkspaceRelativeGlob(pattern as string))) {
    messages.push(`${owner} patterns must be workspace-relative POSIX globs.`);
  }
  if (new Set(value as string[]).size !== value.length) {
    messages.push(`${owner} patterns must be unique.`);
  }
}

function isWorkspaceRelativeGlob(pattern: string): boolean {
  return !pattern.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/.test(pattern) &&
    !pattern.includes("\\") &&
    !pattern.split("/").includes("..");
}

function validateTrimmedString(
  value: unknown,
  owner: string,
  messages: string[],
): void {
  if (!isTrimmedString(value)) {
    messages.push(`${owner} must be a trimmed non-empty string.`);
  }
}

function isTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value === value.trim();
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  owner: string,
  messages: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      messages.push(`${owner} contains unknown key ${JSON.stringify(key)}.`);
    }
  }
}

function toTerm(
  raw: RawGlossaryTerm,
  scope: GlossaryScope,
  ranges: TermRangeFinder,
): GlossaryTerm {
  return {
    term: raw.term,
    definition: raw.definition,
    aliases: [...(raw.aliases ?? [])],
    agentContext: raw.agentContext ?? true,
    scope,
    declarationRange: ranges.take(raw.term),
  };
}

function mergeEffectiveTerms(
  workspace: readonly GlossaryTerm[],
  contextual: readonly GlossaryTerm[],
): readonly GlossaryTerm[] {
  const contextualSpellings = new Set(
    contextual.flatMap((term) => [term.term, ...term.aliases])
      .map(normalizeSpelling),
  );
  return [
    ...workspace.flatMap((term) => {
      if (contextualSpellings.has(normalizeSpelling(term.term))) return [];
      const aliases = term.aliases.filter((alias) =>
        !contextualSpellings.has(normalizeSpelling(alias))
      );
      return aliases.length === term.aliases.length
        ? [term]
        : [{ ...term, aliases }];
    }),
    ...contextual,
  ];
}

function matchUnit(
  unit: SemanticUnit,
  spellings: readonly { spelling: string; term: GlossaryTerm }[],
): GlossaryOccurrence[] {
  const occurrences: GlossaryOccurrence[] = [];
  for (let offset = 0; offset < unit.sourceLines.length; offset++) {
    const source = unit.sourceLines[offset];
    const text = source.trim();
    const column = source.indexOf(text) + 1;
    occurrences.push(
      ...matchUnitLine(
        unit,
        text,
        unit.range.start.line + offset,
        column,
        spellings,
      ),
    );
  }
  return occurrences;
}

function matchUnitLine(
  unit: SemanticUnit,
  text: string,
  lineNumber: number,
  column: number,
  spellings: readonly { spelling: string; term: GlossaryTerm }[],
): GlossaryOccurrence[] {
  const excluded = excludedColumns(text);
  const lower = text.toLowerCase();
  const occurrences: GlossaryOccurrence[] = [];
  for (let index = 0; index < text.length;) {
    if (excluded[index]) {
      index++;
      continue;
    }
    const match = spellings.find(({ spelling }) => {
      const candidate = spelling.toLowerCase();
      if (!lower.startsWith(candidate, index)) return false;
      const end = index + spelling.length;
      if (excluded.slice(index, end).some(Boolean)) return false;
      return isBoundary(text[index - 1]) &&
        isBoundary(text[end]);
    });
    if (!match) {
      index++;
      continue;
    }
    const matchedSpelling = text.slice(
      index,
      index + match.spelling.length,
    );
    occurrences.push({
      term: match.term,
      matchedSpelling,
      filePath: unit.filePath,
      ownerKind: unit.ownerKind,
      ownerName: unit.ownerName,
      sectionName: unit.sectionName,
      range: {
        start: {
          line: lineNumber,
          column: column + index,
        },
        end: {
          line: lineNumber,
          column: column + index + matchedSpelling.length,
        },
      },
    });
    index += matchedSpelling.length;
  }
  return occurrences;
}

function excludedColumns(text: string): boolean[] {
  const excluded = Array.from({ length: text.length }, () => false);
  for (const match of text.matchAll(/`[^`]*`/gu)) {
    const start = match.index ?? 0;
    excluded.fill(true, start, start + match[0].length);
  }
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s)>\]]+/giu)) {
    const start = match.index ?? 0;
    excluded.fill(true, start, start + match[0].length);
  }
  return excluded;
}

function isBoundary(value: string | undefined): boolean {
  return value === undefined || !/[\p{L}\p{N}_]/u.test(value);
}

function normalizeSpelling(value: string): string {
  return value.toLowerCase();
}

function normalizeRelative(path: string): string {
  return normalizePath(path).replace(/^\.\//, "");
}

class TermRangeFinder {
  readonly #source: string;
  readonly #matches: {
    readonly value: string;
    readonly start: number;
    readonly end: number;
    used: boolean;
  }[];

  constructor(source: string) {
    this.#source = source;
    this.#matches = [...source.matchAll(
      /"term"\s*:\s*("(?:\\.|[^"\\])*")/gu,
    )].flatMap((match) => {
      try {
        const value = JSON.parse(match[1]) as string;
        const quotedStart = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
        return [{
          value,
          start: quotedStart + 1,
          end: quotedStart + match[1].length - 1,
          used: false,
        }];
      } catch {
        return [];
      }
    });
  }

  take(value: string): SourceRange {
    const match = this.#matches.find((item) =>
      !item.used && item.value === value
    );
    if (!match) {
      const start = sourceLocationAt(this.#source, 0);
      return { start, end: start };
    }
    match.used = true;
    return {
      start: sourceLocationAt(this.#source, match.start),
      end: sourceLocationAt(this.#source, match.end),
    };
  }
}

function sourceLocationAt(source: string, offset: number): SourceLocation {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
