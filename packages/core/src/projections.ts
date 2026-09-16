import { compareScalarText } from "./diagnostics.ts";
import type { ImportedTagEdge } from "./model/graph.ts";
import type {
  AgentDependencyContext,
  AgentDependentContext,
  ComponentContractView,
  ProviderContext,
  TagNamespace,
} from "./model/projections.ts";
import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "./model/resolution.ts";
import type { ComponentDeclaration, Facet } from "./model/source.ts";
export type * from "./model/projections.ts";

export function resolvedComponentFor(
  resolved: ResolvedSigilWorkspace,
  name: string,
): ResolvedComponent | undefined {
  const candidates = resolved.components.filter((c) => c.name === name);
  return candidates.length === 1 && candidates[0].identity
    ? candidates[0]
    : undefined;
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::ContractProjection interface,logic,cases
export function componentContracts(
  resolved: ResolvedSigilWorkspace,
): readonly ComponentContractView[] {
  return resolved.components.map(componentContractView);
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::TagScopeProjection interface,logic,cases
export function tagNamespaceFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): TagNamespace | undefined {
  const component = resolvedComponentFor(resolved, componentName);
  return component
    ? {
      name: component.name,
      identity: component.identity,
      tags: component.tags,
      accessibleTags: component.accessibleTags,
      references: component.references,
    }
    : undefined;
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::ComponentDesignProjection interface,logic,cases
export function componentDesignFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): ComponentDeclaration | undefined {
  return resolvedComponentFor(resolved, componentName)?.declaration;
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::AgentDependencyContext interface,logic,constraints,cases
export function agentDependencyContextFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): AgentDependencyContext | undefined {
  const selectedComponent = resolvedComponentFor(resolved, componentName);
  if (!selectedComponent) return undefined;
  const providers = new Map<string, ProviderContext>();
  for (
    const item of resolved.imports.filter((i) =>
      i.sourceFile === selectedComponent.filePath
    )
  ) {
    const component = resolved.components.find((c) => c.id === item.providerId);
    if (!component?.identity) continue;
    const selections = item.names.filter((s) => s.status === "resolved");
    if (!selections.length) continue;
    const previous = providers.get(component.id);
    providers.set(component.id, {
      component,
      selections: [...(previous?.selections ?? []), ...selections],
      uses: [
        ...(previous?.uses ?? []),
        ...selections.flatMap((s) =>
          s.uses.filter((u) => u.componentId === selectedComponent.id)
        ),
      ],
    });
  }
  const contexts = [...providers.values()];
  return {
    selectedComponent,
    providers: contexts,
    dependencyContracts: contexts.map((p) =>
      componentContractView(p.component)
    ),
    dependencyDecisions: contexts.flatMap((p) =>
      p.component.declaration.sections.filter((s) => s.name === "decisions")
        .map((section) => ({
          componentName: p.component.name,
          filePath: p.component.filePath,
          section,
        }))
    ),
    relatedFilePaths: [
      ...new Set([
        selectedComponent.filePath,
        ...contexts.map((p) => p.component.filePath),
      ]),
    ].sort(compareScalarText),
  };
}

// @sigil implements packages/core/src/projections.sigil::SigilProjections::AgentDependentContext interface,logic,constraints,cases
export function agentDependentContextFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): AgentDependentContext | undefined {
  const selectedComponent = resolvedComponentFor(resolved, componentName);
  if (!selectedComponent) return undefined;
  const byFile = new Map<string, ImportedTagEdge[]>();
  for (const edge of resolved.graph.importedTagEdges) {
    if (
      edge.providerComponentId !== selectedComponent.id ||
      edge.sourceFile === selectedComponent.filePath
    ) continue;
    const edges = byFile.get(edge.sourceFile) ?? [];
    if (!edges.some((e) => e.id === edge.id)) edges.push(edge);
    byFile.set(edge.sourceFile, edges);
  }
  const importingFiles = [...byFile].sort(([a], [b]) => compareScalarText(a, b))
    .map(([filePath, edges]) => ({
      filePath,
      provider: selectedComponent,
      importEdges: edges.sort((a, b) =>
        a.originRange.start - b.originRange.start ||
        compareScalarText(a.id, b.id)
      ),
      contextualContracts: resolved.components.filter((c) =>
        c.filePath === filePath
      ).map(componentContractView),
    }));
  return {
    selectedComponent,
    importingFiles,
    relatedFilePaths: importingFiles.map((f) => f.filePath),
  };
}

function componentContractView(
  component: ResolvedComponent,
): ComponentContractView {
  const goal = component.declaration.sections.filter((s) => s.name === "goal");
  const iface = component.declaration.sections.filter((s) =>
    s.name === "interface"
  );
  return {
    name: component.name,
    filePath: component.filePath,
    declaration: component.declaration,
    goalLines: goal.flatMap((s) => s.units.map((u) => u.prose)),
    interfaceLines: iface.flatMap((s) => s.units.map((u) => u.prose)),
    ungroupedInterfaceLines: iface.flatMap((s) =>
      s.units.filter((u) => u.groupingId === undefined).map((u) => u.prose)
    ),
    interfaceTags: iface.flatMap((s) =>
      s.groups.map((g) => ({
        name: g.name,
        lines: g.units.map((u) => u.prose),
        sourceRange: g.range,
      }))
    ),
  };
}

/** A shared Tag never transfers another component's authored Facets. */
export function componentFacetsFor(
  component: ResolvedComponent,
  tagName?: string,
  sectionName?: string,
): readonly Facet[] {
  const facets = component.declaration.sections.filter((s) =>
    sectionName === undefined || s.name === sectionName
  ).flatMap((s) => s.units);
  if (tagName === undefined) return facets;
  const tag = component.accessibleTags.find((t) =>
    t.name === tagName && t.status === "resolved"
  )?.tag;
  if (!tag?.identity) return [];
  const local = component.tags.find((t) => t.identity?.id === tag.identity!.id);
  const introduced = new Set(
    local?.introductions.filter((i) => i.valid).flatMap((i) =>
      i.facetId ? [i.facetId] : []
    ) ?? [],
  );
  const referenced = new Set(
    component.references.filter((r) => r.tagIdentity?.id === tag.identity!.id)
      .map((r) => r.facetId),
  );
  return facets.filter((f) =>
    introduced.has(f.id) || referenced.has(f.id) ||
    (local && f.groupingTag === tagName)
  );
}
