import type {
  ComponentContractView,
  EmbeddedContent,
  Facet,
  SigilDiagnostic,
} from "@qoherent/sigil-core";
import type { CoreAdapter } from "./core-adapter.ts";
import type { ContextCommandResult } from "./output-model.ts";
import type {
  RetrievalProjection,
  RetrievalProjectionComponent,
  RetrievalProjectionItem,
  RetrievalProjectionOwnership,
  RetrievalProjectionTagGroup,
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
  if (projection.budget) {
    lines.push("## Budget", "", JSON.stringify(projection.budget), "");
  }
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
  concepts: readonly RetrievalProjectionTagGroup[],
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
  concepts: readonly RetrievalProjectionTagGroup[],
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
  return `- ${escapeMarkdown(item.text)}${
    item.facet?.payload ? `\n\n${renderPayload(item.facet.payload)}` : ""
  }\n`;
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
  if (item.tagName) {
    const owner = item.tagIdentity?.owner;
    text += `; Tag: ${escapeMarkdown(item.tagName)}; Origin: ${
      owner
        ? `${escapeMarkdown(owner.declarationPath)}::${
          escapeMarkdown(owner.componentName)
        }`
        : "unresolved"
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
  for (const contract of core.componentContracts(resolved)) {
    lines.push(...formatContract(contract, 2));
  }
  lines.push(...formatDiagnostics(resolved.diagnostics));
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
  }
  for (const component of result.selectedComponents) {
    const contract = result.componentContracts.find((c) =>
      c.declaration.id === component.id
    );
    if (contract) lines.push(...formatContract(contract, 2));
    lines.push("### Tags", "");
    for (const tag of component.tags) {
      lines.push(
        `- ${
          escapeMarkdown(tag.name)
        } (${tag.status}; ${component.filePath}; ${tag.introductions.length} introductions)`,
      );
    }
    if (!component.tags.length) lines.push("- none");
    lines.push("", "### Accessible Tags", "");
    for (const accessible of component.accessibleTags) {
      const owner = accessible.tag?.identity?.owner;
      lines.push(
        `- ${escapeMarkdown(accessible.name)} (${accessible.status}${
          owner ? `; ${owner.componentName}, ${owner.declarationPath}` : ""
        })`,
      );
    }
    lines.push("", "### References", "");
    for (const reference of component.references) {
      const owner = reference.tagIdentity?.owner;
      lines.push(
        `- ${
          escapeMarkdown(reference.name)
        }: ${reference.sectionName}, bytes ${reference.range.start}–${reference.range.end}${
          owner
            ? `; from ${owner.componentName} (${owner.declarationPath})`
            : `; ${reference.status}`
        }`,
      );
    }
    const dependency = result.agentDependencyContexts.find((c) =>
      c.selectedComponent.id === component.id
    );
    lines.push("", "### Direct Dependencies", "");
    if (!dependency?.providers.length) lines.push("- none");
    for (const provider of dependency?.providers ?? []) {
      lines.push(
        `Selected Tags: ${
          provider.selections.map((s) => escapeMarkdown(s.name)).join(", ")
        }`,
        "",
        `Consumer uses: ${provider.uses.length}`,
        "",
      );
      const providerContract = dependency!.dependencyContracts.find((c) =>
        c.declaration.id === provider.component.id
      );
      if (providerContract) lines.push(...formatContract(providerContract, 4));
    }
    const dependent = result.agentDependentContexts?.find((c) =>
      c.selectedComponent.id === component.id
    );
    if (dependent) {
      lines.push("### Direct Importers", "");
      if (!dependent.importingFiles.length) lines.push("- none");
      for (const file of dependent.importingFiles) {
        lines.push(`#### ${file.filePath}`, "");
        for (const contextual of file.contextualContracts) {
          lines.push(...formatContract(contextual, 5));
        }
      }
    }
    const ownership = result.ownedImplementationProjections.find((p) =>
      p.owningComponent.id === component.id
    );
    lines.push("### Owned Implementation Targets", "");
    if (!ownership?.targets.length) lines.push("- none");
    for (const target of ownership?.targets ?? []) {
      lines.push(
        `- ${target.relation} [${
          target.sections.join(", ")
        }]: ${target.filePath}${
          target.symbolIdentity ? ` ${target.symbolIdentity}` : ""
        }`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Related Files",
    "",
    ...result.relatedFilePaths.map((p) => `- ${p}`),
    "",
  );
  if (result.glossaryContext) {
    lines.push(
      "## Glossary Context",
      "",
      `Glossary: ${result.glossaryContext.glossaryPath}`,
      "",
      "### Terms",
      "",
    );
    for (const term of result.glossaryContext.terms) {
      lines.push(`- ${term.term}: ${term.definition}`);
    }
    lines.push("", "### Occurrences", "");
    for (const occurrence of result.glossaryContext.occurrences) {
      lines.push(
        `- ${occurrence.filePath}:byte-${occurrence.range.start} ${occurrence.matchedSpelling} -> ${occurrence.term.term}`,
      );
    }
    lines.push("");
  }
  lines.push(...formatDiagnostics(result.diagnostics));
  return `${lines.join("\n")}\n`;
}

function formatContract(
  contract: ComponentContractView,
  level: number,
): string[] {
  const lines = [
    `${"#".repeat(level)} ${escapeMarkdown(contract.name)}`,
    "",
    `Source: ${contract.filePath}`,
    "",
  ];
  for (const section of contract.declaration.sections) {
    lines.push(
      `${"#".repeat(level + 1)} ${section.name[0].toUpperCase()}${
        section.name.slice(1)
      }`,
      "",
    );
    let group: string | undefined;
    for (const facet of section.units) {
      if (facet.groupingId !== group && facet.groupingTag) {
        lines.push(
          `${"#".repeat(level + 2)} ${escapeMarkdown(facet.groupingTag)}`,
          "",
        );
      }
      group = facet.groupingId;
      lines.push(...renderFacet(facet));
    }
  }
  return lines;
}
function renderFacet(facet: Facet): string[] {
  const lines = [facet.prose, ""];
  for (const payload of facet.literalBlocks) {
    lines.push(renderPayload(payload), "");
  }
  return lines;
}
function renderPayload(payload: EmbeddedContent): string {
  const fence = "`".repeat(Math.max(3, payload.fenceLength));
  return `${fence}${payload.type ?? ""}\n${payload.rawBody}${
    /[\r\n]$/.test(payload.rawBody) ? "" : "\n"
  }${fence}`;
}
function formatDiagnostics(diagnostics: readonly SigilDiagnostic[]): string[] {
  return [
    "## Diagnostics",
    "",
    ...(diagnostics.length
      ? diagnostics.map((d) => `- ${d.severity} ${d.code}: ${d.message}`)
      : ["- none"]),
    "",
  ];
}
