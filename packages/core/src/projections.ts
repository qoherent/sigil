import type {
  CollectedExpansion,
  ConceptBlock,
  ResolvedComponent,
  ResolvedConceptNamespace,
  ResolvedSigilWorkspace,
} from "./model.ts";

export interface ConceptBlockView {
  readonly identifier: string;
  readonly lines: readonly string[];
  readonly sourceRange: ConceptBlock["range"];
}

export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
  readonly ungroupedInterfaceLines: readonly string[];
  readonly interfaceConcepts: readonly ConceptBlockView[];
}

export function componentContracts(
  resolved: ResolvedSigilWorkspace,
): readonly ComponentContractView[] {
  return resolved.components.map((component) => {
    const goal = component.declaration.sections.find((section) =>
      section.name === "goal"
    );
    const iface = component.declaration.sections.find((section) =>
      section.name === "interface"
    );
    return {
      name: component.name,
      filePath: component.filePath,
      goalLines: goal?.lines.map((line) => line.text) ?? [],
      interfaceLines: iface?.lines.map((line) => line.text) ?? [],
      ungroupedInterfaceLines: iface?.lines.filter((line) =>
        line.conceptIdentifier === undefined
      ).map((line) => line.text) ?? [],
      interfaceConcepts: iface?.concepts.map((concept) => ({
        identifier: concept.identifier,
        lines: concept.lines.map((line) =>
          line.text
        ),
        sourceRange: concept.range,
      })) ?? [],
    };
  });
}

export function conceptNamespaceFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): ResolvedConceptNamespace | undefined {
  return resolved.components.find((component) =>
    component.name === componentName
  )?.conceptNamespace;
}

export function collectedExpansionFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): CollectedExpansion | undefined {
  return resolved.components.find((component: ResolvedComponent) =>
    component.name === componentName
  )?.expansions;
}
