import {
  type ImplementationSource,
  type OwnedImplementationTarget,
  ownedImplementationTargetsFor,
  type ResolvedComponent,
  type ResolvedConcept,
  type ResolvedSigilWorkspace,
  type SemanticUnit,
  type SigilFormKind,
  type SourceLocation,
  type SourceRange,
} from "@qoherent/sigil-core";
import type { DiagnosticSemanticSubject } from "./types.ts";

interface SemanticForm {
  readonly componentName: string;
  readonly filePath: string;
  readonly ownerKind: SigilFormKind;
  readonly ownerName: string;
  readonly range: SourceRange;
  readonly sections: ResolvedComponent["declaration"]["sections"];
}

interface OwnershipBinding {
  readonly target: OwnedImplementationTarget;
  readonly component: ResolvedComponent;
  readonly concept?: ResolvedConcept;
}

export interface SemanticSubjectResolver {
  resolve(
    filePath?: string,
    range?: SourceRange,
    componentHint?: string,
  ): Promise<readonly DiagnosticSemanticSubject[]>;
}

/*
 * @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::DiagnosticSemanticSubject interface
 * @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationDiagnostic logic
 * @sigil implements packages/compiler/src/report-protocol.sigil::SigilCompilationReportProtocol::CompilationReport cases
 */
export function createSemanticSubjectResolver(
  resolved: ResolvedSigilWorkspace,
  implementationSources: readonly ImplementationSource[],
  workspaceRoot: string,
): SemanticSubjectResolver {
  const forms = semanticForms(resolved, workspaceRoot);
  const ownershipCache = new Map<string, readonly OwnershipBinding[]>();

  return {
    async resolve(filePath, range, componentHint) {
      if (!filePath || !range) return [];
      const normalizedPath = canonicalWorkspacePath(filePath, workspaceRoot);
      const direct = await directSubjects(forms, normalizedPath, range.start);
      if (direct.length) return direct;

      const componentOrder = componentHint
        ? [
          ...resolved.components.filter((item) => item.name === componentHint),
          ...resolved.components.filter((item) => item.name !== componentHint),
        ]
        : resolved.components;
      for (const component of componentOrder) {
        let bindings = ownershipCache.get(componentKey(component));
        if (!bindings) {
          bindings = ownershipBindings(
            resolved,
            implementationSources,
            component,
          );
          ownershipCache.set(componentKey(component), bindings);
        }
        const matched = matchingOwnershipBindings(
          bindings,
          normalizedPath,
          range.start,
          workspaceRoot,
        );
        if (matched.length) {
          return deduplicateSubjects(
            matched.flatMap((binding) =>
              subjectsForOwnership(binding, forms, workspaceRoot)
            ),
          );
        }
      }
      return [];
    },
  };
}

function semanticForms(
  resolved: ResolvedSigilWorkspace,
  workspaceRoot: string,
): readonly SemanticForm[] {
  return resolved.components.flatMap((component) => [
    {
      componentName: component.name,
      filePath: canonicalWorkspacePath(component.filePath, workspaceRoot),
      ownerKind: "component" as const,
      ownerName: component.declaration.name,
      range: component.declaration.range,
      sections: component.declaration.sections,
    },
    ...component.expansions.expands.map((expansion) => ({
      componentName: component.name,
      filePath: canonicalWorkspacePath(expansion.filePath, workspaceRoot),
      ownerKind: "expand" as const,
      ownerName: expansion.declaration.name,
      range: expansion.declaration.range,
      sections: expansion.declaration.sections,
    })),
  ]);
}

async function directSubjects(
  forms: readonly SemanticForm[],
  filePath: string,
  location: SourceLocation,
): Promise<readonly DiagnosticSemanticSubject[]> {
  const subjects: DiagnosticSemanticSubject[] = [];
  for (
    const form of forms.filter((candidate) =>
      candidate.filePath === filePath &&
      rangeContains(candidate.range, location)
    )
  ) {
    const section = form.sections.find((candidate) =>
      rangeContains(candidate.range, location)
    );
    if (!section) continue;
    const concept = section.concepts.find((candidate) =>
      rangeContains(candidate.range, location)
    );
    const unit = [
      ...section.units,
      ...section.concepts.flatMap((candidate) => candidate.units),
    ].find((candidate) => rangeContains(candidate.range, location));
    subjects.push({
      relation: "direct",
      sigilPath: filePath,
      componentName: form.componentName,
      ownerKind: form.ownerKind,
      ownerName: form.ownerName,
      sectionName: section.name,
      conceptIdentifier: concept?.identifier ?? unit?.conceptIdentifier,
      semanticUnit: unit
        ? {
          range: unit.range,
          fingerprint: await semanticUnitFingerprint(unit),
        }
        : undefined,
    });
  }
  return deduplicateSubjects(subjects);
}

function ownershipBindings(
  resolved: ResolvedSigilWorkspace,
  implementationSources: readonly ImplementationSource[],
  component: ResolvedComponent,
): readonly OwnershipBinding[] {
  const all = ownedImplementationTargetsFor(
    resolved,
    implementationSources,
    { componentName: component.name, declarationPath: component.filePath },
  )?.targets ?? [];
  const conceptsByTarget = new Map<string, ResolvedConcept[]>();
  for (
    const concept of component.conceptNamespace.concepts.filter((item) =>
      !item.isImported
    )
  ) {
    const targets = ownedImplementationTargetsFor(
      resolved,
      implementationSources,
      { componentName: component.name, declarationPath: component.filePath },
      concept.identifier,
    )?.targets ?? [];
    for (const target of targets) {
      const key = ownershipTargetKey(target);
      conceptsByTarget.set(key, [
        ...(conceptsByTarget.get(key) ?? []),
        concept,
      ]);
    }
  }
  return all.flatMap((target) => {
    const concepts = conceptsByTarget.get(ownershipTargetKey(target));
    return concepts?.length
      ? concepts.map((concept) => ({ target, component, concept }))
      : [{ target, component }];
  });
}

function matchingOwnershipBindings(
  bindings: readonly OwnershipBinding[],
  filePath: string,
  location: SourceLocation,
  workspaceRoot: string,
): readonly OwnershipBinding[] {
  const sameFile = bindings.filter((binding) =>
    canonicalWorkspacePath(binding.target.filePath, workspaceRoot) === filePath
  );
  const fileWide = sameFile.filter((binding) => !binding.target.range);
  const positioned = sameFile.filter((binding) =>
    binding.target.range &&
    binding.target.range.start.line <= location.line
  );
  if (!positioned.length) return fileWide;
  const nearest = positioned.reduce((latest, binding) =>
    binding.target.range!.start.line > latest.target.range!.start.line
      ? binding
      : latest
  );
  return [
    ...fileWide,
    ...positioned.filter((binding) =>
      binding.target.range!.start.line === nearest.target.range!.start.line
    ),
  ];
}

function subjectsForOwnership(
  binding: OwnershipBinding,
  forms: readonly SemanticForm[],
  workspaceRoot: string,
): readonly DiagnosticSemanticSubject[] {
  const selectedSections = new Set<string>(binding.target.sections);
  if (binding.concept) {
    return binding.concept.occurrences.flatMap((occurrence) =>
      selectedSections.has(occurrence.sectionName)
        ? [{
          relation: "governing" as const,
          sigilPath: canonicalWorkspacePath(
            occurrence.filePath,
            workspaceRoot,
          ),
          componentName: occurrence.componentName,
          ownerKind: occurrence.ownerKind,
          ownerName: occurrence.componentName,
          sectionName: occurrence.sectionName,
          conceptIdentifier: binding.concept!.identifier,
        }]
        : []
    );
  }
  return forms.flatMap((form) =>
    form.componentName === binding.component.name
      ? form.sections.flatMap((section) =>
        selectedSections.has(section.name)
          ? [{
            relation: "governing" as const,
            sigilPath: form.filePath,
            componentName: form.componentName,
            ownerKind: form.ownerKind,
            ownerName: form.ownerName,
            sectionName: section.name,
          }]
          : []
      )
      : []
  );
}

function rangeContains(range: SourceRange, location: SourceLocation): boolean {
  return (compareLocations(range.start, location) <= 0 &&
    compareLocations(location, range.end) <= 0) ||
    (location.column === 1 &&
      range.start.line <= location.line &&
      location.line <= range.end.line);
}

function compareLocations(
  left: SourceLocation,
  right: SourceLocation,
): number {
  return left.line - right.line || left.column - right.column;
}

function semanticUnitFingerprint(unit: SemanticUnit): Promise<string> {
  return digest(JSON.stringify({
    prose: unit.prose,
    literals: unit.literalBlocks.map((literal) => ({
      type: literal.type,
      body: literal.body,
    })),
  }));
}

export function semanticSubjectIdentity(
  subject: DiagnosticSemanticSubject,
): Readonly<Record<string, unknown>> {
  return {
    relation: subject.relation,
    sigilPath: subject.sigilPath,
    componentName: subject.componentName,
    ownerKind: subject.ownerKind,
    ownerName: subject.ownerName,
    sectionName: subject.sectionName,
    conceptIdentifier: subject.conceptIdentifier,
    semanticUnitFingerprint: subject.semanticUnit?.fingerprint,
  };
}

function deduplicateSubjects(
  subjects: readonly DiagnosticSemanticSubject[],
): readonly DiagnosticSemanticSubject[] {
  const seen = new Set<string>();
  return subjects.filter((subject) => {
    const key = JSON.stringify(semanticSubjectIdentity(subject));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) =>
    left.sigilPath.localeCompare(right.sigilPath) ||
    left.componentName.localeCompare(right.componentName) ||
    left.sectionName.localeCompare(right.sectionName) ||
    (left.conceptIdentifier ?? "").localeCompare(
      right.conceptIdentifier ?? "",
    ) ||
    left.relation.localeCompare(right.relation)
  );
}

function ownershipTargetKey(target: OwnedImplementationTarget): string {
  return JSON.stringify({
    relation: target.relation,
    filePath: target.filePath,
    sections: target.sections,
    symbolIdentity: target.symbolIdentity,
    range: target.range,
  });
}

function componentKey(component: ResolvedComponent): string {
  return `${component.filePath}\0${component.name}`;
}

function canonicalWorkspacePath(path: string, root: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalizedRoot !== "." &&
    (normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`))
  ) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, "") || ".";
  }
  return normalized.replace(/^\.\//, "");
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
