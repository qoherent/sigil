import { sha256Canonical } from "./canonical.ts";
import { diagnostic } from "./diagnostics.ts";
import { stronglyConnectedComponentGroups } from "./graph.ts";
import { ownedImplementationTargetsFor } from "./implementation-ownership.ts";
import { dirname, normalizePath, relativePath } from "./path.ts";
import type {
  EvidenceKind,
  EvidenceUnit,
  ExcludedRelation,
  GlossaryProjection,
  ImplementationEvidenceInput,
  InclusionReason,
  PurposeRetrievalResult,
  PurposeRetrievalTarget,
  ResolvedComponent,
  ResolvedSigilWorkspace,
  RetrievalEdge,
  RetrievalNode,
  RetrievalNodeKind,
  RetrievalPurpose,
  RetrievalRelation,
  SemanticUnit,
  SigilDiagnostic,
  SigilSectionName,
  SourceRange,
} from "./model.ts";

const RELATION_ORDER: readonly RetrievalRelation[] = [
  "selected-declaration",
  "matching-expansion",
  "direct-dependency",
  "direct-importer",
  "containing-module-index",
  "cycle-member",
  "public-concept-origin",
  "owned-implementation",
];
const EVIDENCE_ORDER: readonly EvidenceKind[] = [
  "selected-contract",
  "selected-expansion",
  "dependency-contract",
  "dependency-decision",
  "importer-contract",
  "cycle-contract",
  "module-index-summary",
  "public-concept-origin",
  "glossary-definition",
  "ownership-projection",
  "implementation-source",
  "diagnostic",
];
const ERROR_MESSAGES = {
  SIGIL_RETRIEVAL_TARGET_PATH_INVALID:
    "The requested retrieval path is not a valid contained workspace-relative path.",
  SIGIL_RETRIEVAL_COMPONENT_NOT_FOUND:
    "The requested component name does not identify a loaded component.",
  SIGIL_RETRIEVAL_COMPONENT_IDENTITY_MISMATCH:
    "The requested component name and declaration path do not identify the same loaded component.",
  SIGIL_RETRIEVAL_FILE_NOT_FOUND:
    "The requested Sigil file is not loaded in the selected workspace.",
  SIGIL_RETRIEVAL_FILE_EMPTY:
    "The requested Sigil file represents no component.",
  SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE:
    "Implementation-source discovery is unavailable for this retrieval.",
  SIGIL_RETRIEVAL_IDENTITY_COLLISION:
    "Distinct retrieval items produced the same stable identity.",
  SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH:
    "Applicable auxiliary evidence belongs to a different workspace snapshot.",
} as const;
type RetrievalErrorCode = keyof typeof ERROR_MESSAGES;

interface NodeDraft {
  readonly kind: RetrievalNodeKind;
  readonly path: string;
  readonly componentName?: string;
  readonly range?: SourceRange;
  readonly classRank: number;
}
interface EdgeDraft {
  readonly relation: RetrievalRelation;
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly originPath: string;
  readonly originRange?: SourceRange;
}
interface EvidenceDraft {
  readonly kind: EvidenceKind;
  readonly path?: string;
  readonly componentName?: string;
  readonly sectionName?:
    | SigilSectionName
    | "interface"
    | "state"
    | "logic"
    | "constraints"
    | "cases";
  readonly conceptIdentity?: string;
  readonly range?: SourceRange;
  readonly text: string;
  readonly rule: string;
  readonly seedKey: string;
  readonly edgeKeys: readonly string[];
}

// @sigil implements packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalRequest interface,logic,constraints,cases
export async function retrievePurposeContext(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalTarget,
  purpose: RetrievalPurpose,
  glossaryEvidence: GlossaryProjection | null = resolved.glossary,
  implementationEvidence: ImplementationEvidenceInput | null = null,
): Promise<PurposeRetrievalResult> {
  const requestedPath = target.path;
  const acceptedPath = validateRelativePath(requestedPath);
  const targetIdentity = {
    kind: target.kind,
    ...(target.kind === "component"
      ? { componentName: target.componentName }
      : {}),
    pathStatus: acceptedPath === undefined
      ? "rejected" as const
      : "accepted" as const,
    path: acceptedPath ?? requestedPath,
  };
  if (acceptedPath === undefined) {
    return failure(
      resolved,
      targetIdentity,
      purpose,
      "SIGIL_RETRIEVAL_TARGET_PATH_INVALID",
    );
  }

  const relativeComponentPath = (component: ResolvedComponent) =>
    relativePath(resolved.workspace.root, component.filePath);
  let seeds: ResolvedComponent[];
  if (target.kind === "component") {
    const named = resolved.components.find((component) =>
      component.name === target.componentName
    );
    if (!named) {
      return failure(
        resolved,
        targetIdentity,
        purpose,
        "SIGIL_RETRIEVAL_COMPONENT_NOT_FOUND",
      );
    }
    if (relativeComponentPath(named) !== acceptedPath) {
      return failure(
        resolved,
        targetIdentity,
        purpose,
        "SIGIL_RETRIEVAL_COMPONENT_IDENTITY_MISMATCH",
      );
    }
    seeds = [named];
  } else {
    const loaded = resolved.workspace.files.find((file) =>
      relativePath(resolved.workspace.root, file.path) === acceptedPath
    );
    if (!loaded) {
      return failure(
        resolved,
        targetIdentity,
        purpose,
        "SIGIL_RETRIEVAL_FILE_NOT_FOUND",
      );
    }
    seeds = resolved.components.filter((component) =>
      relativeComponentPath(component) === acceptedPath ||
      component.expansions.expands.some((expand) =>
        relativePath(resolved.workspace.root, expand.filePath) === acceptedPath
      )
    );
    if (!seeds.length) {
      return failure(
        resolved,
        targetIdentity,
        purpose,
        "SIGIL_RETRIEVAL_FILE_EMPTY",
      );
    }
    seeds = uniqueComponents(seeds);
  }
  const snapshot = resolved.workspace.workspaceSnapshotIdentity;
  if (
    glossaryEvidence && glossaryEvidence.workspaceSnapshotIdentity !== snapshot
  ) {
    return failure(
      resolved,
      targetIdentity,
      purpose,
      "SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH",
    );
  }
  if (
    purpose === "implementation" && implementationEvidence &&
    implementationEvidence.workspaceSnapshotIdentity !== snapshot
  ) {
    return failure(
      resolved,
      targetIdentity,
      purpose,
      "SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH",
    );
  }

  const nodes = new Map<string, NodeDraft>();
  const edges = new Map<string, EdgeDraft>();
  const evidence: EvidenceDraft[] = [];
  const componentKey = (component: ResolvedComponent) =>
    `component\0${relativeComponentPath(component)}\0${component.name}`;
  const addNode = (key: string, draft: NodeDraft) => {
    const prior = nodes.get(key);
    if (!prior || draft.classRank < prior.classRank) nodes.set(key, draft);
    return key;
  };
  const requestKey = addNode(
    `request\0${target.kind}\0${acceptedPath}\0${
      target.kind === "component" ? target.componentName : ""
    }`,
    {
      kind: "request-target",
      path: acceptedPath,
      componentName: target.kind === "component"
        ? target.componentName
        : undefined,
      classRank: 0,
    },
  );
  const selected = new Map<
    string,
    {
      component: ResolvedComponent;
      role: "seed" | "dependency" | "importer" | "cycle";
    }
  >();
  for (const seed of seeds) {
    selected.set(componentKey(seed), { component: seed, role: "seed" });
  }

  const addComponent = (
    component: ResolvedComponent,
    role: "seed" | "dependency" | "importer" | "cycle",
  ) => {
    const key = componentKey(component);
    const rank = role === "seed"
      ? 0
      : role === "dependency"
      ? 3
      : role === "importer"
      ? 4
      : 5;
    addNode(key, {
      kind: "component-declaration",
      path: relativeComponentPath(component),
      componentName: component.name,
      range: component.declaration.range,
      classRank: rank,
    });
    if (!selected.has(key)) selected.set(key, { component, role });
    return key;
  };
  const addEdge = (draft: EdgeDraft) => {
    const key = [
      draft.relation,
      draft.sourceKey,
      draft.targetKey,
      draft.originPath,
      rangeKey(draft.originRange),
    ].join("\0");
    edges.set(key, draft);
    return key;
  };
  for (const seed of seeds) {
    const seedKey = addComponent(seed, "seed");
    addEdge({
      relation: "selected-declaration",
      sourceKey: requestKey,
      targetKey: seedKey,
      originPath: relativeComponentPath(seed),
      originRange: seed.declaration.range,
    });
    addContractEvidence(
      evidence,
      seed,
      "selected-contract",
      "select-target",
      seedKey,
      [],
      ["goal", "interface"],
    );
    for (const expansion of seed.expansions.expands) {
      const path = relativePath(resolved.workspace.root, expansion.filePath);
      const expandKey = addNode(
        `expand\0${path}\0${seed.name}\0${
          rangeKey(expansion.declaration.range)
        }`,
        {
          kind: "expansion",
          path,
          componentName: seed.name,
          range: expansion.declaration.range,
          classRank: 2,
        },
      );
      const edgeKey = addEdge({
        relation: "matching-expansion",
        sourceKey: seedKey,
        targetKey: expandKey,
        originPath: path,
        originRange: expansion.declaration.range,
      });
      addDeclarationEvidence(
        evidence,
        expansion.declaration.sections.flatMap((section) => section.units),
        "selected-expansion",
        seed.name,
        "select-seed-expansion",
        seedKey,
        [edgeKey],
      );
    }
  }

  const initialSeeds = [...seeds];
  for (const seed of initialSeeds) {
    const seedKey = componentKey(seed);
    for (
      const resolvedImport of resolved.imports.filter((item) =>
        item.sourceFile === seed.filePath ||
        seed.expansions.expands.some((expand) =>
          expand.filePath === item.sourceFile
        )
      )
    ) {
      for (const name of resolvedImport.names) {
        if (
          !name.componentFile ||
          !name.uses.some((use) =>
            use.ownerName === seed.name &&
            (use.ownerKind === "component" || use.ownerKind === "expand") &&
            use.kind !== "module-index-surface"
          )
        ) continue;
        const dependency = resolved.components.find((component) =>
          component.name === name.name &&
          component.filePath === name.componentFile
        );
        if (!dependency) continue;
        const dependencyKey = addComponent(dependency, "dependency");
        const edgeKey = addEdge({
          relation: "direct-dependency",
          sourceKey: seedKey,
          targetKey: dependencyKey,
          originPath: relativePath(
            resolved.workspace.root,
            resolvedImport.sourceFile,
          ),
          originRange: resolvedImport.declaration.range,
        });
        addContractEvidence(
          evidence,
          dependency,
          "dependency-contract",
          "select-direct-dependency",
          seedKey,
          [edgeKey],
          ["goal", "interface"],
        );
        for (const expansion of dependency.expansions.expands) {
          addDeclarationEvidence(
            evidence,
            expansion.declaration.sections.filter((section) =>
              section.name === "decisions"
            ).flatMap((section) => section.units),
            "dependency-decision",
            dependency.name,
            "select-direct-dependency",
            seedKey,
            [edgeKey],
          );
        }
      }
    }
    for (const resolvedImport of resolved.imports) {
      for (
        const name of resolvedImport.names.filter((item) =>
          item.name === seed.name && item.componentFile === seed.filePath
        )
      ) {
        const owners = uniqueComponents(
          name.uses.flatMap((use) =>
            resolved.components.filter((component) =>
              component.name === use.ownerName &&
              (component.filePath === use.filePath ||
                component.expansions.expands.some((expand) =>
                  expand.filePath === use.filePath
                ))
            )
          ),
        );
        if (!owners.length) {
          const filePath = relativePath(
            resolved.workspace.root,
            resolvedImport.sourceFile,
          );
          const fileKey = addNode(`file\0${filePath}`, {
            kind: "sigil-file",
            path: filePath,
            classRank: 4,
          });
          addEdge({
            relation: "direct-importer",
            sourceKey: seedKey,
            targetKey: fileKey,
            originPath: filePath,
            originRange: resolvedImport.declaration.range,
          });
        }
        for (const importer of owners) {
          const importerKey = addComponent(importer, "importer");
          const edgeKey = addEdge({
            relation: "direct-importer",
            sourceKey: seedKey,
            targetKey: importerKey,
            originPath: relativePath(
              resolved.workspace.root,
              resolvedImport.sourceFile,
            ),
            originRange: resolvedImport.declaration.range,
          });
          addContractEvidence(
            evidence,
            importer,
            "importer-contract",
            "select-direct-importer",
            seedKey,
            [edgeKey],
            ["goal", "interface"],
          );
        }
      }
    }
  }

  if (purpose !== "semantic") {
    const reached = new Set(selected.keys());
    for (const group of stronglyConnectedComponentGroups(resolved.graph)) {
      if (
        !group.some((identity) =>
          reached.has(
            `component\0${
              relativePath(resolved.workspace.root, identity.declarationPath)
            }\0${identity.componentName}`,
          )
        )
      ) continue;
      const members = group.map((identity) =>
        resolved.components.find((component) =>
          component.name === identity.componentName &&
          component.filePath === identity.declarationPath
        )
      ).filter((item): item is ResolvedComponent => !!item);
      const cyclic = members.length > 1 ||
        resolved.graph.importedComponentEdges.some((edge) =>
          edge.sourceComponents.some((source) =>
            source.componentName === members[0]?.name &&
            source.declarationPath === members[0]?.filePath
          ) && edge.componentName === members[0]?.name &&
          edge.targetFile === members[0]?.filePath
        );
      if (!cyclic) continue;
      for (const member of members) {
        const memberKey = addComponent(member, "cycle");
        const anchor = seeds[0];
        const anchorKey = componentKey(anchor);
        const edgeKey = addEdge({
          relation: "cycle-member",
          sourceKey: anchorKey,
          targetKey: memberKey,
          originPath: relativeComponentPath(member),
          originRange: member.declaration.range,
        });
        addContractEvidence(
          evidence,
          member,
          "cycle-contract",
          "select-cycle-member",
          anchorKey,
          [edgeKey],
          ["goal", "interface"],
        );
        for (const expansion of member.expansions.expands) {
          const path = relativePath(
            resolved.workspace.root,
            expansion.filePath,
          );
          const expandKey = addNode(
            `expand\0${path}\0${member.name}\0${
              rangeKey(expansion.declaration.range)
            }`,
            {
              kind: "expansion",
              path,
              componentName: member.name,
              range: expansion.declaration.range,
              classRank: 5,
            },
          );
          addEdge({
            relation: "matching-expansion",
            sourceKey: memberKey,
            targetKey: expandKey,
            originPath: path,
            originRange: expansion.declaration.range,
          });
          addDeclarationEvidence(
            evidence,
            expansion.declaration.sections.flatMap((section) => section.units),
            "cycle-contract",
            member.name,
            "select-cycle-member",
            anchorKey,
            [edgeKey],
          );
        }
      }
    }
    for (const { component, role } of [...selected.values()]) {
      const module = containingModuleComponent(resolved, component);
      if (!module) continue;
      const sourceKey = componentKey(component);
      const modulePath = relativeComponentPath(module);
      const moduleKey = addNode(`module\0${modulePath}\0${module.name}`, {
        kind: "module-index",
        path: modulePath,
        componentName: module.name,
        range: module.declaration.range,
        classRank: 6,
      });
      const edgeKey = addEdge({
        relation: "containing-module-index",
        sourceKey,
        targetKey: moduleKey,
        originPath: modulePath,
        originRange: module.declaration.range,
      });
      addContractEvidence(
        evidence,
        module,
        "module-index-summary",
        "select-module-index",
        componentKey(seeds[0]),
        [edgeKey],
        ["goal", "interface", "constraints", "decisions"],
      );
      if (role === "seed") {
        for (
          const concept of component.conceptNamespace.accessibleConcepts.filter(
            (item) => item.isImported && item.isPublic,
          )
        ) {
          const provider = resolved.components.find((candidate) =>
            candidate.name === concept.identity.componentName &&
            candidate.filePath === concept.identity.filePath
          );
          if (!provider) continue;
          const providerKey = addComponent(provider, "dependency");
          const occurrence = concept.occurrences[0];
          if (!occurrence) continue;
          const originKey = addNode(
            `concept\0${concept.identity.filePath}\0${concept.identifier}\0${
              rangeKey(occurrence.block.range)
            }`,
            {
              kind: "public-concept-origin",
              path: relativePath(
                resolved.workspace.root,
                concept.identity.filePath,
              ),
              componentName: provider.name,
              range: occurrence.block.range,
              classRank: 7,
            },
          );
          const conceptEdge = addEdge({
            relation: "public-concept-origin",
            sourceKey,
            targetKey: originKey,
            originPath: relativePath(
              resolved.workspace.root,
              concept.identity.filePath,
            ),
            originRange: occurrence.block.range,
          });
          addContractEvidence(
            evidence,
            provider,
            "public-concept-origin",
            "select-public-concept-origin",
            componentKey(component),
            [conceptEdge],
            ["goal", "interface"],
          );
          void providerKey;
        }
      }
    }
  }

  let unavailableImplementation = false;
  if (purpose === "implementation") {
    unavailableImplementation = !implementationEvidence ||
      implementationEvidence.discoveryState === "unavailable";
    if (!unavailableImplementation) {
      for (const { component } of selected.values()) {
        const projection = ownedImplementationTargetsFor(
          resolved,
          implementationEvidence!.sources,
          {
            componentName: component.name,
            declarationPath: component.filePath,
          },
        );
        if (!projection) {
          continue;
        }
        for (const owned of projection.targets) {
          const source = implementationEvidence!.sources.find((item) =>
            normalizePath(item.filePath) === normalizePath(owned.filePath) ||
            relativePath(resolved.workspace.root, item.filePath) ===
              owned.filePath
          );
          const targetRange = owned.targetRange ?? owned.range;
          if (!source || !targetRange) continue;
          const sourcePath = normalizeRelativeSource(resolved, source.filePath);
          const ownerKey = componentKey(component);
          const targetKey = addNode(
            `implementation\0${sourcePath}\0${owned.symbolIdentity ?? ""}\0${
              rangeKey(targetRange)
            }`,
            {
              kind: "implementation-target",
              path: sourcePath,
              componentName: component.name,
              range: targetRange,
              classRank: 8,
            },
          );
          const edgeKey = addEdge({
            relation: "owned-implementation",
            sourceKey: ownerKey,
            targetKey,
            originPath: sourcePath,
            originRange: owned.annotationRange,
          });
          evidence.push({
            kind: "ownership-projection",
            path: sourcePath,
            componentName: component.name,
            range: owned.annotationRange,
            text: `${owned.relation} ${component.name}${
              owned.symbolIdentity ? ` at ${owned.symbolIdentity}` : ""
            }`,
            rule: "select-owned-implementation",
            seedKey: componentKey(seeds[0]),
            edgeKeys: [edgeKey],
          });
          evidence.push({
            kind: "implementation-source",
            path: sourcePath,
            componentName: component.name,
            range: targetRange,
            text: textForRange(source.text, targetRange),
            rule: "select-owned-implementation",
            seedKey: componentKey(seeds[0]),
            edgeKeys: [edgeKey],
          });
        }
      }
    }
  }

  if (glossaryEvidence) addGlossaryEvidence(evidence, glossaryEvidence);
  return await materialize(
    resolved,
    targetIdentity,
    purpose,
    nodes,
    edges,
    evidence,
    unavailableImplementation
      ? [
        retrievalDiagnostic(
          "SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE",
        ),
        ...(implementationEvidence?.diagnostics ?? []),
      ]
      : [],
    unavailableImplementation,
  );
}

function addContractEvidence(
  out: EvidenceDraft[],
  component: ResolvedComponent,
  kind: EvidenceKind,
  rule: string,
  seedKey: string,
  edgeKeys: readonly string[],
  sections: readonly SigilSectionName[],
) {
  addDeclarationEvidence(
    out,
    component.declaration.sections.filter((section) =>
      sections.includes(section.name)
    ).flatMap((section) => section.units),
    kind,
    component.name,
    rule,
    seedKey,
    edgeKeys,
  );
}
function addDeclarationEvidence(
  out: EvidenceDraft[],
  units: readonly SemanticUnit[],
  kind: EvidenceKind,
  componentName: string,
  rule: string,
  seedKey: string,
  edgeKeys: readonly string[],
) {
  const groups = new Map<string, SemanticUnit[]>();
  for (const unit of units.filter((item) => item.prose.trim())) {
    const key = [
      unit.filePath,
      unit.ownerKind,
      unit.ownerName,
      unit.sectionName,
    ]
      .join("\0");
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }
  for (const group of groups.values()) {
    group.sort((left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.column - right.range.start.column
    );
    const concepts = new Set(group.map((unit) => unit.conceptIdentifier));
    out.push({
      kind,
      path: group[0].filePath,
      componentName,
      sectionName: group[0].sectionName,
      conceptIdentity: concepts.size === 1
        ? group[0].conceptIdentifier
        : undefined,
      range: {
        start: group[0].range.start,
        end: group[group.length - 1].range.end,
      },
      text: group.map((unit) => unit.prose).join("\n"),
      rule,
      seedKey,
      edgeKeys,
    });
  }
}
function addGlossaryEvidence(
  out: EvidenceDraft[],
  glossary: GlossaryProjection,
) {
  const semantic = [...out];
  for (
    const occurrence of glossary.occurrences.filter((item) =>
      item.term.agentContext
    )
  ) {
    const trigger = semantic.find((item) =>
      item.path === occurrence.filePath && item.range &&
      overlaps(item.range, occurrence.range)
    );
    if (
      !trigger || out.some((item) =>
        item.kind === "glossary-definition" &&
        item.text.startsWith(`${occurrence.term.term}:`)
      )
    ) continue;
    out.push({
      kind: "glossary-definition",
      path: glossary.glossaryPath,
      range: occurrence.term.declarationRange,
      text: `${occurrence.term.term}: ${occurrence.term.definition}`,
      rule: "select-glossary-term",
      seedKey: trigger.seedKey,
      edgeKeys: trigger.edgeKeys,
    });
  }
}

async function materialize(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalResult["target"],
  purpose: RetrievalPurpose,
  nodeDrafts: Map<string, NodeDraft>,
  edgeDrafts: Map<string, EdgeDraft>,
  evidenceDrafts: EvidenceDraft[],
  diagnostics: readonly SigilDiagnostic[],
  incomplete: boolean,
): Promise<PurposeRetrievalResult> {
  const nodeEntries = await Promise.all(
    [...nodeDrafts].map(async ([key, draft]) =>
      [
        key,
        {
          identity: `n:${await sha256Canonical({
            kind: draft.kind,
            path: draft.path,
            componentName: draft.componentName,
            range: draft.range,
          })}`,
          kind: draft.kind,
          path: draft.path,
          componentName: draft.componentName,
          range: draft.range,
        } satisfies RetrievalNode,
        draft,
      ] as const
    ),
  );
  nodeEntries.sort((a, b) =>
    a[2].classRank - b[2].classRank || compareLocated(a[1], b[1])
  );
  const nodeByKey = new Map(nodeEntries.map(([key, node]) => [key, node]));
  const edgeEntries = await Promise.all(
    [...edgeDrafts].map(async ([key, draft]) =>
      [
        key,
        {
          identity: `e:${await sha256Canonical({
            relation: draft.relation,
            sourceIdentity: nodeByKey.get(draft.sourceKey)!.identity,
            targetIdentity: nodeByKey.get(draft.targetKey)!.identity,
            originPath: draft.originPath,
            originRange: draft.originRange,
          })}`,
          relation: draft.relation,
          sourceIdentity: nodeByKey.get(draft.sourceKey)!.identity,
          targetIdentity: nodeByKey.get(draft.targetKey)!.identity,
          originPath: draft.originPath,
          originRange: draft.originRange,
        } satisfies RetrievalEdge,
      ] as const
    ),
  );
  const nodeOrder = new Map(
    nodeEntries.map(([, node], index) => [node.identity, index]),
  );
  edgeEntries.sort((a, b) =>
    nodeOrder.get(a[1].sourceIdentity)! - nodeOrder.get(b[1].sourceIdentity)! ||
    RELATION_ORDER.indexOf(a[1].relation) -
      RELATION_ORDER.indexOf(b[1].relation) ||
    nodeOrder.get(a[1].targetIdentity)! - nodeOrder.get(b[1].targetIdentity)! ||
    a[1].identity.localeCompare(b[1].identity)
  );
  const edgeByKey = new Map(edgeEntries);
  const evidenceBase = await Promise.all(evidenceDrafts.map(async (draft) => ({
    draft,
    unit: {
      identity: `v:${await sha256Canonical({
        kind: draft.kind,
        path: draft.path,
        componentName: draft.componentName,
        sectionName: draft.sectionName,
        conceptIdentity: draft.conceptIdentity,
        range: draft.range,
      })}`,
      kind: draft.kind,
      path: draft.path,
      componentName: draft.componentName,
      sectionName: draft.sectionName,
      conceptIdentity: draft.conceptIdentity,
      range: draft.range,
      text: draft.text,
      inclusionReasonIdentities: [],
    } satisfies EvidenceUnit,
  })));
  const uniqueEvidence = [
    ...new Map(evidenceBase.map((item) => [item.unit.identity, item])).values(),
  ];
  uniqueEvidence.sort((a, b) =>
    EVIDENCE_ORDER.indexOf(a.unit.kind) - EVIDENCE_ORDER.indexOf(b.unit.kind) ||
    compareLocated(a.unit, b.unit)
  );
  const reasons: InclusionReason[] = [];
  for (const item of uniqueEvidence) {
    const seedIdentity = nodeByKey.get(item.draft.seedKey)?.identity ??
      nodeEntries[0][1].identity;
    const edgeIdentities = item.draft.edgeKeys.map((key) =>
      edgeByKey.get(key)?.identity
    ).filter((value): value is string => !!value);
    const reasonObject = {
      rule: item.draft.rule,
      seedIdentity,
      selectedIdentity: item.unit.identity,
      edgeIdentities,
    };
    reasons.push({
      identity: `r:${await sha256Canonical(reasonObject)}`,
      ...reasonObject,
    });
  }
  const uniqueReasons = [
    ...new Map(reasons.map((reason) => [reason.identity, reason])).values(),
  ].sort((a, b) =>
    a.selectedIdentity.localeCompare(b.selectedIdentity) ||
    a.rule.localeCompare(b.rule) || a.identity.localeCompare(b.identity)
  );
  const reasonByEvidence = new Map<string, string[]>();
  for (const reason of uniqueReasons) {
    reasonByEvidence.set(reason.selectedIdentity, [
      ...(reasonByEvidence.get(reason.selectedIdentity) ?? []),
      reason.identity,
    ]);
  }
  const evidence = uniqueEvidence.map(({ unit }) => ({
    ...unit,
    inclusionReasonIdentities: reasonByEvidence.get(unit.identity) ?? [],
  }));
  const exclusions = await exclusionFrontier(
    resolved,
    nodeEntries.map(([, node]) => node),
    edgeEntries.map(([, edge]) => edge),
  );
  const collision = hasIdentityCollision([
    ...nodeEntries.map(([, item]) => item),
    ...edgeEntries.map(([, item]) => item),
    ...evidence,
    ...uniqueReasons,
    ...exclusions,
  ]);
  if (collision) {
    return failure(
      resolved,
      target,
      purpose,
      "SIGIL_RETRIEVAL_IDENTITY_COLLISION",
    );
  }
  const base = {
    schema: "sigil-purpose-retrieval/v1" as const,
    policyVersion: 1 as const,
    workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
    target,
    purpose,
    graph: {
      nodes: nodeEntries.map(([, node]) => node),
      edges: edgeEntries.map(([, edge]) => edge),
    },
    evidence,
    inclusionReasons: uniqueReasons,
    exclusions,
    context: {
      sections: evidence.map((unit) => ({
        kind: unit.kind,
        text: unit.text,
        evidenceIdentity: unit.identity,
        inclusionReasonIdentities: unit.inclusionReasonIdentities,
      })),
    },
    diagnostics: [...diagnostics],
  };
  return {
    ...base,
    fingerprint: `sha256:${await sha256Canonical({ ...base, incomplete })}`,
  };
}

async function exclusionFrontier(
  resolved: ResolvedSigilWorkspace,
  nodes: readonly RetrievalNode[],
  selectedEdges: readonly RetrievalEdge[],
): Promise<ExcludedRelation[]> {
  const selectedComponents = new Set(
    nodes.filter((node) => node.kind === "component-declaration").map((node) =>
      `${node.path}\0${node.componentName}`
    ),
  );
  const selectedEdgeOrigins = new Set(
    selectedEdges.map((edge) => `${edge.originPath}\0${edge.relation}`),
  );
  const out: ExcludedRelation[] = [];
  for (const edge of resolved.graph.importedComponentEdges) {
    for (const source of edge.sourceComponents) {
      const sourcePath = relativePath(
        resolved.workspace.root,
        source.declarationPath,
      );
      const targetPath = relativePath(resolved.workspace.root, edge.targetFile);
      if (
        !selectedComponents.has(`${sourcePath}\0${source.componentName}`) ||
        selectedComponents.has(`${targetPath}\0${edge.componentName}`) ||
        selectedEdgeOrigins.has(
          `${
            relativePath(resolved.workspace.root, edge.sourceFile)
          }\0direct-dependency`,
        )
      ) {
        continue;
      }
      const sourceNode = nodes.find((node) =>
        node.path === sourcePath && node.componentName === source.componentName
      );
      if (!sourceNode) continue;
      const frontierIdentity = `e:${await sha256Canonical({
        relation: "direct-dependency",
        sourceIdentity: sourceNode.identity,
        targetIdentity: `${targetPath}\0${edge.componentName}`,
        originPath: relativePath(resolved.workspace.root, edge.sourceFile),
        originRange: edge.originRange,
      })}`;
      const object = {
        rule: "exclude-transitive-dependency",
        edgeIdentity: frontierIdentity,
        sourceIdentity: sourceNode.identity,
        targetIdentity: `${targetPath}\0${edge.componentName}`,
      };
      out.push({ identity: `x:${await sha256Canonical(object)}`, ...object });
    }
  }
  return out.sort((a, b) => a.identity.localeCompare(b.identity));
}

async function failure(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalResult["target"],
  purpose: RetrievalPurpose,
  code: RetrievalErrorCode,
): Promise<PurposeRetrievalResult> {
  const base = {
    schema: "sigil-purpose-retrieval/v1" as const,
    policyVersion: 1 as const,
    workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
    target,
    purpose,
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [retrievalDiagnostic(code)],
  };
  return { ...base, fingerprint: `sha256:${await sha256Canonical(base)}` };
}
function retrievalDiagnostic(code: RetrievalErrorCode): SigilDiagnostic {
  return diagnostic(code, ERROR_MESSAGES[code]);
}
function validateRelativePath(path: string): string | undefined {
  if (
    !path || path.includes("\0") || path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) return undefined;
  const raw = path.replaceAll("\\", "/");
  let depth = 0;
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (--depth < 0) return undefined; }
    else depth++;
  }
  const normalized = normalizePath(raw);
  return normalized === "." || normalized.startsWith("../")
    ? undefined
    : normalized;
}
function uniqueComponents(
  items: readonly ResolvedComponent[],
): ResolvedComponent[] {
  return [
    ...new Map(items.map((item) => [`${item.filePath}\0${item.name}`, item]))
      .values(),
  ].sort((a, b) =>
    a.filePath.localeCompare(b.filePath) ||
    a.declaration.range.start.line - b.declaration.range.start.line ||
    a.declaration.range.start.column - b.declaration.range.start.column ||
    a.name.localeCompare(b.name)
  );
}
function containingModuleComponent(
  resolved: ResolvedSigilWorkspace,
  component: ResolvedComponent,
): ResolvedComponent | undefined {
  let directory = dirname(component.filePath);
  while (true) {
    const modulePath = `${directory}/_module.sigil`;
    const found = resolved.components.find((candidate) =>
      candidate.filePath === modulePath
    );
    if (found) return found;
    if (
      directory === resolved.workspace.root || directory === "." ||
      directory === "/"
    ) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
function normalizeRelativeSource(
  resolved: ResolvedSigilWorkspace,
  path: string,
): string {
  const normalized = normalizePath(path);
  return normalized.startsWith(normalizePath(resolved.workspace.root))
    ? relativePath(resolved.workspace.root, normalized)
    : normalized.replace(/^\.\//, "");
}
function rangeKey(range?: SourceRange): string {
  return range
    ? `${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}`
    : "";
}
function compareLocated(
  a: {
    path?: string;
    range?: SourceRange;
    componentName?: string;
    identity: string;
  },
  b: {
    path?: string;
    range?: SourceRange;
    componentName?: string;
    identity: string;
  },
): number {
  return (a.path ?? "").localeCompare(b.path ?? "") ||
    Number(!!a.range) - Number(!!b.range) ||
    (a.range?.start.line ?? 0) - (b.range?.start.line ?? 0) ||
    (a.range?.start.column ?? 0) - (b.range?.start.column ?? 0) ||
    (a.componentName ?? "").localeCompare(b.componentName ?? "") ||
    a.identity.localeCompare(b.identity);
}
function overlaps(a: SourceRange, b: SourceRange): boolean {
  const start = (range: SourceRange) =>
    range.start.line * 1_000_000 + range.start.column;
  const end = (range: SourceRange) =>
    range.end.line * 1_000_000 + range.end.column;
  return start(a) <= end(b) && start(b) <= end(a);
}
function textForRange(text: string, range: SourceRange): string {
  const lines = text.split(/\r?\n/);
  if (range.start.line === range.end.line) {
    return (lines[range.start.line - 1] ?? "").slice(
      range.start.column - 1,
      range.end.column - 1,
    );
  }
  return lines.slice(range.start.line - 1, range.end.line).map((
    line,
    index,
    all,
  ) =>
    index === 0
      ? line.slice(range.start.column - 1)
      : index === all.length - 1
      ? line.slice(0, range.end.column - 1)
      : line
  ).join("\n");
}
function hasIdentityCollision(items: readonly { identity: string }[]): boolean {
  return new Set(items.map((item) => item.identity)).size !== items.length;
}
