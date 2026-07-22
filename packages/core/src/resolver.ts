import { diagnostic } from "./diagnostics.ts";
import type {
  CollectedExpansion,
  ComponentDeclaration,
  ConceptIdentity,
  ExpandDeclaration,
  ResolvedComponent,
  ResolvedConcept,
  ResolvedConceptNamespace,
  ResolvedConceptOccurrence,
  ResolvedImport,
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

  for (const [name, expands] of expandsByName) {
    if (!componentsByName.has(name)) {
      for (const expand of expands) {
        diagnostics.push(diagnostic(
          "SIGIL_EXPAND_WITHOUT_COMPONENT",
          `expand ${name} has no matching component.`,
          { filePath: expand.filePath, range: expand.declaration.range },
        ));
      }
    }
  }

  const resolvedImports: MutableResolvedImport[] = [];

  for (const file of workspace.files) {
    for (const declaration of file.document.imports) {
      const targetFile = resolveImportPath(workspace.root, declaration.path);
      if (!documentByPath.has(targetFile)) {
        diagnostics.push(diagnostic(
          "SIGIL_UNRESOLVED_IMPORT_PATH",
          `Import path @${declaration.path} resolved to missing file ${targetFile}.`,
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
            item.name === name
          );
          return component
            ? { name, component, componentFile: targetFile }
            : { name };
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
      const expands = expandsByName.get(name) ?? [];
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

  const resolvedComponents = resolveConceptNamespaces(
    componentDrafts,
    resolvedImports,
    diagnostics,
  );

  return {
    workspace,
    imports: resolvedImports,
    components: resolvedComponents,
    diagnostics,
  };
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
  const local = state.groups.map((group): ResolvedConcept => {
    const exactImported = distinctConceptIdentities(
      (importedByNormalized.get(group.normalizedIdentifier) ?? []).filter(
        (concept) => concept.identifier === group.identifier,
      ),
    );
    const importedMatch = exactImported.length === 1
      ? exactImported[0]
      : undefined;
    return {
      identity: importedMatch?.identity ?? group.identity,
      identifier: group.identifier,
      isPublic: group.isPublic,
      isImported: importedMatch !== undefined,
      occurrences: group.occurrences,
    };
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
  };
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

function resolveImportPath(root: string, importPath: string): string {
  const target = importPath.endsWith(".sigil")
    ? importPath
    : joinPath(importPath, "#module.sigil");
  return normalizePath(joinPath(root, target));
}

function detectImportCycles(
  imports: readonly ResolvedImport[],
): SigilDiagnostic[] {
  const diagnostics: SigilDiagnostic[] = [];
  const adjacency = new Map<string, string[]>();
  for (const item of imports) {
    if (!item.targetFile) continue;
    const edges = adjacency.get(item.sourceFile) ?? [];
    edges.push(item.targetFile);
    adjacency.set(item.sourceFile, edges);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(file: string): void {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file];
      diagnostics.push(diagnostic(
        "SIGIL_IMPORT_CYCLE",
        `Import cycle detected: ${cycle.join(" -> ")}.`,
        { filePath: file },
      ));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const next of adjacency.get(file) ?? []) {
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
