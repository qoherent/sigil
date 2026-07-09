import type { CollectedExpansion, ResolvedComponent, ResolvedSigilWorkspace } from "./model.ts";

export interface ComponentContractView {
  readonly name: string;
  readonly filePath: string;
  readonly goalLines: readonly string[];
  readonly interfaceLines: readonly string[];
}

export function componentContracts(resolved: ResolvedSigilWorkspace): readonly ComponentContractView[] {
  return resolved.components.map((component) => {
    const goal = component.declaration.sections.find((section) => section.name === "goal");
    const iface = component.declaration.sections.find((section) => section.name === "interface");
    return {
      name: component.name,
      filePath: component.filePath,
      goalLines: goal?.lines.map((line) => line.text) ?? [],
      interfaceLines: iface?.lines.map((line) => line.text) ?? [],
    };
  });
}

export function collectedExpansionFor(
  resolved: ResolvedSigilWorkspace,
  componentName: string,
): CollectedExpansion | undefined {
  return resolved.components.find((component: ResolvedComponent) => component.name === componentName)?.expansions;
}
