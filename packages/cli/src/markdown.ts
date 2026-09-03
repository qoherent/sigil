import type {
  CollectedExpansion,
  ComponentContractView,
  ResolvedComponent,
  ResolvedConceptNamespace,
  SigilDiagnostic,
} from "@qoherent/sigil-core";
import type { CoreAdapter } from "./core-adapter.ts";
import type { ContextCommandResult } from "./output-model.ts";
import type {
  RetrievalProjection,
  RetrievalProjectionComponent,
  RetrievalProjectionConcept,
  RetrievalProjectionItem,
  RetrievalProjectionOwnership,
} from "@qoherent/sigil-core";

// @sigil implements packages/cli/src/retrieval-markdown.sigil::SigilRetrievalMarkdown::RetrievalMarkdownProjection interface,constraints,cases
export function renderRetrieveMarkdown(
  projection: RetrievalProjection,
): string {
  const selected = projection.components.filter((item) =>
    item.role === "selected"
  );
  const lines = [`# ${escapeMarkdown(projection.purpose)} retrieval`, ""];
  for (const component of selected) {
    lines.push(
      `## ${escapeMarkdown(component.name)}`,
      "",
      `Source: ${escapeMarkdown(component.path)}`,
      "",
    );
    appendSelectedSection(lines, "Goal", component.goal);
    appendSelectedInterface(lines, component.interface);
    appendSelectedSection(lines, "Scope", component.scope);
    appendSelectedSection(lines, "State", component.state);
    appendSelectedSection(lines, "Logic", component.logic);
    appendSelectedSection(lines, "Constraints", component.constraints);
    appendSelectedSection(lines, "Decisions", component.decisions);
    appendSelectedSection(lines, "Cases", component.cases);
    if (component.ownership.length) {
      lines.push(
        "### Ownership",
        ...component.ownership.map(renderOwnership),
        "",
      );
    }
    const links = component.links.filter((item) =>
      item.relation !== "selected-declaration"
    );
    if (links.length) {
      lines.push(
        "### Links",
        ...links.map((item) =>
          `- ${escapeMarkdown(component.id)} --${
            escapeMarkdown(item.relation)
          }--> ${escapeMarkdown(item.target)}`
        ),
        "",
      );
    }
  }
  appendRelatedGroup(
    lines,
    "Dependencies",
    projection.components.filter((item) => item.role === "dependency"),
  );
  appendRelatedGroup(
    lines,
    "Importers",
    projection.components.filter((item) => item.role === "importer"),
  );
  appendRelatedGroup(
    lines,
    "Cycle members",
    projection.components.filter((item) => item.role === "cycle-member"),
  );
  appendRelatedGroup(
    lines,
    "Module Context",
    projection.components.filter((item) => item.role === "module-context"),
    true,
  );
  if (projection.diagnostics.length) {
    lines.push(
      "## Diagnostics",
      ...projection.diagnostics.map((item) =>
        `- ${escapeMarkdown(item.severity)} ${escapeMarkdown(item.code)}: ${
          escapeMarkdown(item.message)
        }`
      ),
      "",
    );
  }
  if (projection.glossary.length) {
    lines.push(
      "## Glossary",
      ...projection.glossary.map((item) =>
        `- **${escapeMarkdown(item.term)}** — ${
          escapeMarkdown(item.definition)
        }`
      ),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function appendSelectedSection(
  lines: string[],
  name: string,
  items: readonly RetrievalProjectionItem[],
): void {
  if (!items.length) return;
  lines.push(`### ${name}`, ...items.map(renderUnit), "");
}

function appendSelectedInterface(
  lines: string[],
  concepts: readonly RetrievalProjectionConcept[],
): void {
  if (
    !concepts.some((concept) =>
      concept.items.length || concept.ownership.length
    )
  ) return;
  lines.push("### Interface");
  for (const concept of concepts) {
    if (!concept.items.length && !concept.ownership.length) continue;
    if (concept.name) lines.push("", `#### ${escapeMarkdown(concept.name)}`);
    lines.push(
      ...concept.items.map(renderUnit),
      ...concept.ownership.map(renderOwnership),
    );
  }
  lines.push("");
}

function appendRelatedGroup(
  lines: string[],
  heading: string,
  components: readonly RetrievalProjectionComponent[],
  includeSummary = false,
): void {
  if (!components.length) return;
  lines.push(`## ${heading}`, "");
  for (const component of components) {
    lines.push(
      `### ${escapeMarkdown(component.name)}`,
      `Source: ${escapeMarkdown(component.path)}`,
      `Identity: ${escapeMarkdown(component.id)}`,
      "",
    );
    appendRelatedLabeled(lines, "Goal", component.goal);
    appendRelatedInterface(lines, component.interface);
    appendRelatedLabeled(lines, "Scope", component.scope);
    if (includeSummary) {
      appendRelatedLabeled(lines, "Constraints", component.constraints);
      appendRelatedLabeled(lines, "Decisions", component.decisions);
    }
  }
}

function appendRelatedLabeled(
  lines: string[],
  name: string,
  items: readonly RetrievalProjectionItem[],
): void {
  if (!items.length) return;
  lines.push(`**${name}**`, ...items.map(renderUnit), "");
}

function appendRelatedInterface(
  lines: string[],
  concepts: readonly RetrievalProjectionConcept[],
): void {
  if (
    !concepts.some((concept) =>
      concept.items.length || concept.ownership.length
    )
  ) return;
  lines.push("**Interface**");
  for (const concept of concepts) {
    if (!concept.items.length && !concept.ownership.length) continue;
    if (concept.name) lines.push("", `#### ${escapeMarkdown(concept.name)}`);
    lines.push(
      ...concept.items.map(renderUnit),
      ...concept.ownership.map(renderOwnership),
    );
  }
  lines.push("");
}

function renderUnit(item: RetrievalProjectionItem): string {
  return `- ${escapeMarkdown(item.text)}`;
}

function renderOwnership(item: RetrievalProjectionOwnership): string {
  const line = item.location?.line ?? 1;
  const column = item.location?.column ?? 1;
  const label = `${escapeMarkdown(item.path)}:${line}:${column}`;
  let text = `- ${item.relation} [${label}](${item.path}#L${line})`;
  if (item.symbol) text += ` (${escapeMarkdown(item.symbol)})`;
  if (item.sections.length) {
    text += `: ${
      item.sections.map((section) => escapeMarkdown(section)).join(", ")
    }`;
  }
  return text;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_\[\]])/g, "\\$1");
}

// @sigil implements packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
export function renderWorkspaceMarkdown(
  resolved: Awaited<ReturnType<CoreAdapter["resolveWorkspace"]>>,
  core: CoreAdapter,
): string {
  const lines = [
    "# Sigil Workspace",
    "",
    `Workspace root: ${resolved.workspace.root}`,
    `Workspace: ${resolved.workspace.config?.workspace.name ?? "unresolved"}`,
    `Sigil: ${resolved.workspace.config?.sigilVersion ?? "unresolved"}`,
    "",
  ];
  const contracts = core.componentContracts(resolved);
  for (const [index, contract] of contracts.entries()) {
    lines.push(...formatComponentContract(contract));
    const component = resolved.components[index];
    const expansion = componentIdentityMatches(contract, component)
      ? component.expansions
      : undefined;
    if (expansion?.expands.length) {
      lines.push(...formatCollectedExpansion(expansion));
    }
    lines.push("");
  }
  lines.push(...formatDiagnostics("## Diagnostics", resolved.diagnostics));
  return `${lines.join("\n")}\n`;
}

// @sigil implements packages/cli/_module.sigil::SigilCli::MarkdownOutput interface,logic,constraints
export function renderContextMarkdown(result: ContextCommandResult): string {
  const lines = [
    "# Sigil Context",
    "",
    `Workspace root: ${result.workspaceRoot}`,
    `Workspace: ${result.workspaceName ?? "unresolved"}`,
    `Sigil: ${result.sigilVersion ?? "unresolved"}`,
    "",
  ];

  if (!result.selectedComponents.length) {
    lines.push(
      "## Selection",
      "",
      "- No context matched the requested component or file.",
      "",
    );
  } else {
    for (const [index, component] of result.selectedComponents.entries()) {
      const contract = result.componentContracts.find((item) =>
        item.name === component.name && item.filePath === component.filePath
      );
      lines.push(
        `## ${component.name}`,
        "",
        `Source: ${component.filePath}`,
        "",
      );
      if (contract) {
        lines.push(...formatContractBody(contract));
      } else {
        lines.push("### Contract", "", "- none");
      }

      const expansion = expansionForComponent(result, component, index);
      if (expansion?.expands.length) {
        lines.push(...formatCollectedExpansion(expansion));
      }

      const conceptNamespace = conceptNamespaceForComponent(
        result,
        component,
        index,
      );
      if (conceptNamespace) {
        lines.push(...formatConceptNamespace(conceptNamespace));
      }

      const dependencyContext = agentDependencyContextForComponent(
        result,
        component,
        index,
      );
      if (dependencyContext) {
        lines.push(...formatAgentDependencyContext(dependencyContext));
      }

      const dependentContext = agentDependentContextForComponent(
        result,
        component,
        index,
      );
      if (dependentContext) {
        lines.push(...formatAgentDependentContext(dependentContext));
      }

      const ownershipProjection = ownedImplementationProjectionForComponent(
        result,
        component,
        index,
      );
      if (ownershipProjection) {
        lines.push(...formatOwnedImplementationProjection(ownershipProjection));
      }

      lines.push("");
    }
  }

  lines.push("## Related Files", "");
  lines.push(...formatList(result.relatedFilePaths));
  lines.push("");

  if (result.glossaryContext) {
    lines.push("## Glossary Context", "");
    lines.push(`Glossary: ${result.glossaryContext.glossaryPath ?? "absent"}`);
    lines.push("");
    lines.push("### Terms");
    lines.push(
      ...formatList(
        result.glossaryContext.terms.map((term) =>
          `${term.term}: ${term.definition}`
        ),
      ),
    );
    lines.push("");
    lines.push("### Occurrences");
    lines.push(...formatList(result.glossaryContext.occurrences.map((
      occurrence,
    ) =>
      `${occurrence.filePath}:${occurrence.range.start.line}:${occurrence.range.start.column} ${occurrence.matchedSpelling} -> ${occurrence.term.term}`
    )));
    lines.push("");
  }

  lines.push(...formatDiagnostics("## Diagnostics", result.diagnostics));
  return `${lines.join("\n")}\n`;
}

function formatComponentContract(contract: ComponentContractView): string[] {
  return formatComponentContractAtLevel(contract, 2);
}

function formatComponentContractAtLevel(
  contract: ComponentContractView,
  headingLevel: number,
): string[] {
  return [
    `${heading(headingLevel)} ${contract.name}`,
    "",
    `Source: ${contract.filePath}`,
    "",
    ...formatContractBody(contract, headingLevel + 1),
  ];
}

function formatContractBody(
  contract: ComponentContractView,
  headingLevel = 3,
): string[] {
  const lines = [
    `${heading(headingLevel)} Goal`,
    ...formatList(contract.goalLines),
    "",
    `${heading(headingLevel)} Interface`,
  ];
  if (contract.ungroupedInterfaceLines.length) {
    lines.push(...formatList(contract.ungroupedInterfaceLines));
  } else if (!contract.interfaceConcepts.length) {
    lines.push("- none");
  }
  for (const concept of contract.interfaceConcepts) {
    lines.push(
      "",
      `${heading(headingLevel + 1)} ${concept.identifier}`,
      ...formatList(concept.lines),
    );
  }
  return lines;
}

function formatCollectedExpansion(expansion: CollectedExpansion): string[] {
  const lines = ["", "### Expansions"];
  for (const item of expansion.expands) {
    lines.push("", `Source: ${item.filePath}`);
    for (const section of item.declaration.sections) {
      lines.push(
        "",
        `#### ${section.name}`,
        ...formatList(section.units.map((unit) => unit.prose)),
      );
    }
  }
  return lines;
}

function formatAgentDependencyContext(
  context: ContextCommandResult["agentDependencyContexts"][number],
): string[] {
  const lines = ["", "### Direct Dependencies"];
  if (!context.dependencyContracts.length) {
    lines.push("- none");
  } else {
    const renderedDecisionIndexes = new Set<number>();
    const dependencyDecisions = uniqueDependencyDecisions(
      context.dependencyDecisions,
    );
    const dependencyNameCounts = new Map<string, number>();
    for (const contract of context.dependencyContracts) {
      dependencyNameCounts.set(
        contract.name,
        (dependencyNameCounts.get(contract.name) ?? 0) + 1,
      );
    }
    for (const contract of context.dependencyContracts) {
      lines.push("", ...formatComponentContractAtLevel(contract, 4));
      const canAssociateByName = dependencyNameCounts.get(contract.name) === 1;
      const decisions = canAssociateByName
        ? dependencyDecisions
          .map((decision, index) => ({ decision, index }))
          .filter(({ decision }) => decision.componentName === contract.name)
        : [];
      lines.push("", "##### Dependency Decisions");
      if (!decisions.length) {
        lines.push("- none");
      } else {
        for (const { decision, index } of decisions) {
          renderedDecisionIndexes.add(index);
          lines.push(`- ${decision.filePath}`);
          for (const unit of decision.section.units) {
            lines.push(`  - ${unit.prose}`);
          }
        }
      }
    }
    const unassociatedDecisions = dependencyDecisions
      .map((decision, index) => ({ decision, index }))
      .filter(({ index }) => !renderedDecisionIndexes.has(index));
    if (unassociatedDecisions.length) {
      lines.push("", "#### Other Dependency Decisions");
      for (const { decision } of unassociatedDecisions) {
        lines.push(`- ${decision.componentName} (${decision.filePath})`);
        for (const unit of decision.section.units) {
          lines.push(`  - ${unit.prose}`);
        }
      }
    }
  }
  return lines;
}

function formatAgentDependentContext(
  context: NonNullable<
    ContextCommandResult["agentDependentContexts"]
  >[number],
): string[] {
  const lines = ["", "### Direct Importers"];
  if (!context.importingFiles.length) {
    lines.push("- none");
    return lines;
  }
  for (const importingFile of context.importingFiles) {
    lines.push("", `#### ${importingFile.filePath}`);
    lines.push(
      `- Imports: ${importingFile.importedComponent.name} (${importingFile.importedComponent.filePath})`,
    );
    lines.push("", "##### Contextual Contracts");
    if (!importingFile.contextualContracts.length) {
      lines.push("- none");
      continue;
    }
    for (const contract of importingFile.contextualContracts) {
      lines.push("", ...formatComponentContractAtLevel(contract, 6));
    }
  }
  return lines;
}

function formatConceptNamespace(
  namespace: ResolvedConceptNamespace,
): string[] {
  const lines = ["", "### Concept Namespace"];
  lines.push("", "#### Public Concepts");
  lines.push(...formatConcepts(namespace.publicConcepts));
  lines.push("", "#### Accessible Concepts");
  lines.push(...formatConcepts(namespace.accessibleConcepts));
  lines.push("", "#### Declared Concepts");
  lines.push(...formatConcepts(namespace.concepts));
  lines.push("", "#### References");
  if (!namespace.references.length) {
    lines.push("- none");
  } else {
    for (const reference of namespace.references) {
      lines.push(
        `- ${reference.conceptIdentity.identifier} from ${reference.conceptIdentity.componentName} (${reference.conceptIdentity.filePath}) referenced by ${reference.ownerKind} ${reference.ownerName} ${reference.sectionName} in ${reference.filePath}`,
      );
    }
  }
  return lines;
}

function uniqueDependencyDecisions(
  decisions: ContextCommandResult["agentDependencyContexts"][number][
    "dependencyDecisions"
  ],
): ContextCommandResult["agentDependencyContexts"][number][
  "dependencyDecisions"
] {
  const seen = new Set<string>();
  return decisions.filter((decision) => {
    const key = [
      decision.componentName,
      decision.filePath,
      ...decision.section.units.map((unit) => unit.prose),
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatConcepts(
  concepts: ResolvedConceptNamespace["concepts"],
): string[] {
  if (!concepts.length) return ["- none"];
  return concepts.map((concept) => {
    const visibility = concept.isPublic ? "public" : "private";
    const origin = concept.isImported ? "imported" : "declared";
    const occurrences = concept.occurrences
      .map((occurrence) =>
        `${occurrence.ownerKind} ${occurrence.componentName} ${occurrence.sectionName} in ${occurrence.filePath}`
      )
      .join("; ");
    return `- ${concept.identifier} (${concept.identity.componentName}, ${concept.identity.filePath}; ${visibility}, ${origin})${
      occurrences ? `: ${occurrences}` : ""
    }`;
  });
}

function formatOwnedImplementationProjection(
  projection: ContextCommandResult["ownedImplementationProjections"][number],
): string[] {
  const lines = ["", "### Owned Implementation Targets"];
  if (!projection.targets.length) {
    lines.push("- none");
  } else {
    for (const target of projection.targets) {
      const sections = target.sections.length
        ? ` [${target.sections.join(", ")}]`
        : "";
      const symbol = target.symbolIdentity ? ` ${target.symbolIdentity}` : "";
      lines.push(
        `- ${target.relation}${sections}: ${target.filePath}${symbol}`,
      );
    }
  }
  if (projection.diagnostics.length) {
    lines.push("", "#### Ownership Diagnostics");
    for (const diagnostic of projection.diagnostics) {
      lines.push(`- ${formatDiagnostic(diagnostic)}`);
    }
  }
  return lines;
}

function formatDiagnostics(
  heading: string,
  diagnostics: readonly SigilDiagnostic[],
): string[] {
  const lines = [heading, ""];
  if (!diagnostics.length) lines.push("- none");
  else {
    for (const item of diagnostics) {
      lines.push(`- ${formatDiagnostic(item)}`);
    }
  }
  return lines;
}

function formatDiagnostic(diagnostic: SigilDiagnostic): string {
  return `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

function formatList(lines: readonly string[]): string[] {
  return lines.length ? lines.map((line) => `- ${line}`) : ["- none"];
}

function heading(level: number): string {
  return "#".repeat(level);
}

function expansionForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): CollectedExpansion | undefined {
  const indexed = result.selectedComponents[index];
  if (componentIdentityMatches(indexed, component)) return component.expansions;
  return undefined;
}

function conceptNamespaceForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ResolvedConceptNamespace | undefined {
  if (namespaceMatchesComponent(component.conceptNamespace, component)) {
    return component.conceptNamespace;
  }
  const indexed = result.conceptNamespaces[index];
  if (indexed && namespaceMatchesComponent(indexed, component)) return indexed;
  return result.conceptNamespaces.find((namespace) =>
    namespaceMatchesComponent(namespace, component)
  );
}

function agentDependencyContextForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ContextCommandResult["agentDependencyContexts"][number] | undefined {
  const indexed = result.agentDependencyContexts[index];
  if (
    indexed && componentIdentityMatches(indexed.selectedComponent, component)
  ) {
    return indexed;
  }
  return result.agentDependencyContexts.find((item) =>
    componentIdentityMatches(item.selectedComponent, component)
  );
}

function agentDependentContextForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
):
  | NonNullable<
    ContextCommandResult["agentDependentContexts"]
  >[number]
  | undefined {
  const contexts = result.agentDependentContexts ?? [];
  const indexed = contexts[index];
  if (
    indexed && componentIdentityMatches(indexed.selectedComponent, component)
  ) {
    return indexed;
  }
  return contexts.find((item) =>
    componentIdentityMatches(item.selectedComponent, component)
  );
}

function ownedImplementationProjectionForComponent(
  result: ContextCommandResult,
  component: ResolvedComponent,
  index: number,
): ContextCommandResult["ownedImplementationProjections"][number] | undefined {
  const indexed = result.ownedImplementationProjections[index];
  if (
    indexed && componentIdentityMatches(indexed.owningComponent, component)
  ) {
    return indexed;
  }
  return result.ownedImplementationProjections.find((item) =>
    componentIdentityMatches(item.owningComponent, component)
  );
}

function componentIdentityMatches(
  left: Pick<ResolvedComponent, "name" | "filePath"> | undefined,
  right: Pick<ResolvedComponent, "name" | "filePath"> | undefined,
): boolean {
  if (!left || !right) return false;
  return left.name === right.name && left.filePath === right.filePath;
}

function namespaceMatchesComponent(
  namespace: ResolvedConceptNamespace,
  component: ResolvedComponent,
): boolean {
  if (namespace.componentName !== component.name) return false;
  return [
    ...namespace.concepts,
    ...namespace.accessibleConcepts,
    ...namespace.publicConcepts,
  ].some((concept) =>
    concept.identity.componentName === component.name &&
    concept.identity.filePath === component.filePath
  ) || namespace.references.some((reference) =>
    reference.componentName === component.name &&
    reference.filePath === component.filePath
  );
}
