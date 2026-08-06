import { diagnostic } from "./diagnostics.ts";
import { normalizePath } from "./path.ts";
import type {
  ComponentIdentity,
  ImplementationArtifactKind,
  ImplementationRelation,
  ImplementationSection,
  ImplementationSource,
  OwnedImplementationProjection,
  OwnedImplementationTarget,
  ResolvedComponent,
  ResolvedSigilWorkspace,
  SigilDiagnostic,
  SourceRange,
} from "./model.ts";

const IMPLEMENTATION_RELATIONS: ReadonlySet<ImplementationRelation> = new Set([
  "implements",
  "uses",
  "tests",
]);
const IMPLEMENTATION_SECTIONS: ReadonlySet<ImplementationSection> = new Set([
  "interface",
  "state",
  "logic",
  "constraints",
  "cases",
]);

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown"];
const HASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".sh", ".bash", ".zsh"]);
const SLASH_COMMENT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".cxx",
  ".dart",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".rs",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
]);
const SUPPORTED_IMPLEMENTATION_SOURCE_GLOB_PATTERNS = Object.freeze([
  ...MARKDOWN_EXTENSIONS,
  ...HASH_COMMENT_EXTENSIONS,
  ...SLASH_COMMENT_EXTENSIONS,
].map((extension) => `**/*${extension}`));

interface ParsedAnnotation {
  readonly relation: ImplementationRelation;
  readonly sigilPath: string;
  readonly componentName: string;
  readonly conceptName?: string;
  readonly sectionNames: readonly string[];
}

interface CommentBlock {
  readonly kind: "line" | "multiline" | "markdown";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface Entrypoint {
  readonly identity: string;
  readonly range: SourceRange;
}

interface EntrypointMatch {
  readonly name: string;
  readonly offset: number;
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::OwnedImplementationLookup interface,logic,constraints,cases
export function ownedImplementationTargetsFor(
  resolved: ResolvedSigilWorkspace,
  implementationSources: readonly ImplementationSource[],
  componentIdentity: ComponentIdentity | string,
  conceptName?: string,
  sectionName?: ImplementationSection,
): OwnedImplementationProjection | undefined {
  const componentName = typeof componentIdentity === "string"
    ? componentIdentity
    : componentIdentity.componentName;
  const owningComponent = resolved.components.find((component) =>
    component.name === componentName &&
    (typeof componentIdentity === "string" ||
      component.filePath === componentIdentity.declarationPath)
  );
  if (!owningComponent) return undefined;

  const concept = conceptName
    ? owningComponent.conceptNamespace.concepts.find((item) =>
      item.identifier === conceptName
    )
    : undefined;
  if (conceptName && !concept) return undefined;

  const diagnostics: SigilDiagnostic[] = [];
  const targets: OwnedImplementationTarget[] = [];
  const seen = new Set<string>();

  for (const source of implementationSources) {
    const normalizedSource = {
      filePath: normalizePath(source.filePath),
      text: source.text,
    };
    if (!isSupportedImplementationSource(normalizedSource.filePath)) continue;
    for (
      const result of implementationAnnotations(
        resolved,
        normalizedSource,
        diagnostics,
      )
    ) {
      if (
        result.annotation.componentName !== componentName ||
        (conceptName !== undefined &&
          result.annotation.conceptName !== conceptName) ||
        (sectionName !== undefined &&
          !result.target.sections.includes(sectionName))
      ) continue;
      if (
        !componentMatchesSigilPath(
          resolved,
          owningComponent,
          result.annotation.sigilPath,
        )
      ) continue;
      const key = `${result.target.relation}\0${result.target.filePath}\0${
        result.target.symbolIdentity ?? ""
      }\0${result.target.sections.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(result.target);
    }
  }

  targets.sort((left, right) =>
    left.filePath.localeCompare(right.filePath) ||
    (left.symbolIdentity ?? "").localeCompare(right.symbolIdentity ?? "") ||
    left.relation.localeCompare(right.relation) ||
    left.sections.join(",").localeCompare(right.sections.join(","))
  );

  return {
    owningComponent,
    concept,
    sectionName,
    targets,
    diagnostics,
  };
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport interface,cases
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationTargetScope constraints
 */
export function isSupportedImplementationSource(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  if (normalized.endsWith(".sigil") || normalized.endsWith(".json")) {
    return false;
  }
  const extension = fileExtension(normalized);
  return MARKDOWN_EXTENSIONS.includes(extension) ||
    HASH_COMMENT_EXTENSIONS.has(extension) ||
    SLASH_COMMENT_EXTENSIONS.has(extension);
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationSourceSupport interface,cases
export function supportedImplementationSourceGlobPatterns(): readonly string[] {
  return SUPPORTED_IMPLEMENTATION_SOURCE_GLOB_PATTERNS;
}

function implementationAnnotations(
  resolved: ResolvedSigilWorkspace,
  source: ImplementationSource,
  diagnostics: SigilDiagnostic[],
): readonly {
  readonly annotation: ParsedAnnotation;
  readonly target: OwnedImplementationTarget;
}[] {
  const results: {
    annotation: ParsedAnnotation;
    target: OwnedImplementationTarget;
  }[] = [];
  const markdown = isMarkdown(source.filePath);
  for (const comment of commentBlocks(source)) {
    const annotationLines = normalizedCommentLines(comment)
      .filter((line) => line.includes("@sigil"));
    if (annotationLines.length === 0) continue;
    if (
      !markdown &&
      ((comment.kind === "line" &&
        annotationLines.length !== 1 &&
        !HASH_COMMENT_EXTENSIONS.has(fileExtension(source.filePath))) ||
        (comment.kind === "multiline" && annotationLines.length < 2))
    ) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Use one line comment for one ownership annotation and one multiline comment for multiple annotations.",
      ));
      continue;
    }

    const parsed = annotationLines.map(parseImplementationAnnotation);
    if (parsed.some((annotation) => annotation === undefined)) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Unable to parse implementation ownership annotation.",
      ));
      continue;
    }

    const entrypoint = markdown
      ? undefined
      : entrypointAfter(source, comment.end);
    if (!markdown && !entrypoint) {
      diagnostics.push(annotationDiagnostic(
        source,
        comment,
        "Implementation ownership annotation is not adjacent to a supported entrypoint definition.",
      ));
      continue;
    }

    for (const annotation of parsed as ParsedAnnotation[]) {
      const resolvedTarget = resolveAnnotationTarget(resolved, annotation);
      if (resolvedTarget) {
        diagnostics.push(annotationDiagnostic(
          source,
          comment,
          resolvedTarget,
        ));
        continue;
      }
      results.push({
        annotation,
        target: {
          relation: annotation.relation,
          artifactKind: inferArtifactKind(source.filePath, annotation.relation),
          filePath: relativeToWorkspace(resolved, source.filePath),
          sections: annotation.sectionNames as readonly ImplementationSection[],
          symbolIdentity: entrypoint?.identity,
          range: entrypoint?.range,
          targetRange: entrypoint?.range,
          annotationRange: rangeForOffsets(
            source.text,
            comment.start,
            comment.end,
          ),
        },
      });
    }
  }
  return results;
}

function parseImplementationAnnotation(
  line: string,
): ParsedAnnotation | undefined {
  const match = line.trim().match(
    /^@sigil\s+(implements|uses|tests)\s+(\S+)\s+(\S+)\s*$/i,
  );
  if (!match) return undefined;
  const relation = match[1].toLowerCase() as ImplementationRelation;
  if (!IMPLEMENTATION_RELATIONS.has(relation)) return undefined;
  const parts = match[2].split("::");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part)) {
    return undefined;
  }
  const sigilPath = normalizePath(parts[0]);
  if (!sigilPath.endsWith(".sigil")) return undefined;
  return {
    relation,
    sigilPath,
    componentName: parts[1],
    conceptName: parts[2],
    sectionNames: match[3].split(",").map((section) => section.toLowerCase()),
  };
}

/*
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::ImplementationAnnotation interface
 * @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::TargetResolution constraints,cases
 */
function resolveAnnotationTarget(
  resolved: ResolvedSigilWorkspace,
  annotation: ParsedAnnotation,
): string | undefined {
  const component = resolved.components.find((item) =>
    item.name === annotation.componentName &&
    componentMatchesSigilPath(resolved, item, annotation.sigilPath)
  );
  if (!component) {
    return `Ownership annotation references unknown Sigil component ${annotation.componentName} in ${annotation.sigilPath}.`;
  }
  if (
    annotation.conceptName &&
    !component.conceptNamespace.concepts.some((concept) =>
      concept.identifier === annotation.conceptName
    )
  ) {
    return `Ownership annotation references unknown concept ${annotation.conceptName} on ${annotation.componentName}.`;
  }
  if (
    annotation.sectionNames.length === 0 ||
    annotation.sectionNames.some((section) => section.length === 0)
  ) {
    return "Ownership annotation requires one or more section selectors.";
  }
  const repeatedSection = annotation.sectionNames.find((section, index) =>
    annotation.sectionNames.indexOf(section) !== index
  );
  if (repeatedSection) {
    return `Ownership annotation repeats section selector ${repeatedSection}.`;
  }
  const unsupportedSection = annotation.sectionNames.find((section) =>
    !IMPLEMENTATION_SECTIONS.has(section as ImplementationSection)
  );
  if (unsupportedSection) {
    return `Ownership annotation uses unsupported section selector ${unsupportedSection}.`;
  }
  const availableSections = annotation.conceptName
    ? component.conceptNamespace.concepts
      .find((concept) => concept.identifier === annotation.conceptName)
      ?.occurrences.map((occurrence) => occurrence.sectionName) ?? []
    : [
      ...component.declaration.sections.map((section) => section.name),
      ...component.expansions.expands.flatMap((expansion) =>
        expansion.declaration.sections.map((section) => section.name)
      ),
    ];
  const unresolvedSection = annotation.sectionNames.find((section) =>
    !availableSections.includes(section as ImplementationSection)
  );
  if (unresolvedSection) {
    const target = annotation.conceptName
      ? `concept ${annotation.conceptName} on ${annotation.componentName}`
      : `component ${annotation.componentName}`;
    return `Ownership annotation references section ${unresolvedSection} without a matching occurrence on ${target}.`;
  }
  return undefined;
}

function componentMatchesSigilPath(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
  sigilPath: string,
): boolean {
  return [
    component.filePath,
    ...component.expansions.expands.map((expansion) => expansion.filePath),
  ].some((filePath) => relativeToWorkspace(resolved, filePath) === sigilPath);
}

function commentBlocks(source: ImplementationSource): readonly CommentBlock[] {
  const extension = fileExtension(source.filePath.toLowerCase());
  if (MARKDOWN_EXTENSIONS.includes(extension)) {
    return markdownCommentBlocks(source.text);
  }
  if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    return hashCommentBlocks(source.text);
  }
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) {
    return slashCommentBlocks(source.text);
  }
  return [];
}

function markdownCommentBlocks(source: string): CommentBlock[] {
  const fencedRanges: { start: number; end: number }[] = [];
  let fenceStart: number | undefined;
  let fenceMarker: string | undefined;
  let offset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (fenceStart === undefined) {
        fenceStart = offset;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        fencedRanges.push({ start: fenceStart, end: offset + line.length });
        fenceStart = undefined;
        fenceMarker = undefined;
      }
    }
    offset += line.length;
  }
  if (fenceStart !== undefined) {
    fencedRanges.push({ start: fenceStart, end: source.length });
  }
  return [...source.matchAll(/<!--[\s\S]*?-->/g)]
    .map((match) => ({
      kind: "markdown" as const,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter((comment) =>
      !fencedRanges.some((range) =>
        comment.start >= range.start && comment.start < range.end
      )
    );
}

function slashCommentBlocks(source: string): CommentBlock[] {
  const comments: CommentBlock[] = [];
  let index = 0;
  let quote: "'" | '"' | "`" | undefined;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      index++;
      continue;
    }
    if (char === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    if (char === "/" && next === "*") {
      const start = index;
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      comments.push({
        kind: "multiline",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    index++;
  }
  return mergeAdjacentLineComments(source, comments);
}

function hashCommentBlocks(source: string): CommentBlock[] {
  const comments: CommentBlock[] = [];
  let index = 0;
  let quote: "'" | '"' | undefined;
  let triple: "'''" | '"""' | undefined;
  while (index < source.length) {
    if (triple) {
      if (source.startsWith(triple, index)) {
        index += 3;
        triple = undefined;
      } else {
        index++;
      }
      continue;
    }
    const tripleStart = source.slice(index, index + 3);
    if (!quote && tripleStart === "'''") {
      triple = "'''";
      index += 3;
      continue;
    }
    if (!quote && tripleStart === '"""') {
      triple = '"""';
      index += 3;
      continue;
    }
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      index++;
      continue;
    }
    if (char === "#") {
      const start = index;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      comments.push({
        kind: "line",
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }
    index++;
  }
  return mergeAdjacentLineComments(source, comments);
}

function mergeAdjacentLineComments(
  source: string,
  comments: readonly CommentBlock[],
): CommentBlock[] {
  const merged: CommentBlock[] = [];
  for (const comment of comments) {
    const previous = merged.at(-1);
    const gap = previous ? source.slice(previous.end, comment.start) : "";
    if (
      previous?.kind === "line" &&
      comment.kind === "line" &&
      /^\s*$/.test(gap) &&
      (gap.match(/\n/g)?.length ?? 0) <= 1
    ) {
      merged[merged.length - 1] = {
        kind: "line",
        text: source.slice(previous.start, comment.end),
        start: previous.start,
        end: comment.end,
      };
    } else {
      merged.push(comment);
    }
  }
  return merged;
}

function normalizedCommentLines(comment: CommentBlock): string[] {
  return comment.text
    .replace(/^<!--|-->$/g, "")
    .replace(/^\/\*|\*\/$/g, "")
    .split(/\r?\n/)
    .map((line) =>
      line.trim()
        .replace(/^\/\/\s?/, "")
        .replace(/^\#\s?/, "")
        .replace(/^\*\s?/, "")
        .trim()
    )
    .filter(Boolean);
}

function entrypointAfter(
  source: ImplementationSource,
  offset: number,
): Entrypoint | undefined {
  const rest = source.text.slice(offset);
  const extension = fileExtension(source.filePath.toLowerCase());
  const match = entrypointMatch(rest, extension);
  if (!match) return undefined;
  const start = offset + match.offset;
  return {
    identity: match.name,
    range: rangeForOffsets(
      source.text,
      start,
      start + match.name.length,
    ),
  };
}

// @sigil implements packages/core/src/implementation-ownership.sigil::SigilImplementationOwnership::AnnotationPlacement constraints
function entrypointMatch(
  source: string,
  extension: string,
): EntrypointMatch | undefined {
  let patterns: readonly RegExp[];
  let matchSource = source;
  let matchOffset = 0;
  if ([".sh", ".bash", ".zsh"].includes(extension)) {
    patterns = [
      /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*\{/,
    ];
  } else if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    patterns = [
      /^\s*(?:@[A-Za-z_][\w.]*(?:\([^\r\n]*\))?\s*)*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".rs") {
    patterns = [
      /^\s*(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|trait|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".go") {
    patterns = [
      /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
      /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
    ];
  } else if (extension === ".swift") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|fileprivate|internal|open|final|static|mutating|nonmutating|override|async)\s+)*(?:func|class|struct|protocol|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".kt" || extension === ".kts") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|open|final|abstract|override|suspend|inline|data|sealed)\s+)*(?:fun|class|interface|object|struct|enum\s+class)\s+([A-Za-z_]\w*)/,
    ];
  } else if (extension === ".scala") {
    patterns = [
      /^\s*(?:(?:@\w+(?:\([^)]*\))?|private|protected|final|sealed|abstract|override|implicit|lazy)\s+)*(?:def|class|trait|object|enum)\s+([A-Za-z_]\w*)/,
    ];
  } else if (
    [".c", ".cc", ".cpp", ".cs", ".cxx", ".dart", ".h", ".hpp", ".java"]
      .includes(extension)
  ) {
    const isCpp = [".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(
      extension,
    );
    if (isCpp) {
      const templateEnd = cppTemplatePrefixEnd(source);
      if (templateEnd === undefined) return undefined;
      matchSource = source.slice(templateEnd);
      matchOffset = templateEnd;
    }
    const modifier = String
      .raw`(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|static|final|sealed|abstract|virtual|override|async|extern|inline|constexpr|unsafe|partial)\s+)*`;
    const requiresPrefix = isCpp
      ? String.raw`(?:requires\b(?:[^;{}]|\{[^{}]*\})*?\s+)?`
      : "";
    const modifiers = String
      .raw`^\s*${modifier}${requiresPrefix}${modifier}`;
    patterns = [
      new RegExp(
        `${modifiers}(?:class|interface|struct|enum|record)\\s+([A-Za-z_]\\w*)`,
      ),
      new RegExp(
        `${modifiers}(?:[A-Za-z_]\\w*(?:[<>,.?\\[\\]:*&]\\s*|\\s+))+([A-Za-z_]\\w*)\\s*\\(`,
      ),
    ];
  } else {
    const prefix = String
      .raw`^\s*(?:(?:@[A-Za-z_$][\w$]*(?:\([^\r\n]*\))?|#\[[^\]]+\])\s*)*(?:(?:export|default|declare|abstract|public|protected|private|static|final|sealed|partial|override|readonly|async|unsafe|extern)\s+)*`;
    patterns = [
      /^\s*(?:test|it|describe|suite)(?:\.(?:only|skip|todo))?\s*\(\s*["'`]([^"'`]+)["'`]/,
      new RegExp(
        `${prefix}(?:class|interface|struct|trait|enum|function)\\s+\\*?\\s*([A-Za-z_$][\\w$]*)`,
      ),
      new RegExp(
        `${prefix}(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
      ),
      new RegExp(
        `${prefix}(?:(?:get|set|async)\\s+)*([A-Za-z_$][\\w$]*)\\s*(?:<[^>{}]*>)?\\s*\\(`,
      ),
      /^\s*Deno\.test\(\s*["'`]([^"'`]+)["'`]/,
    ];
  }
  for (const pattern of patterns) {
    const match = matchSource.match(pattern);
    const name = match?.[1];
    if (!match || !name) continue;
    return {
      name,
      offset: matchOffset + (match.index ?? 0) + match[0].lastIndexOf(name),
    };
  }
  return undefined;
}

function cppTemplatePrefixEnd(source: string): number | undefined {
  let offset = skipWhitespace(source, 0);
  let foundTemplate = false;
  while (
    source.startsWith("template", offset) &&
    !isIdentifierCharacter(source[offset + "template".length])
  ) {
    foundTemplate = true;
    offset = skipWhitespace(source, offset + "template".length);
    if (source[offset] !== "<") return undefined;
    let depth = 0;
    let quote: '"' | "'" | undefined;
    let closed = false;
    for (; offset < source.length; offset++) {
      const character = source[offset];
      if (quote) {
        if (character === "\\") {
          offset++;
        } else if (character === quote) {
          quote = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "<") {
        depth++;
      } else if (character === ">") {
        depth--;
        if (depth === 0) {
          offset++;
          closed = true;
          break;
        }
      }
    }
    if (!closed) return undefined;
    offset = skipWhitespace(source, offset);
  }
  return foundTemplate ? offset : 0;
}

function skipWhitespace(source: string, offset: number): number {
  while (offset < source.length && /\s/.test(source[offset])) offset++;
  return offset;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function annotationDiagnostic(
  source: ImplementationSource,
  comment: CommentBlock,
  message: string,
): SigilDiagnostic {
  return diagnostic("SIGIL_PARSE_STRUCTURE", message, {
    filePath: source.filePath,
    range: rangeForOffsets(source.text, comment.start, comment.end),
  });
}

function rangeForOffsets(
  source: string,
  start: number,
  end: number,
): SourceRange {
  return { start: positionAt(source, start), end: positionAt(source, end) };
}

function positionAt(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const prefix = source.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function relativeToWorkspace(
  resolved: ResolvedSigilWorkspace,
  filePath: string,
): string {
  const root = normalizePath(resolved.workspace.root);
  const normalized = normalizePath(filePath);
  if (root === ".") return normalized;
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(fileExtension(filePath.toLowerCase()));
}

function fileExtension(filePath: string): string {
  const basename = normalizePath(filePath).split("/").at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index < 0 ? "" : basename.slice(index);
}

function inferArtifactKind(
  filePath: string,
  relation: ImplementationRelation,
): ImplementationArtifactKind {
  const normalized = normalizePath(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return "markdown";
  }
  if (relation === "tests") return "test";
  return "code";
}
