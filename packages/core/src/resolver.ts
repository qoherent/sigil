import { diagnostic } from "./diagnostics.ts";
import type {
  CollectedExpansion,
  ComponentDeclaration,
  ConceptIdentity,
  ExpandDeclaration,
  ImportUse,
  ResolvedComponent,
  ResolvedConcept,
  ResolvedConceptNamespace,
  ResolvedConceptOccurrence,
  ResolvedConceptReference,
  ResolvedImport,
  SemanticUnit,
  SigilDiagnostic,
  SigilResolution,
  SigilWorkspace,
} from "./model.ts";
import { isModuleFile, joinPath, normalizePath } from "./path.ts";

interface IndexedComponent {
  readonly filePath: string;
  readonly declaration: ComponentDeclaration;
}

interface IndexedExpand {
  readonly filePath: string;
  readonly declaration: ExpandDeclaration;
}

interface MutableResolvedImport extends Omit<ResolvedImport, "names"> {
  names: MutableResolvedImportName[];
}

interface MutableResolvedImportName {
  name: string;
  component?: ComponentDeclaration;
  componentFile?: string;
  used: boolean;
  uses: ImportUse[];
}

interface ComponentResolutionDraft {
  readonly name: string;
  readonly declaration: ComponentDeclaration;
  readonly filePath: string;
  readonly expansions: CollectedExpansion;
}

interface LocalConceptGroup {
  readonly identifier: string;
  readonly normalizedIdentifier: string;
  readonly identity: ConceptIdentity;
  readonly occurrences: readonly ResolvedConceptOccurrence[];
  readonly isPublic: boolean;
}

interface NamespaceState {
  readonly component: ComponentResolutionDraft;
  readonly groups: readonly LocalConceptGroup[];
  namespace: ResolvedConceptNamespace;
}

// @sigil implements packages/core/src/resolver.sigil::SigilResolver::RelationshipResolution interface,logic,constraints,cases
export function resolveSigilRelationships(
  workspace: SigilWorkspace,
): SigilResolution {
  const diagnostics: SigilDiagnostic[] = [...workspace.diagnostics];
  const componentsByName = new Map<string, IndexedComponent[]>();
  const expandsByName = new Map<string, IndexedExpand[]>();
  const documentByPath = new Map(
    workspace.files.map((file) => [normalizePath(file.path), file.document]),
  );

  for (const file of workspace.files) {
    for (const component of file.document.components) {
      const components = componentsByName.get(component.name) ?? [];
      components.push({ filePath: file.path, declaration: component });
      componentsByName.set(component.name, components);
    }
    for (const expand of file.document.expands) {
      const expands = expandsByName.get(expand.name) ?? [];
      expands.push({ filePath: file.path, declaration: expand });
      expandsByName.set(expand.name, expands);
    }
  }

  for (const [name, components] of componentsByName) {
    if (components.length > 1) {
      for (const component of components) {
        diagnostics.push(diagnostic(
          "SIGIL_DUPLICATE_COMPONENT",
          `Duplicate component ${name} creates ambiguous references.`,
          { filePath: component.filePath, range: component.declaration.range },
        ));
      }
    }
  }
  const duplicateComponentNames = new Set(
    [...componentsByName].filter(([, components]) => components.length > 1)
      .map(([name]) => name),
  );

  const resolvedImports: MutableResolvedImport[] = [];

  for (const file of workspace.files) {
    for (const declaration of file.document.imports) {
      const targetFile = resolveImportPath(workspace.root, declaration.path);
      if (
        importTraversesOutsideWorkspace(declaration.path) ||
        !documentByPath.has(targetFile)
      ) {
        diagnostics.push(diagnostic(
          "SIGIL_UNRESOLVED_IMPORT_PATH",
          `Import path @${declaration.path} did not resolve to an included workspace file (${targetFile}).`,
          { filePath: file.path, range: declaration.range },
        ));
        resolvedImports.push({
          declaration,
          sourceFile: file.path,
          targetFile,
          names: [],
        });
        continue;
      }

      const targetDocument = documentByPath.get(targetFile)!;
      const names: MutableResolvedImportName[] = declaration.names.map(
        (name) => {
          const component = targetDocument.components.find((item) =>
            item.name === name && !duplicateComponentNames.has(name)
          );
          return component
            ? {
              name,
              component,
              componentFile: targetFile,
              used: false,
              uses: [],
            }
            : { name, used: false, uses: [] };
        },
      );

      resolvedImports.push({
        declaration,
        sourceFile: file.path,
        targetFile,
        names,
      });
    }
  }

  resolveModuleIndexNames(resolvedImports);
  resolveImportUses(workspace, resolvedImports, diagnostics);

  for (const [name, expands] of expandsByName) {
    const components = componentsByName.get(name) ?? [];
    for (const expand of expands) {
      if (
        components.some((component) =>
          !duplicateComponentNames.has(name) &&
          expandTargetsComponent(expand, component, resolvedImports)
        )
      ) continue;
      diagnostics.push(diagnostic(
        "SIGIL_EXPAND_WITHOUT_COMPONENT",
        `expand ${name} must declare its matching component locally or import it.`,
        { filePath: expand.filePath, range: expand.declaration.range },
      ));
    }
  }

  for (const item of resolvedImports) {
    if (!documentByPath.has(item.targetFile ?? "")) continue;
    for (const name of item.names) {
      if (name.component) continue;
      diagnostics.push(diagnostic(
        "SIGIL_UNRESOLVED_IMPORTED_COMPONENT",
        `Imported component ${name.name} was not found in ${item.targetFile}.`,
        { filePath: item.sourceFile, range: item.declaration.range },
      ));
    }
  }

  diagnostics.push(...detectImportCycles(resolvedImports));

  const componentDrafts: ComponentResolutionDraft[] = [];
  for (const [name, components] of componentsByName) {
    for (const component of components) {
      const expands = (expandsByName.get(name) ?? []).filter((expand) =>
        !duplicateComponentNames.has(name) &&
        expandTargetsComponent(expand, component, resolvedImports)
      );
      const expansion: CollectedExpansion = {
        componentName: name,
        expands: expands.map((item) => ({
          filePath: item.filePath,
          declaration: item.declaration,
        })),
      };
      componentDrafts.push({
        name,
        declaration: component.declaration,
        filePath: component.filePath,
        expansions: expansion,
      });
    }
  }

  const resolvedByDeclaration = new Map(
    resolveConceptNamespaces(
      componentDrafts.filter((component) =>
        !duplicateComponentNames.has(component.name)
      ),
      resolvedImports,
      diagnostics,
    ).map((component) => [component.declaration, component]),
  );
  const resolvedComponents = componentDrafts.map((component) =>
    resolvedByDeclaration.get(component.declaration) ?? {
      ...component,
      conceptNamespace: emptyConceptNamespace(component.name),
    }
  );

  return {
    workspace,
    imports: resolvedImports,
    components: resolvedComponents,
    diagnostics,
  };
}

function emptyConceptNamespace(
  componentName: string,
): ResolvedConceptNamespace {
  return {
    componentName,
    concepts: [],
    accessibleConcepts: [],
    publicConcepts: [],
    references: [],
  };
}

function expandTargetsComponent(
  expand: IndexedExpand,
  component: IndexedComponent,
  imports: readonly ResolvedImport[],
): boolean {
  if (
    normalizePath(expand.filePath) === normalizePath(component.filePath) &&
    expand.declaration.name === component.declaration.name
  ) return true;

  return imports.some((item) =>
    normalizePath(item.sourceFile) === normalizePath(expand.filePath) &&
    item.names.some((name) =>
      name.name === expand.declaration.name &&
      name.component === component.declaration
    )
  );
}

function resolveConceptNamespaces(
  components: readonly ComponentResolutionDraft[],
  imports: readonly ResolvedImport[],
  diagnostics: SigilDiagnostic[],
): ResolvedComponent[] {
  const states = components.map((component): NamespaceState => {
    const groups = localConceptGroups(component, diagnostics);
    return {
      component,
      groups,
      namespace: {
        componentName: component.name,
        concepts: groups.map((group) => localResolvedConcept(group)),
        accessibleConcepts: groups.map((group) => localResolvedConcept(group)),
        publicConcepts: groups.filter((group) => group.isPublic).map((group) =>
          localResolvedConcept(group, true)
        ),
        references: [],
      },
    };
  });
  const stateByDeclaration = new Map(
    states.map((state) => [state.component.declaration, state]),
  );

  for (let iteration = 0; iteration < states.length + 1; iteration++) {
    let changed = false;
    for (const state of states) {
      const imported = importedPublicConcepts(
        state,
        imports,
        stateByDeclaration,
      );
      const next = buildNamespace(state, imported);
      if (
        namespaceFingerprint(next) !== namespaceFingerprint(state.namespace)
      ) {
        state.namespace = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const state of states) {
    diagnoseConceptAmbiguities(state, diagnostics);
    state.namespace = {
      ...state.namespace,
      references: resolveConceptReferences(state),
    };
  }

  return states.map((state) => ({
    ...state.component,
    conceptNamespace: state.namespace,
  }));
}

function localConceptGroups(
  component: ComponentResolutionDraft,
  diagnostics: SigilDiagnostic[],
): readonly LocalConceptGroup[] {
  const occurrences: ResolvedConceptOccurrence[] = [];
  for (const section of component.declaration.sections) {
    for (const block of section.concepts) {
      occurrences.push({
        componentName: component.name,
        filePath: component.filePath,
        ownerKind: "component",
        sectionName: section.name,
        block,
      });
    }
  }
  for (const expansion of component.expansions.expands) {
    for (const section of expansion.declaration.sections) {
      for (const block of section.concepts) {
        occurrences.push({
          componentName: component.name,
          filePath: expansion.filePath,
          ownerKind: "expand",
          sectionName: section.name,
          block,
        });
      }
    }
  }

  const byNormalized = new Map<string, ResolvedConceptOccurrence[]>();
  for (const occurrence of occurrences) {
    const normalized = normalizeConceptIdentifier(occurrence.block.identifier);
    const grouped = byNormalized.get(normalized) ?? [];
    grouped.push(occurrence);
    byNormalized.set(normalized, grouped);
  }

  const groups: LocalConceptGroup[] = [];
  for (const [normalizedIdentifier, grouped] of byNormalized) {
    const spellings = new Set(grouped.map((item) => item.block.identifier));
    if (spellings.size > 1) {
      for (const occurrence of grouped) {
        diagnostics.push(diagnostic(
          "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER",
          `Concept identifiers ${
            [...spellings].join(", ")
          } differ only by case in component ${component.name}.`,
          { filePath: occurrence.filePath, range: occurrence.block.range },
        ));
      }
    }
    const identifier = grouped[0].block.identifier;
    groups.push({
      identifier,
      normalizedIdentifier,
      identity: {
        identifier,
        normalizedIdentifier,
        componentName: component.name,
        filePath: component.filePath,
      },
      occurrences: grouped,
      isPublic: grouped.some((item) => item.sectionName === "interface"),
    });
  }
  return groups;
}

function importedPublicConcepts(
  state: NamespaceState,
  imports: readonly ResolvedImport[],
  stateByDeclaration: ReadonlyMap<ComponentDeclaration, NamespaceState>,
): readonly ResolvedConcept[] {
  const contextFiles = new Set([
    normalizePath(state.component.filePath),
    ...state.component.expansions.expands.map((item) =>
      normalizePath(item.filePath)
    ),
  ]);
  const concepts: ResolvedConcept[] = [];
  for (const item of imports) {
    if (!contextFiles.has(normalizePath(item.sourceFile))) continue;
    for (const name of item.names) {
      if (!name.component) continue;
      if (name.component === state.component.declaration) continue;
      const importedState = stateByDeclaration.get(name.component);
      if (importedState) {
        concepts.push(...importedState.namespace.publicConcepts);
      }
    }
  }
  return mergeConceptsByIdentity(concepts);
}

function buildNamespace(
  state: NamespaceState,
  imported: readonly ResolvedConcept[],
): ResolvedConceptNamespace {
  const importedByNormalized = groupConceptsByNormalized(imported);
  const local = state.groups.flatMap((group): readonly ResolvedConcept[] => {
    const exactImported = distinctConceptIdentities(
      (importedByNormalized.get(group.normalizedIdentifier) ?? []).filter(
        (concept) => concept.identifier === group.identifier,
      ),
    );
    const importedMatch = exactImported.length === 1
      ? exactImported[0]
      : undefined;
    if (!importedMatch) return [localResolvedConcept(group)];

    const componentOccurrences = group.occurrences.filter((occurrence) =>
      occurrence.ownerKind === "component"
    );
    const expandOccurrences = group.occurrences.filter((occurrence) =>
      occurrence.ownerKind === "expand"
    );
    const concepts: ResolvedConcept[] = [];
    if (componentOccurrences.length > 0) {
      concepts.push({
        identity: group.identity,
        identifier: group.identifier,
        isPublic: componentOccurrences.some((occurrence) =>
          occurrence.sectionName === "interface"
        ),
        isImported: false,
        occurrences: componentOccurrences,
      });
    }
    if (expandOccurrences.length > 0) {
      concepts.push({
        identity: importedMatch.identity,
        identifier: group.identifier,
        isPublic: expandOccurrences.some((occurrence) =>
          occurrence.sectionName === "interface"
        ),
        isImported: true,
        occurrences: expandOccurrences,
      });
    }
    return concepts;
  });

  const accessible = mergeConceptsByIdentity([...imported, ...local]);
  const publicConcepts = local.filter((concept) => concept.isPublic).map(
    (concept) => {
      const inherited = imported.find((candidate) =>
        conceptIdentityKey(candidate.identity) ===
          conceptIdentityKey(concept.identity)
      );
      const publicOccurrences = concept.occurrences.filter((occurrence) =>
        occurrence.sectionName === "interface"
      );
      return {
        ...concept,
        occurrences: mergeOccurrences([
          ...(inherited?.occurrences ?? []),
          ...publicOccurrences,
        ]),
      };
    },
  );

  return {
    componentName: state.component.name,
    concepts: local,
    accessibleConcepts: accessible,
    publicConcepts: mergeConceptsByIdentity(publicConcepts),
    references: [],
  };
}

function resolveConceptReferences(
  state: NamespaceState,
): readonly ResolvedConceptReference[] {
  const concepts = unambiguousAccessibleConcepts(
    state.namespace.accessibleConcepts,
  );
  const references: ResolvedConceptReference[] = [];
  const declarations = [
    state.component.declaration,
    ...state.component.expansions.expands.map((item) => item.declaration),
  ];

  for (const declaration of declarations) {
    for (const section of declaration.sections) {
      for (const line of section.units) {
        const lineReferences = concepts.flatMap((concept) =>
          referenceRanges(line, concept.identifier).map((range) => ({
            conceptIdentity: concept.identity,
            componentName: state.component.name,
            filePath: line.filePath,
            ownerKind: line.ownerKind,
            ownerName: line.ownerName,
            sectionName: line.sectionName,
            range,
          }))
        ).sort((left, right) =>
          left.range.start.column - right.range.start.column
        );
        references.push(...lineReferences);
      }
    }
  }
  return references;
}

function unambiguousAccessibleConcepts(
  concepts: readonly ResolvedConcept[],
): readonly ResolvedConcept[] {
  const grouped = groupConceptsByNormalized(concepts);
  return [...grouped.values()].flatMap((items) => {
    const identities = distinctConceptIdentities(items);
    if (identities.length !== 1) return [];
    const concept = identities[0];
    const spellings = new Set(
      concept.occurrences.map((occurrence) => occurrence.block.identifier),
    );
    return spellings.size === 1 ? [concept] : [];
  });
}

function referenceRanges(
  line: SemanticUnit,
  identifier: string,
): readonly ResolvedConceptReference["range"][] {
  const ranges: ResolvedConceptReference["range"][] = [];
  for (let lineOffset = 0; lineOffset < line.sourceLines.length; lineOffset++) {
    const source = line.sourceLines[lineOffset];
    const content = source.trim();
    const contentColumn = source.indexOf(content) + 1;
    let start = 0;
    while (start <= content.length - identifier.length) {
      const found = content.indexOf(identifier, start);
      if (found < 0) break;
      const before = content[found - 1];
      const after = content[found + identifier.length];
      if (
        !isConceptIdentifierCharacter(before) &&
        !isConceptIdentifierCharacter(after)
      ) {
        ranges.push({
          start: {
            line: line.range.start.line + lineOffset,
            column: contentColumn + found,
          },
          end: {
            line: line.range.start.line + lineOffset,
            column: contentColumn + found + identifier.length,
          },
        });
      }
      start = found + identifier.length;
    }
  }
  return ranges;
}

function isConceptIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_-]/.test(value);
}

function diagnoseConceptAmbiguities(
  state: NamespaceState,
  diagnostics: SigilDiagnostic[],
): void {
  const grouped = groupConceptsByNormalized(
    state.namespace.accessibleConcepts,
  );
  for (const [normalized, concepts] of grouped) {
    const distinct = distinctConceptIdentities(concepts);
    if (distinct.length < 2) continue;
    const names = distinct.map((concept) =>
      `${concept.identity.componentName}::${concept.identity.identifier}`
    );
    diagnostics.push(diagnostic(
      "SIGIL_AMBIGUOUS_CONCEPT_IDENTIFIER",
      `Concept identifier ${normalized} is ambiguous in component ${state.component.name}: ${
        names.join(", ")
      }. Rename one concept; qualification and shadowing are not supported.`,
      {
        filePath: state.component.filePath,
        range: state.component.declaration.range,
      },
    ));
  }
}

function localResolvedConcept(
  group: LocalConceptGroup,
  publicOnly = false,
): ResolvedConcept {
  return {
    identity: group.identity,
    identifier: group.identifier,
    isPublic: group.isPublic,
    isImported: false,
    occurrences: publicOnly
      ? group.occurrences.filter((item) => item.sectionName === "interface")
      : group.occurrences,
  };
}

function groupConceptsByNormalized(
  concepts: readonly ResolvedConcept[],
): Map<string, ResolvedConcept[]> {
  const grouped = new Map<string, ResolvedConcept[]>();
  for (const concept of concepts) {
    const items = grouped.get(concept.identity.normalizedIdentifier) ?? [];
    items.push(concept);
    grouped.set(concept.identity.normalizedIdentifier, items);
  }
  return grouped;
}

function distinctConceptIdentities(
  concepts: readonly ResolvedConcept[],
): readonly ResolvedConcept[] {
  const distinct = new Map<string, ResolvedConcept>();
  for (const concept of concepts) {
    distinct.set(conceptIdentityKey(concept.identity), concept);
  }
  return [...distinct.values()];
}

function mergeConceptsByIdentity(
  concepts: readonly ResolvedConcept[],
): readonly ResolvedConcept[] {
  const merged = new Map<string, ResolvedConcept>();
  for (const concept of concepts) {
    const key = conceptIdentityKey(concept.identity);
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
          ...existing,
          isPublic: existing.isPublic || concept.isPublic,
          isImported: existing.isImported || concept.isImported,
          occurrences: mergeOccurrences([
            ...existing.occurrences,
            ...concept.occurrences,
          ]),
        }
        : concept,
    );
  }
  return [...merged.values()];
}

function mergeOccurrences(
  occurrences: readonly ResolvedConceptOccurrence[],
): readonly ResolvedConceptOccurrence[] {
  const unique = new Map<string, ResolvedConceptOccurrence>();
  for (const occurrence of occurrences) {
    const key = `${
      normalizePath(occurrence.filePath)
    }:${occurrence.block.range.start.line}:${occurrence.block.range.start.column}`;
    unique.set(key, occurrence);
  }
  return [...unique.values()];
}

function conceptIdentityKey(identity: ConceptIdentity): string {
  return `${
    normalizePath(identity.filePath)
  }::${identity.componentName}::${identity.normalizedIdentifier}`;
}

function normalizeConceptIdentifier(identifier: string): string {
  return identifier.toLocaleLowerCase("en-US");
}

function namespaceFingerprint(namespace: ResolvedConceptNamespace): string {
  return JSON.stringify({
    accessible: namespace.accessibleConcepts.map((concept) => ({
      identity: conceptIdentityKey(concept.identity),
      occurrences: concept.occurrences.map((item) =>
        `${normalizePath(item.filePath)}:${item.block.range.start.line}`
      ),
    })),
    public: namespace.publicConcepts.map((concept) => ({
      identity: conceptIdentityKey(concept.identity),
      occurrences: concept.occurrences.map((item) =>
        `${normalizePath(item.filePath)}:${item.block.range.start.line}`
      ),
    })),
  });
}

function resolveModuleIndexNames(imports: MutableResolvedImport[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of imports) {
      if (!item.targetFile || !isModuleFile(item.targetFile)) continue;
      const indexedImports = imports.filter((candidate) =>
        normalizePath(candidate.sourceFile) === normalizePath(item.targetFile!)
      );
      for (const name of item.names) {
        if (name.component) continue;
        const indexedName = indexedImports
          .flatMap((candidate) => candidate.names)
          .find((candidate) =>
            candidate.name === name.name && candidate.component !== undefined &&
            candidate.componentFile !== undefined
          );
        if (!indexedName?.component || !indexedName.componentFile) continue;
        name.component = indexedName.component;
        name.componentFile = indexedName.componentFile;
        changed = true;
      }
    }
  }
}

// @sigil implements packages/core/src/resolver.sigil::SigilResolver::ImportUse interface,logic,constraints,cases
function resolveImportUses(
  workspace: SigilWorkspace,
  imports: MutableResolvedImport[],
  diagnostics: SigilDiagnostic[],
): void {
  const fileByPath = new Map(
    workspace.files.map((file) => [normalizePath(file.path), file.document]),
  );
  const eligibleSections = new Set([
    "interface",
    "state",
    "logic",
    "constraints",
    "cases",
  ]);

  for (const resolvedImport of imports) {
    const source = fileByPath.get(normalizePath(resolvedImport.sourceFile));
    if (!source) continue;
    for (let index = 0; index < resolvedImport.names.length; index++) {
      const imported = resolvedImport.names[index];
      if (!imported.component || !imported.componentFile) continue;
      const uses: ImportUse[] = [];
      const addUse = (use: ImportUse): void => {
        if (
          !uses.some((item) =>
            item.kind === use.kind &&
            item.filePath === use.filePath &&
            item.range.start.line === use.range.start.line &&
            item.range.start.column === use.range.start.column
          )
        ) uses.push(use);
      };

      if (isModuleFile(resolvedImport.sourceFile)) {
        addUse({
          kind: "module-index-surface",
          filePath: resolvedImport.sourceFile,
          range: resolvedImport.declaration.nameRanges[index] ??
            resolvedImport.declaration.range,
        });
      }

      for (const expansion of source.expands) {
        if (expansion.name !== imported.name) continue;
        addUse({
          kind: "structural-expand",
          filePath: resolvedImport.sourceFile,
          ownerKind: "expand",
          ownerName: expansion.name,
          range: expansion.range,
        });
      }

      const publicConcepts = new Set(
        imported.component.sections
          .filter((section) => section.name === "interface")
          .flatMap((section) =>
            section.concepts.map((concept) => concept.identifier)
          ),
      );
      for (const declaration of [...source.components, ...source.expands]) {
        for (
          const section of declaration.sections.filter((item) =>
            eligibleSections.has(item.name)
          )
        ) {
          for (const unit of section.units) {
            for (const range of referenceRanges(unit, imported.name)) {
              addUse({
                kind: "component-reference",
                filePath: resolvedImport.sourceFile,
                ownerKind: declaration.kind,
                ownerName: declaration.name,
                sectionName: section.name,
                range,
              });
            }
            for (const concept of publicConcepts) {
              for (const range of referenceRanges(unit, concept)) {
                addUse({
                  kind: "public-concept-reference",
                  filePath: resolvedImport.sourceFile,
                  ownerKind: declaration.kind,
                  ownerName: declaration.name,
                  sectionName: section.name,
                  range,
                });
              }
            }
          }
          for (const block of section.concepts) {
            if (!publicConcepts.has(block.identifier)) continue;
            addUse({
              kind: "public-concept-reference",
              filePath: resolvedImport.sourceFile,
              ownerKind: declaration.kind,
              ownerName: declaration.name,
              sectionName: section.name,
              range: block.range,
            });
          }
        }
      }

      imported.uses = uses;
      imported.used = uses.length > 0;
      if (!imported.used) {
        diagnostics.push(diagnostic(
          "SIGIL_UNUSED_IMPORT",
          `Imported component ${imported.name} has no qualifying use in ${resolvedImport.sourceFile}.`,
          {
            filePath: resolvedImport.sourceFile,
            range: resolvedImport.declaration.nameRanges[index] ??
              resolvedImport.declaration.range,
          },
        ));
      }
    }
  }
}

function resolveImportPath(root: string, importPath: string): string {
  const target = importPath.endsWith(".sigil")
    ? importPath
    : joinPath(importPath, "_module.sigil");
  return normalizePath(joinPath(root, target));
}

function importTraversesOutsideWorkspace(importPath: string): boolean {
  const normalized = normalizePath(importPath);
  return normalized === ".." || normalized.startsWith("../");
}

function detectImportCycles(
  imports: readonly ResolvedImport[],
): SigilDiagnostic[] {
  const diagnostics: SigilDiagnostic[] = [];
  const adjacency = new Map<string, ResolvedImport[]>();
  for (const item of imports) {
    if (!item.targetFile) continue;
    const edges = adjacency.get(item.sourceFile) ?? [];
    edges.push(item);
    adjacency.set(item.sourceFile, edges);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(file: string): void {
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const edge of adjacency.get(file) ?? []) {
      const next = edge.targetFile;
      if (!next) continue;
      if (visiting.has(next)) {
        const cycleStart = stack.indexOf(next);
        const cycle = [...stack.slice(cycleStart), next];
        diagnostics.push(diagnostic(
          "SIGIL_IMPORT_CYCLE",
          `Import cycle detected: ${cycle.join(" -> ")}.`,
          {
            filePath: edge.sourceFile,
            range: edge.declaration.range,
          },
        ));
        continue;
      }
      visit(next);
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of adjacency.keys()) {
    visit(file);
  }

  return diagnostics;
}
