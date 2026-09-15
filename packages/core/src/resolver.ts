import { proseWidthDiagnostics } from "./prose-width.ts";
import {
  compareScalarText,
  diagnostic,
  orderDiagnostics,
} from "./diagnostics.ts";
import type {
  DiagnosticLocation,
  SigilDiagnostic,
  SigilDiagnosticCode,
} from "./model/diagnostics.ts";
import { tagIdentity } from "./model/identity.ts";
import type { SigilSectionName } from "./model/language.ts";
import type {
  AccessibleTag,
  ResolvedComponent,
  ResolvedImport,
  ResolvedImportName,
  ResolvedTag,
  ResolvedTagReference,
  SigilResolution,
  TagIntroduction,
} from "./model/resolution.ts";
import { sourceOccurrenceId } from "./model/source.ts";
import type { ComponentDeclaration, TagGroup } from "./model/source.ts";
import type { SigilWorkspace } from "./model/workspace.ts";
import { joinPath, normalizeImportPath, normalizePath } from "./path.ts";
import { matchTagReferences } from "./tag-matching.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type SelectionDraft =
  & Omit<Mutable<ResolvedImportName>, "uses" | "ambiguousIn">
  & {
    uses: ResolvedImportName["uses"][number][];
    ambiguousIn: string[];
  };
type ImportDraft = Omit<Mutable<ResolvedImport>, "names"> & {
  names: SelectionDraft[];
};
type ComponentDraft =
  & Omit<Mutable<ResolvedComponent>, "accessibleTags" | "references">
  & {
    accessibleTags: AccessibleTag[];
    references: ResolvedTagReference[];
  };

function bucket<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item), group = map.get(name) ?? [];
    group.push(item);
    map.set(name, group);
  }
  return map;
}

function introductions(
  filePath: string,
  component: ComponentDeclaration,
): TagIntroduction[] {
  const result: TagIntroduction[] = [];
  for (const section of component.sections) {
    if (!section.known) continue;
    const groups = new Map<string, TagGroup>();
    const collect = (group: TagGroup) => {
      groups.set(group.id, group);
      result.push({
        id: group.id,
        kind: "group",
        name: group.name,
        componentId: component.id,
        filePath,
        sectionName: section.name as SigilSectionName,
        groupId: group.id,
        range: group.headerRange,
        nameRange: group.nameRange,
        valid: group.valid,
        complete: group.complete,
      });
      for (const child of group.groups) collect(child);
    };
    for (const group of section.groups) collect(group);
    for (const facet of section.units) {
      for (const definition of facet.definitions) {
        result.push({
          id: sourceOccurrenceId(
            filePath,
            "definition",
            definition.range.start,
          ),
          kind: "inline",
          name: definition.name,
          componentId: component.id,
          filePath,
          sectionName: facet.sectionName,
          facetId: facet.id,
          range: definition.range,
          nameRange: definition.nameRange,
          valid: definition.valid &&
            (!facet.groupingId || groups.get(facet.groupingId)?.valid === true),
          complete: true,
        });
      }
    }
  }
  return result.sort((a, b) => a.range.start - b.range.start);
}

// @sigil implements packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
export function resolveSigilRelationships(
  workspace: SigilWorkspace,
): SigilResolution {
  const diagnostics: SigilDiagnostic[] = workspace.diagnostics.filter((d) =>
    d.code !== "SIGIL_LINE_TOO_LONG" && d.code !== "SIGIL_UNFORMATTABLE_LINE"
  );
  const conflict = (
    code: SigilDiagnosticCode,
    message: string,
    places: readonly DiagnosticLocation[],
  ) => {
    if (!places.length) return;
    const sorted = [...places].sort((a, b) =>
      compareScalarText(a.filePath ?? "", b.filePath ?? "") ||
      (a.range?.start ?? -1) - (b.range?.start ?? -1) ||
      (a.range?.end ?? -1) - (b.range?.end ?? -1)
    );
    diagnostics.push(
      diagnostic(code, message, { ...sorted[0], related: sorted.slice(1) }),
    );
  };
  const files = [...workspace.files].sort((a, b) =>
    compareScalarText(a.path, b.path)
  );
  const documents = new Map(
    files.map((f) => [normalizePath(f.path), f.document]),
  );
  const components: ComponentDraft[] = files.flatMap((file) =>
    file.document.components.map((declaration) => ({
      id: declaration.id,
      name: declaration.name,
      declaration,
      filePath: file.path,
      tags: [],
      accessibleTags: [],
      references: [],
    }))
  );
  const componentNames = bucket(components, (c) => c.name);
  for (const [name, copies] of componentNames) {
    if (copies.length > 1) {
      conflict(
        "SIGIL_DUPLICATE_COMPONENT",
        `Component ${name} has multiple declarations.`,
        copies.map((c) => ({
          filePath: c.filePath,
          range: c.declaration.nameRange,
        })),
      );
    } else {copies[0].identity = {
        componentName: name,
        declarationPath: copies[0].filePath,
      };}
  }
  for (const component of components) {
    component.tags = [
      ...bucket(
        introductions(component.filePath, component.declaration),
        (i) => i.name,
      ),
    ]
      .sort(([a], [b]) => compareScalarText(a, b)).map(
        ([name, occurrences]): ResolvedTag => {
          const definitions = occurrences.filter((i) =>
            i.kind === "inline" && i.valid
          );
          const valid = occurrences.some((i) => i.valid && i.complete);
          const duplicate = definitions.length > 1;
          if (duplicate) {
            conflict(
              "SIGIL_DUPLICATE_TAG_DEFINITION",
              `Tag ${JSON.stringify(name)} has multiple inline definitions.`,
              definitions.map((i) => ({
                filePath: i.filePath,
                range: i.range,
              })),
            );
          }
          const status = !component.identity || duplicate
            ? "ambiguous"
            : valid
            ? "resolved"
            : "invalid";
          return {
            name,
            status,
            introductions: occurrences,
            identity: status === "resolved"
              ? tagIdentity(component.identity!, name)
              : undefined,
          };
        },
      );
  }
  const imports: ImportDraft[] = [];
  for (const file of files) {
    for (const declaration of file.document.imports) {
      const item: ImportDraft = {
        id: sourceOccurrenceId(file.path, "import", declaration.range.start),
        declaration,
        sourceFile: file.path,
        status: "resolved",
        names: declaration.selections.map((selection) => ({
          id: sourceOccurrenceId(file.path, "selection", selection.range.start),
          name: selection.name,
          selection,
          status: selection.valid ? "unresolved" : "invalid",
          ambiguousIn: [],
          used: false,
          uses: [],
        })),
      };
      imports.push(item);
      // A complete prefix and individual valid selections survive list recovery.
      const relativeTarget = normalizeImportPath(declaration.path);
      const target = relativeTarget === undefined
        ? undefined
        : joinPath(workspace.root, relativeTarget);
      const document = target === undefined ? undefined : documents.get(target);
      if (!document?.source) {
        item.status = "unresolved-path";
        diagnostics.push(
          diagnostic(
            "SIGIL_UNRESOLVED_IMPORT_PATH",
            `Import ${
              JSON.stringify(declaration.path)
            } does not select an included readable source.`,
            { filePath: file.path, range: declaration.pathRange },
          ),
        );
        continue;
      }
      item.targetFile = target;
      const providers = componentNames.get(declaration.provider) ?? [];
      const provider =
        providers.length === 1 && providers[0].filePath === target
          ? providers[0]
          : undefined;
      if (!provider?.identity) {
        item.status = "unresolved-provider";
        // Missing content cannot establish an absence; known ambiguity remains an error.
        if (document.complete || providers.length > 1) {
          diagnostics.push(diagnostic(
            "SIGIL_UNRESOLVED_IMPORTED_COMPONENT",
            `Source ${target} does not supply an unambiguous component ${declaration.provider}.`,
            {
              filePath: file.path,
              range: declaration.providerRange,
              related: providers.filter((p) =>
                providers.length > 1 || p.filePath === target
              ).map((p) => ({
                filePath: p.filePath,
                range: p.declaration.nameRange,
              })),
            },
          ));
        }
        continue;
      }
      item.providerId = provider.id;
      for (const selection of item.names) {
        if (selection.status === "invalid") continue;
        const tag = provider.tags.find((t) => t.name === selection.name);
        if (tag?.status !== "resolved") {
          if (tag || provider.declaration.complete) {
            diagnostics.push(
              diagnostic(
                "SIGIL_UNRESOLVED_IMPORTED_TAG",
                `Component ${provider.name} does not own an unambiguous Tag ${
                  JSON.stringify(selection.name)
                }.`,
                {
                  filePath: file.path,
                  range: selection.selection.range,
                  related: tag?.introductions.map((i) => ({
                    filePath: i.filePath,
                    range: i.range,
                  })) ?? [],
                },
              ),
            );
          }
          continue;
        }
        selection.tag = tag;
        selection.status = "resolved";
      }
    }
  }
  const importsByFile = bucket(imports, (i) => i.sourceFile);
  const componentsByFile = bucket(components, (c) => c.filePath);
  for (const [filePath, fileImports] of importsByFile) {
    const selections = fileImports.flatMap((i) => i.names);
    const selected = selections.filter((s) => s.status === "resolved");
    for (
      const duplicates of bucket(selected, (s) => s.tag!.identity!.id).values()
    ) {
      if (duplicates.length < 2) continue;
      for (const selection of duplicates) selection.status = "duplicate";
      conflict(
        "SIGIL_DUPLICATE_TAG_IMPORT",
        `Tag ${JSON.stringify(duplicates[0].name)} is selected more than once.`,
        duplicates.map((s) => ({ filePath, range: s.selection.range })),
      );
    }
    const byName = bucket(selected, (s) => s.name);
    for (const sameName of byName.values()) {
      if (new Set(sameName.map((s) => s.tag!.identity!.id)).size < 2) continue;
      for (const selection of sameName) {
        if (selection.status !== "duplicate") selection.status = "ambiguous";
      }
      conflict(
        "SIGIL_TAG_NAME_COLLISION",
        `Different selected identities share the name ${
          JSON.stringify(sameName[0].name)
        }.`,
        sameName.map((s) => ({ filePath, range: s.selection.range })),
      );
    }
    for (const component of componentsByFile.get(filePath) ?? []) {
      setVocabulary(component, byName);
    }
  }
  // Sources without imports still have a complete local vocabulary.
  for (const component of components) {
    const fileImports = importsByFile.get(component.filePath) ?? [];
    if (!fileImports.length) {
      setVocabulary(component, new Map());
    }
    const document = documents.get(component.filePath)!;
    if (!document.source) continue;
    const vocabulary = new Map(
      component.accessibleTags.map((t) => [t.name, t]),
    );
    const selected = fileImports.flatMap((i) => i.names);
    for (const section of component.declaration.sections) {
      for (const facet of section.units) {
        for (
          const match of matchTagReferences(document.source, facet.eligible, [
            ...vocabulary.keys(),
          ])
        ) {
          const accessible = vocabulary.get(match.name)!;
          const reference: ResolvedTagReference = {
            ...match,
            id: sourceOccurrenceId(
              component.filePath,
              "reference",
              match.range.start,
            ),
            status: accessible.status,
            tagIdentity: accessible.tag?.identity,
            componentId: component.id,
            facetId: facet.id,
            filePath: component.filePath,
            sectionName: facet.sectionName,
          };
          component.references.push(reference);
          if (reference.status !== "resolved") continue;
          for (
            const selection of selected.filter((s) =>
              accessible.selectionIds.includes(s.id) && s.status === "resolved"
            )
          ) {
            selection.used = true;
            selection.uses.push({
              kind: "tag-reference",
              referenceId: reference.id,
              componentId: component.id,
              facetId: facet.id,
              filePath: component.filePath,
              ownerName: component.name,
              sectionName: facet.sectionName,
              range: match.range,
            });
          }
        }
      }
    }
  }
  for (const item of imports) {
    for (const selection of item.names) {
      if (
        selection.status === "resolved" && !selection.used &&
        !selection.ambiguousIn.length &&
        documents.get(item.sourceFile)!.complete
      ) {
        diagnostics.push(
          diagnostic(
            "SIGIL_UNUSED_TAG_IMPORT",
            `Selected Tag ${
              JSON.stringify(selection.name)
            } has no eligible bare reference.`,
            { filePath: item.sourceFile, range: selection.selection.range },
          ),
        );
      }
    }
  }
  for (const file of files) {
    if (!file.document.source) continue;
    const local = componentsByFile.get(file.path) ?? [];
    diagnostics.push(
      ...proseWidthDiagnostics(
        file.path,
        file.document.source,
        local.flatMap((c) => c.declaration.sections.flatMap((s) => s.units)),
        local.flatMap((c) => c.references),
      ),
    );
  }
  return {
    workspace,
    imports,
    components,
    diagnostics: orderDiagnostics(diagnostics),
  };

  function setVocabulary(
    component: ComponentDraft,
    selections: Map<string, SelectionDraft[]>,
  ) {
    const locals = new Map(component.tags.map((t) => [t.name, t]));
    const names = [...new Set([...locals.keys(), ...selections.keys()])].sort(
      compareScalarText,
    );
    component.accessibleTags = names.flatMap((name) => {
      const local = locals.get(name), selected = selections.get(name) ?? [];
      // Invalid headings are evidence, not declarations. Duplicate inline definitions
      // are ambiguous local declarations and cannot be rescued by another heading.
      const localDeclaration = local && local.status !== "invalid"
        ? local
        : undefined;
      const collision = localDeclaration !== undefined && selected.length > 0;
      if (collision) {
        for (const selection of selected) {
          selection.ambiguousIn.push(component.id);
        }
        conflict(
          "SIGIL_TAG_NAME_COLLISION",
          `Local and selected Tags share ${
            JSON.stringify(name)
          } in ${component.name}.`,
          [
            ...localDeclaration.introductions.filter((i) => i.valid).map(
              (i) => ({ filePath: i.filePath, range: i.range }),
            ),
            ...selected.map((s) => ({
              filePath: component.filePath,
              range: s.selection.range,
            })),
          ],
        );
      }
      const candidates = [
        ...(localDeclaration ? [localDeclaration] : []),
        ...selected.map((s) => s.tag!),
      ];
      if (!candidates.length) return [];
      const resolved = !collision &&
        (localDeclaration
          ? localDeclaration.status === "resolved"
          : selected.length === 1 && selected[0].status === "resolved");
      return [{
        name,
        status: resolved ? "resolved" as const : "ambiguous" as const,
        tag: resolved ? candidates[0] : undefined,
        candidates,
        selectionIds: selected.map((s) => s.id),
      }];
    });
  }
}
