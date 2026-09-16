import { canonicalJson, sha256Bytes, sha256Canonical } from "./canonical.ts";
import {
  compareScalarText,
  diagnostic,
  orderDiagnostics,
} from "./diagnostics.ts";
import { glossaryContextForFiles } from "./glossary.ts";
import { stronglyConnectedComponentGroups } from "./graph.ts";
import {
  isSupportedImplementationSource,
  ownedImplementationTargetsFor,
} from "./implementation-ownership.ts";
import { normalizeImportPath, normalizePath } from "./path.ts";
import {
  RetrievalIdentityCollision,
  RetrievalIdentityRegistry,
} from "./retrieval-identity.ts";
import { SourceProvenance } from "./source-provenance.ts";
import type { GlossaryProjection } from "./model/glossary.ts";
import type { ImplementationEvidenceInput } from "./model/ownership.ts";
import type { SigilDiagnostic } from "./model/diagnostics.ts";
import type { SourceRange } from "./model/language.ts";
import type {
  ResolvedComponent,
  ResolvedSigilWorkspace,
} from "./model/resolution.ts";
import type { Facet } from "./model/source.ts";
import type {
  EvidenceKind,
  EvidenceUnit,
  ExcludedRelation,
  InclusionReason,
  PurposeRetrievalResult,
  PurposeRetrievalTarget,
  RetrievalBudgetReport,
  RetrievalEdge,
  RetrievalNode,
  RetrievalPurpose,
  RetrievalRelation,
} from "./model/retrieval.ts";
export { projectRetrieval } from "./retrieval-projection.ts";

const RELATIONS: readonly RetrievalRelation[] = [
  "selected-declaration",
  "direct-dependency",
  "direct-importer",
  "cycle-member",
  "tag-origin",
  "owned-implementation",
];
const KINDS: readonly EvidenceKind[] = [
  "selected-contract",
  "dependency-contract",
  "dependency-decision",
  "importer-contract",
  "cycle-contract",
  "tag-origin",
  "glossary-definition",
  "ownership-projection",
  "diagnostic",
];
const RULES = [
  "select-target",
  "select-direct-dependency",
  "select-direct-importer",
  "select-cycle-member",
  "select-tag-origin",
  "select-owned-implementation",
  "select-glossary-term",
];
const EXCLUSION_RULES = [
  "exclude-transitive-dependency",
  "exclude-transitive-importer",
  "exclude-cycle-outward",
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

type NodeValue = Omit<RetrievalNode, "identity">;
type EdgeValue =
  & Omit<RetrievalEdge, "identity" | "sourceIdentity" | "targetIdentity">
  & { sourceKey: string; targetKey: string };
type EvidenceValue = Omit<
  EvidenceUnit,
  "identity" | "inclusionReasonIdentities"
>;
interface ReasonDraft {
  readonly rule: string;
  readonly seedKey: string;
  readonly anchorKey: string;
  readonly triggerKey?: string;
}
interface Candidate {
  value: EvidenceValue;
  reasons: ReasonDraft[];
}
interface NodeDraft {
  value: NodeValue;
  rank: number;
}
export interface PurposeRetrievalOptions {
  readonly maxEvidenceBytes?: number;
}
/*
 * @sigil implements packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalRequest interface
 * @sigil implements packages/core/src/context-retrieval.sigil::SigilContextRetrieval logic,constraints,cases
 */
export async function retrievePurposeContext(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalTarget,
  purpose: RetrievalPurpose,
  glossaryEvidence: GlossaryProjection | null = resolved.glossary,
  implementationEvidence: ImplementationEvidenceInput | null = null,
  options: PurposeRetrievalOptions = {},
): Promise<PurposeRetrievalResult> {
  const accepted = target.path && !target.path.includes("\0")
    ? normalizeImportPath(target.path)
    : undefined;
  const targetIdentity: PurposeRetrievalResult["target"] = {
    kind: target.kind,
    ...(target.kind === "component"
      ? { componentName: target.componentName }
      : {}),
    pathStatus: accepted === undefined ? "rejected" : "accepted",
    path: accepted ?? target.path,
  };
  const fail = (code: RetrievalErrorCode) =>
    failure(resolved, targetIdentity, purpose, code);
  if (accepted === undefined) {
    return fail("SIGIL_RETRIEVAL_TARGET_PATH_INVALID");
  }
  const provenance = new SourceProvenance(resolved.workspace.root);
  const path = (value: string) => provenance.path(normalizePath(value));
  let seeds: ResolvedComponent[];
  if (target.kind === "component") {
    const named = resolved.components.filter((c) =>
      c.name === target.componentName
    );
    if (!named.length) return fail("SIGIL_RETRIEVAL_COMPONENT_NOT_FOUND");
    if (
      named.length !== 1 || !named[0].identity ||
      path(named[0].filePath) !== accepted
    ) return fail("SIGIL_RETRIEVAL_COMPONENT_IDENTITY_MISMATCH");
    seeds = named;
  } else {
    if (!resolved.workspace.files.some((f) => path(f.path) === accepted)) {
      return fail("SIGIL_RETRIEVAL_FILE_NOT_FOUND");
    }
    seeds = resolved.components.filter((c) => path(c.filePath) === accepted);
    if (!seeds.length) return fail("SIGIL_RETRIEVAL_FILE_EMPTY");
  }
  seeds = [...seeds].sort((a, b) =>
    compareScalarText(path(a.filePath), path(b.filePath)) ||
    a.declaration.range.start - b.declaration.range.start ||
    compareScalarText(a.name, b.name)
  );
  const snapshot = resolved.workspace.workspaceSnapshotIdentity;
  if (
    glossaryEvidence && glossaryEvidence.workspaceSnapshotIdentity !== snapshot
  ) return fail("SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH");
  if (
    purpose === "implementation" && implementationEvidence &&
    implementationEvidence.workspaceSnapshotIdentity !== snapshot
  ) return fail("SIGIL_RETRIEVAL_EVIDENCE_SNAPSHOT_MISMATCH");
  const budget = options.maxEvidenceBytes;
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
    throw new TypeError(
      "maxEvidenceBytes must be a non-negative integer when provided.",
    );
  }
  try {
    return await select();
  } catch (error) {
    if (error instanceof RetrievalIdentityCollision) {
      return fail("SIGIL_RETRIEVAL_IDENTITY_COLLISION");
    }
    throw error;
  }

  async function select(): Promise<PurposeRetrievalResult> {
    const identities = new RetrievalIdentityRegistry();
    const nodes = new Map<string, NodeDraft>(),
      edges = new Map<string, EdgeValue>(),
      candidates = new Map<string, Candidate>();
    const componentById = new Map(resolved.components.map((c) => [c.id, c]));
    const selected = new Map<
      string,
      {
        component: ResolvedComponent;
        role: "seed" | "dependency" | "importer" | "cycle";
      }
    >();
    const node = (key: string, value: NodeValue, rank: number) => {
      const previous = nodes.get(key);
      if (!previous || rank < previous.rank) nodes.set(key, { value, rank });
      return key;
    };
    const componentNode = (
      component: ResolvedComponent,
      role: "seed" | "dependency" | "importer" | "cycle",
    ) => {
      const rank = { seed: 0, dependency: 2, importer: 3, cycle: 4 }[role];
      node(component.id, {
        kind: "component-declaration",
        path: path(component.filePath),
        componentName: component.name,
        range: component.declaration.range,
      }, rank);
      if (!selected.has(component.id)) {
        selected.set(component.id, { component, role });
      }
      return component.id;
    };
    const edge = (value: EdgeValue) => {
      const key = canonicalJson({
        relation: value.relation,
        source: value.sourceKey,
        target: value.targetKey,
        path: value.originPath,
        range: value.originRange,
        implementationRange: value.implementationRange,
      });
      const previous = edges.get(key);
      edges.set(
        key,
        previous
          ? {
            ...previous,
            useIds: [
              ...new Set([...(previous.useIds ?? []), ...(value.useIds ?? [])]),
            ],
          }
          : value,
      );
      return key;
    };
    const request = node("request", {
      kind: "request-target",
      path: accepted!,
      componentName: target.kind === "component"
        ? target.componentName
        : undefined,
    }, 0);
    const sourceDigests = new Map<string, string>();
    for (const file of resolved.workspace.files) {
      if (file.document.source) {
        sourceDigests.set(
          file.path,
          await sha256Bytes(
            new TextEncoder().encode(file.document.source.text),
          ),
        );
      }
    }
    const addFacet = (
      component: ResolvedComponent,
      facet: Facet,
      kind: EvidenceKind,
      reason: ReasonDraft,
    ) => {
      const document =
        resolved.workspace.files.find((f) => f.path === component.filePath)!
          .document;
      const key = facet.id;
      const previous = candidates.get(key);
      const value: EvidenceValue = {
        kind,
        path: path(component.filePath),
        componentName: component.name,
        sectionName: facet.sectionName,
        range: facet.range,
        sourceSnapshot: sourceDigests.get(component.filePath),
        text: document.source!.slice(facet.range),
        facet: {
          id: provenance.occurrence(facet.id),
          componentId: provenance.occurrence(facet.componentId),
          groupingId: facet.groupingId
            ? provenance.occurrence(facet.groupingId)
            : undefined,
          groupingTag: facet.groupingTag,
          definitions: facet.definitions,
          references: component.references.filter((r) => r.facetId === facet.id)
            .map((r) => provenance.reference(r)),
          links: facet.links,
          sourceLines: facet.sourceLines,
          originalProse: document.source!.slice(facet.proseRange),
          prose: facet.prose,
          payload: facet.literalBlocks[0],
          valid: facet.valid,
          complete: facet.complete,
        },
      };
      if (!previous) candidates.set(key, { value, reasons: [reason] });
      else {
        if (KINDS.indexOf(kind) < KINDS.indexOf(previous.value.kind)) {
          previous.value = value;
        }
        previous.reasons.push(reason);
      }
    };
    const facets = (
      component: ResolvedComponent,
      kind: EvidenceKind,
      reason: ReasonDraft,
      sections?: readonly string[],
    ) => {
      for (const section of component.declaration.sections) {
        if (!sections || sections.includes(section.name)) {
          for (const facet of section.units) {
            addFacet(component, facet, kind, reason);
          }
        }
      }
    };
    for (const seed of seeds) {
      componentNode(seed, "seed");
      node(`file:${seed.filePath}`, {
        kind: "sigil-file",
        path: path(seed.filePath),
      }, 1);
      edge({
        relation: "selected-declaration",
        sourceKey: request,
        targetKey: seed.id,
        originPath: path(seed.filePath),
        originRange: seed.declaration.range,
      });
      facets(seed, "selected-contract", {
        rule: "select-target",
        seedKey: seed.id,
        anchorKey: seed.id,
      });
    }
    for (const seed of seeds) {
      for (const selection of resolved.graph.importedTagEdges) {
        const uses = selection.uses.filter((u) => u.componentId === seed.id);
        const provider = componentById.get(selection.providerComponentId)!;
        if (uses.length) {
          componentNode(provider, "dependency");
          edge({
            relation: "direct-dependency",
            sourceKey: seed.id,
            targetKey: provider.id,
            originPath: path(selection.sourceFile),
            originRange: selection.originRange,
            selectionId: provenance.occurrence(selection.id),
            tagIdentity: provenance.tag(selection.tagIdentity),
            useIds: uses.map((u) => provenance.occurrence(u.referenceId)),
          });
          const reason = {
            rule: "select-direct-dependency",
            seedKey: seed.id,
            anchorKey: provider.id,
          };
          facets(provider, "dependency-contract", reason, [
            "goal",
            "interface",
          ]);
          facets(provider, "dependency-decision", reason, ["decisions"]);
          facets(provider, "tag-origin", reason);
          if (purpose !== "semantic") {
            const tag = provider.tags.find((t) =>
              t.identity?.id === selection.tagIdentity.id
            )!;
            const origin = node(`tag:${tag.identity!.id}`, {
              kind: "tag-origin",
              path: path(provider.filePath),
              componentName: provider.name,
              range: tag.introductions[0].nameRange,
              tag: {
                identity: provenance.tag(tag.identity!),
                introductions: tag.introductions.map((i) =>
                  provenance.introduction(i)
                ),
              },
            }, 5);
            edge({
              relation: "tag-origin",
              sourceKey: seed.id,
              targetKey: origin,
              originPath: path(selection.sourceFile),
              originRange: selection.originRange,
              selectionId: provenance.occurrence(selection.id),
              tagIdentity: provenance.tag(selection.tagIdentity),
              useIds: uses.map((u) => provenance.occurrence(u.referenceId)),
            });
            facets(provider, "tag-origin", {
              rule: "select-tag-origin",
              seedKey: seed.id,
              anchorKey: origin,
            });
          }
        }
        if (provider.id !== seed.id) continue;
        const consumerIds = [
          ...new Set(selection.uses.map((u) => u.componentId)),
        ];
        if (!consumerIds.length) {
          const file = node(`file:${selection.sourceFile}`, {
            kind: "sigil-file",
            path: path(selection.sourceFile),
          }, 3);
          edge({
            relation: "direct-importer",
            sourceKey: seed.id,
            targetKey: file,
            originPath: path(selection.sourceFile),
            originRange: selection.originRange,
            selectionId: provenance.occurrence(selection.id),
            tagIdentity: provenance.tag(selection.tagIdentity),
          });
        }
        for (const consumerId of consumerIds) {
          const consumer = componentById.get(consumerId)!;
          componentNode(consumer, "importer");
          edge({
            relation: "direct-importer",
            sourceKey: seed.id,
            targetKey: consumer.id,
            originPath: path(selection.sourceFile),
            originRange: selection.originRange,
            selectionId: provenance.occurrence(selection.id),
            tagIdentity: provenance.tag(selection.tagIdentity),
            useIds: selection.uses.filter((u) => u.componentId === consumer.id)
              .map((u) => provenance.occurrence(u.referenceId)),
          });
          facets(consumer, "importer-contract", {
            rule: "select-direct-importer",
            seedKey: seed.id,
            anchorKey: consumer.id,
          }, ["goal", "interface"]);
        }
      }
    }
    if (purpose !== "semantic") {
      const reached = new Set(selected.keys());
      for (const group of stronglyConnectedComponentGroups(resolved.graph)) {
        if (!group.some((n) => reached.has(n.id))) continue;
        const members = new Set(group.map((n) => n.id));
        const cycleEdges = resolved.graph.importedTagEdges.filter((e) =>
          members.has(e.providerComponentId) &&
          e.uses.some((u) => members.has(u.componentId))
        );
        if (
          group.length === 1 &&
          !cycleEdges.some((e) =>
            e.uses.some((u) => u.componentId === e.providerComponentId)
          )
        ) continue;
        for (const member of group) {
          componentNode(componentById.get(member.id)!, "cycle");
        }
        for (const selection of cycleEdges) {
          for (
            const consumer of new Set(
              selection.uses.filter((u) => members.has(u.componentId)).map(
                (u) => u.componentId,
              ),
            )
          ) {
            edge({
              relation: "cycle-member",
              sourceKey: consumer,
              targetKey: selection.providerComponentId,
              originPath: path(selection.sourceFile),
              originRange: selection.originRange,
              selectionId: provenance.occurrence(selection.id),
              tagIdentity: provenance.tag(selection.tagIdentity),
              useIds: selection.uses.filter((u) => u.componentId === consumer)
                .map((u) => provenance.occurrence(u.referenceId)),
            });
          }
        }
        for (const member of group) {
          for (const seed of seeds) {
            facets(componentById.get(member.id)!, "cycle-contract", {
              rule: "select-cycle-member",
              seedKey: seed.id,
              anchorKey: member.id,
            });
          }
        }
      }
    }
    const implementationDiagnostics: SigilDiagnostic[] = [];
    let unavailable = false;
    if (purpose === "implementation") {
      unavailable = !implementationEvidence ||
        implementationEvidence.discoveryState === "unavailable";
      if (implementationEvidence) {
        implementationDiagnostics.push(...implementationEvidence.diagnostics);
      }
      if (!unavailable) {
        unavailable = !validImplementationEvidence(implementationEvidence!);
      }
      if (!unavailable) {
        for (const { component } of selected.values()) {
          const projection = ownedImplementationTargetsFor(
            resolved,
            implementationEvidence!.sources,
            {
              componentName: component.name,
              declarationPath: path(component.filePath),
            },
          );
          if (!projection) continue;
          implementationDiagnostics.push(...projection.diagnostics);
          for (const owned of projection.targets) {
            const nodeValue: NodeValue = {
              kind: "implementation-target",
              path: owned.filePath,
              componentName: component.name,
              location: owned.location,
              implementationRange: owned.location
                ? undefined
                : owned.annotationRange,
            };
            const implementationKey = node(
              `implementation:${canonicalJson(nodeValue)}`,
              nodeValue,
              6,
            );
            edge({
              relation: "owned-implementation",
              sourceKey: component.id,
              targetKey: implementationKey,
              originPath: owned.filePath,
              implementationRange: owned.annotationRange,
            });
            const value: EvidenceValue = {
              kind: "ownership-projection",
              path: owned.filePath,
              componentName: component.name,
              location: owned.location,
              implementationRange: owned.location
                ? undefined
                : owned.annotationRange,
              ownership: {
                ...owned,
                componentPath: path(component.filePath),
                tagIdentity: owned.tagIdentity
                  ? provenance.tag(owned.tagIdentity)
                  : undefined,
                facetIds: owned.facetIds.map((id) => provenance.occurrence(id)),
              },
              text: `${owned.relation} ${component.name}${
                owned.tagName === undefined
                  ? ""
                  : `::${JSON.stringify(owned.tagName)}`
              }${owned.symbolIdentity ? ` at ${owned.symbolIdentity}` : ""} [${
                owned.sections.join(",")
              }]`,
            };
            const key = `ownership:${canonicalJson(value)}`;
            const previous = candidates.get(key);
            const reasons = seeds.map((seed) => ({
              rule: "select-owned-implementation",
              seedKey: seed.id,
              anchorKey: implementationKey,
            }));
            if (previous) previous.reasons.push(...reasons);
            else candidates.set(key, { value, reasons });
          }
        }
      }
      if (unavailable) {
        implementationDiagnostics.push(
          diagnostic(
            "SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE",
            ERROR_MESSAGES.SIGIL_RETRIEVAL_IMPLEMENTATION_DISCOVERY_UNAVAILABLE,
          ),
        );
      }
    }
    const selectedPaths = new Set([...nodes.values()].map((n) => n.value.path));
    const scopedGlossary = glossaryEvidence
      ? glossaryContextForFiles(
        glossaryEvidence,
        resolved.workspace.files.filter((f) => selectedPaths.has(path(f.path)))
          .map((f) => f.path),
      )
      : undefined;
    if (scopedGlossary) {
      for (const occurrence of scopedGlossary.occurrences) {
        if (!occurrence.term.agentContext) continue;
        const triggers = [...candidates].filter(([, c]) =>
          c.value.facet && c.value.path === path(occurrence.filePath) &&
          c.value.range && c.value.range.start < occurrence.range.end &&
          occurrence.range.start < c.value.range.end
        );
        if (!triggers.length) continue;
        const key = `glossary:${occurrence.term.term}`;
        const previous = candidates.get(key),
          reasons = triggers.flatMap(([triggerKey, c]) =>
            c.reasons.map((r) => ({
              ...r,
              rule: "select-glossary-term",
              triggerKey,
            }))
          );
        if (previous) previous.reasons.push(...reasons);
        else {candidates.set(key, {
            value: {
              kind: "glossary-definition",
              path: scopedGlossary.glossaryPath
                ? path(scopedGlossary.glossaryPath)
                : undefined,
              range: occurrence.term.declarationRange,
              text: `${occurrence.term.term}: ${occurrence.term.definition}`,
            },
            reasons,
          });}
      }
    }
    const normalizeDiagnostic = (d: SigilDiagnostic): SigilDiagnostic => ({
      ...d,
      filePath: d.filePath ? path(d.filePath) : undefined,
      related: d.related.map((r) => ({
        ...r,
        filePath: r.filePath ? path(r.filePath) : undefined,
      })),
    });
    const diagnostics = orderDiagnostics([
      ...resolved.diagnostics.filter((d) =>
        !d.filePath || selectedPaths.has(path(d.filePath))
      ),
      ...(scopedGlossary?.diagnostics ?? []),
      ...implementationDiagnostics,
    ].map(normalizeDiagnostic));
    for (const d of diagnostics) {
      candidates.set(`diagnostic:${canonicalJson(d)}`, {
        value: {
          kind: "diagnostic",
          path: d.filePath,
          range: d.range,
          implementationRange: d.implementationRange,
          diagnostic: d,
          text: `${d.severity} ${d.code}: ${d.message}`,
        },
        reasons: seeds.map((seed) => ({
          rule: "select-target",
          seedKey: seed.id,
          anchorKey: seed.id,
        })),
      });
    }
    return await materialize(
      resolved,
      targetIdentity,
      purpose,
      seeds,
      nodes,
      edges,
      candidates,
      diagnostics,
      identities,
      budget,
    );
  }
}

function nodeIdentity(value: NodeValue) {
  return {
    kind: value.kind,
    path: value.path,
    componentName: value.componentName,
    range: value.range,
    location: value.location,
    implementationRange: value.implementationRange,
  };
}
function edgeIdentity(
  value: EdgeValue,
  sourceIdentity: string,
  targetIdentity: string,
) {
  return {
    relation: value.relation,
    sourceIdentity,
    targetIdentity,
    originPath: value.originPath,
    originRange: value.originRange,
    implementationRange: value.implementationRange,
  };
}
function compareLocation(
  a: { path?: string; range?: SourceRange; componentName?: string },
  b: { path?: string; range?: SourceRange; componentName?: string },
): number {
  return compareScalarText(a.path ?? "", b.path ?? "") ||
    Number(!!a.range) - Number(!!b.range) ||
    (a.range?.start ?? -1) - (b.range?.start ?? -1) ||
    (a.range?.end ?? -1) - (b.range?.end ?? -1) ||
    compareScalarText(a.componentName ?? "", b.componentName ?? "");
}

async function materialize(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalResult["target"],
  purpose: RetrievalPurpose,
  seeds: readonly ResolvedComponent[],
  nodeDrafts: Map<string, NodeDraft>,
  edgeDrafts: Map<string, EdgeValue>,
  candidates: Map<string, Candidate>,
  diagnostics: readonly SigilDiagnostic[],
  registry: RetrievalIdentityRegistry,
  maxEvidenceBytes?: number,
): Promise<PurposeRetrievalResult> {
  const distances = new Map<string, number>();
  const queue = seeds.map((s) => s.id);
  for (const key of queue) distances.set(key, 0);
  for (let i = 0; i < queue.length; i++) {
    for (const edge of edgeDrafts.values()) {
      if (edge.sourceKey === queue[i] && !distances.has(edge.targetKey)) {
        distances.set(edge.targetKey, distances.get(queue[i])! + 1);
        queue.push(edge.targetKey);
      }
    }
  }
  const nodes = await Promise.all(
    [...nodeDrafts].map(async ([key, draft]) => ({
      key,
      rank: draft.rank,
      value: {
        ...draft.value,
        identity: await registry.identify("n", nodeIdentity(draft.value)),
      } satisfies RetrievalNode,
    })),
  );
  nodes.sort((a, b) =>
    a.rank - b.rank ||
    (distances.get(a.key) ?? 0) - (distances.get(b.key) ?? 0) ||
    compareLocation(a.value, b.value) ||
    compareScalarText(a.value.identity, b.value.identity)
  );
  const nodeByKey = new Map(nodes.map((n) => [n.key, n.value]));
  const nodeOrder = new Map(nodes.map((n, i) => [n.value.identity, i]));
  const edges = await Promise.all([...edgeDrafts].map(async ([key, draft]) => {
    const { sourceKey, targetKey, ...value } = draft;
    const sourceIdentity = nodeByKey.get(sourceKey)!.identity,
      targetIdentity = nodeByKey.get(targetKey)!.identity;
    return {
      key,
      sourceKey,
      targetKey,
      value: {
        ...value,
        sourceIdentity,
        targetIdentity,
        identity: await registry.identify(
          "e",
          edgeIdentity(draft, sourceIdentity, targetIdentity),
        ),
      } satisfies RetrievalEdge,
    };
  }));
  edges.sort((a, b) =>
    nodeOrder.get(a.value.sourceIdentity)! -
      nodeOrder.get(b.value.sourceIdentity)! ||
    RELATIONS.indexOf(a.value.relation) - RELATIONS.indexOf(b.value.relation) ||
    nodeOrder.get(a.value.targetIdentity)! -
      nodeOrder.get(b.value.targetIdentity)! ||
    compareScalarText(a.value.identity, b.value.identity)
  );
  const edgeOrder = new Map(edges.map((e, i) => [e.value.identity, i]));
  const paths = new Map<string, Map<string, string[]>>();
  for (const seed of seeds) {
    const found = new Map<string, string[]>([[seed.id, []]]),
      pending = [seed.id];
    for (let i = 0; i < pending.length; i++) {
      for (const edge of edges) {
        if (
          edge.sourceKey !== pending[i] || found.has(edge.targetKey)
        ) continue;
        found.set(edge.targetKey, [
          ...found.get(pending[i])!,
          edge.value.identity,
        ]);
        pending.push(edge.targetKey);
      }
    }
    paths.set(seed.id, found);
  }
  const evidence = await Promise.all(
    [...candidates].map(async ([key, candidate]) => {
      const value = candidate.value;
      const identity = await registry.identify("v", {
        kind: value.kind,
        path: value.path,
        componentName: value.componentName,
        sectionName: value.sectionName,
        range: value.range,
        location: value.location,
        implementationRange: value.implementationRange,
        groupingId: value.facet?.groupingId,
        ownership: value.ownership,
        diagnostic: value.diagnostic,
      });
      return {
        key,
        candidate,
        value: {
          ...value,
          identity,
          inclusionReasonIdentities: [],
        } as EvidenceUnit,
      };
    }),
  );
  evidence.sort((a, b) =>
    KINDS.indexOf(a.value.kind) - KINDS.indexOf(b.value.kind) ||
    compareLocation(a.value, b.value) ||
    compareScalarText(a.value.sectionName ?? "", b.value.sectionName ?? "") ||
    compareScalarText(
      a.value.facet?.groupingTag ?? "",
      b.value.facet?.groupingTag ?? "",
    ) || compareScalarText(a.value.identity, b.value.identity)
  );
  const evidenceOrder = new Map(evidence.map((e, i) => [e.value.identity, i]));
  const evidenceKeyOrder = new Map(evidence.map((e, i) => [e.key, i]));
  const comparePaths = (a: readonly string[], b: readonly string[]) => {
    if (a.length !== b.length) return a.length - b.length;
    for (let i = 0; i < a.length; i++) {
      const difference = edgeOrder.get(a[i])! - edgeOrder.get(b[i])!;
      if (difference) return difference;
    }
    return 0;
  };
  const reasons: InclusionReason[] = [];
  for (const item of evidence) {
    const choices = new Map<
      string,
      {
        rule: string;
        seedIdentity: string;
        selectedIdentity: string;
        edgeIdentities: string[];
        triggerOrder: number;
      }
    >();
    for (const draft of item.candidate.reasons) {
      const path = paths.get(draft.seedKey)?.get(draft.anchorKey);
      if (path === undefined) continue;
      const value = {
        rule: draft.rule,
        seedIdentity: nodeByKey.get(draft.seedKey)!.identity,
        selectedIdentity: item.value.identity,
        edgeIdentities: path,
        triggerOrder: draft.triggerKey
          ? evidenceKeyOrder.get(draft.triggerKey)!
          : -1,
      };
      const key = canonicalJson([value.rule, value.seedIdentity]);
      const old = choices.get(key);
      if (
        !old ||
        (comparePaths(path, old.edgeIdentities) ||
            value.triggerOrder - old.triggerOrder) < 0
      ) {
        choices.set(key, value);
      }
    }
    let selected = [...choices.values()];
    if (item.value.kind === "glossary-definition") {
      selected = selected.sort((a, b) =>
        comparePaths(a.edgeIdentities, b.edgeIdentities) ||
        a.triggerOrder - b.triggerOrder ||
        nodeOrder.get(a.seedIdentity)! - nodeOrder.get(b.seedIdentity)!
      ).slice(0, 1);
    }
    for (const choice of selected) {
      const { triggerOrder: _triggerOrder, ...value } = choice;
      reasons.push({ ...value, identity: await registry.identify("r", value) });
    }
  }
  const uniqueReasons = [
    ...new Map(reasons.map((r) => [r.identity, r])).values(),
  ];
  uniqueReasons.sort((a, b) =>
    evidenceOrder.get(a.selectedIdentity)! -
      evidenceOrder.get(b.selectedIdentity)! ||
    RULES.indexOf(a.rule) - RULES.indexOf(b.rule) ||
    nodeOrder.get(a.seedIdentity)! - nodeOrder.get(b.seedIdentity)! ||
    comparePaths(a.edgeIdentities, b.edgeIdentities) ||
    compareScalarText(a.identity, b.identity)
  );
  const uniqueEvidence = [
    ...new Map(evidence.map((e) => [e.value.identity, e.value])).values(),
  ].map((value) => ({
    ...value,
    inclusionReasonIdentities: uniqueReasons.filter((r) =>
      r.selectedIdentity === value.identity
    ).map((r) => r.identity),
  }));
  const exclusions = await exclusionFrontier(
    resolved,
    nodeDrafts,
    nodeByKey,
    nodeOrder,
    registry,
  );
  const budgeted: EvidenceUnit[] = [];
  let budget: RetrievalBudgetReport | undefined;
  if (maxEvidenceBytes === undefined) budgeted.push(...uniqueEvidence);
  else {
    const withheld = new Map<EvidenceKind, number>();
    let spent = 0, withheldBytes = 0, exhausted = false;
    for (const unit of uniqueEvidence) {
      const size = new TextEncoder().encode(unit.text).length;
      if (
        unit.kind === "selected-contract" ||
        (!exhausted && spent + size <= maxEvidenceBytes)
      ) {
        budgeted.push(unit);
        spent += size;
      } else {
        exhausted = true;
        withheldBytes += size;
        withheld.set(unit.kind, (withheld.get(unit.kind) ?? 0) + 1);
      }
    }
    if (withheld.size) {
      budget = {
        maxEvidenceBytes,
        includedBytes: spent,
        withheldCount: [...withheld.values()].reduce((a, b) => a + b, 0),
        withheldBytes,
        withheldByKind: [...withheld].map(([kind, count]) => ({ kind, count }))
          .sort((a, b) =>
            b.count - a.count || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
          ),
      };
    }
  }
  const included = new Set(budgeted.map((e) => e.identity));
  const base = {
    schema: "sigil-purpose-retrieval/v2" as const,
    policyVersion: 2 as const,
    workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
    target,
    purpose,
    graph: {
      nodes: nodes.map((n) => n.value),
      edges: edges.map((e) => e.value),
    },
    evidence: budgeted,
    inclusionReasons: uniqueReasons.filter((r) =>
      included.has(r.selectedIdentity)
    ),
    exclusions,
    context: {
      sections: budgeted.map((e) => ({
        kind: e.kind,
        text: e.text,
        evidenceIdentity: e.identity,
        inclusionReasonIdentities: e.inclusionReasonIdentities,
      })),
    },
    diagnostics,
    ...(budget ? { budget } : {}),
  };
  return { ...base, fingerprint: await sha256Canonical(base) };
}

async function exclusionFrontier(
  resolved: ResolvedSigilWorkspace,
  drafts: Map<string, NodeDraft>,
  nodes: Map<string, RetrievalNode>,
  order: Map<string, number>,
  registry: RetrievalIdentityRegistry,
): Promise<ExcludedRelation[]> {
  const components = new Map(resolved.components.map((c) => [c.id, c]));
  const provenance = new SourceProvenance(resolved.workspace.root);
  const path = (p: string) => provenance.path(p);
  const found: {
    value: ExcludedRelation;
    target: NodeValue;
    relation: RetrievalRelation;
  }[] = [];
  const consider = async (
    source: string,
    target: string,
    targetValue: NodeValue,
    relation: RetrievalRelation,
    originPath: string,
    originRange: SourceRange,
  ) => {
    const rank = drafts.get(source)?.rank;
    if (rank === undefined || nodes.has(target)) return;
    const rule = rank === 4
      ? "exclude-cycle-outward"
      : relation === "direct-dependency" && rank === 2
      ? "exclude-transitive-dependency"
      : relation === "direct-importer" && rank === 3
      ? "exclude-transitive-importer"
      : undefined;
    if (!rule) return;
    const sourceIdentity = nodes.get(source)!.identity,
      targetIdentity = await registry.identify("n", nodeIdentity(targetValue));
    const edgeIdentity = await registry.identify("e", {
      relation,
      sourceIdentity,
      targetIdentity,
      originPath,
      originRange,
    });
    const identity = await registry.identify("x", { rule, edgeIdentity });
    found.push({
      value: { identity, rule, edgeIdentity, sourceIdentity, targetIdentity },
      target: targetValue,
      relation,
    });
  };
  for (const edge of resolved.graph.importedTagEdges) {
    const provider = components.get(edge.providerComponentId)!;
    const providerNode: NodeValue = {
      kind: "component-declaration",
      path: path(provider.filePath),
      componentName: provider.name,
      range: provider.declaration.range,
    };
    const consumerIds = [...new Set(edge.uses.map((u) => u.componentId))];
    for (const consumerId of consumerIds) {
      const consumer = components.get(consumerId)!;
      const consumerNode: NodeValue = {
        kind: "component-declaration",
        path: path(consumer.filePath),
        componentName: consumer.name,
        range: consumer.declaration.range,
      };
      await consider(
        consumerId,
        provider.id,
        providerNode,
        "direct-dependency",
        path(edge.sourceFile),
        edge.originRange,
      );
      await consider(
        provider.id,
        consumerId,
        consumerNode,
        "direct-importer",
        path(edge.sourceFile),
        edge.originRange,
      );
    }
    if (!consumerIds.length) {
      await consider(
        provider.id,
        `file:${edge.sourceFile}`,
        { kind: "sigil-file", path: path(edge.sourceFile) },
        "direct-importer",
        path(edge.sourceFile),
        edge.originRange,
      );
    }
  }
  found.sort((a, b) =>
    order.get(a.value.sourceIdentity)! - order.get(b.value.sourceIdentity)! ||
    compareLocation(a.target, b.target) ||
    RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation) ||
    EXCLUSION_RULES.indexOf(a.value.rule) -
      EXCLUSION_RULES.indexOf(b.value.rule) ||
    compareScalarText(a.value.identity, b.value.identity)
  );
  return [...new Map(found.map((e) => [e.value.identity, e.value])).values()];
}

async function failure(
  resolved: ResolvedSigilWorkspace,
  target: PurposeRetrievalResult["target"],
  purpose: RetrievalPurpose,
  code: RetrievalErrorCode,
): Promise<PurposeRetrievalResult> {
  const base = {
    schema: "sigil-purpose-retrieval/v2" as const,
    policyVersion: 2 as const,
    workspaceSnapshotIdentity: resolved.workspace.workspaceSnapshotIdentity,
    target,
    purpose,
    graph: { nodes: [], edges: [] },
    evidence: [],
    inclusionReasons: [],
    exclusions: [],
    context: { sections: [] },
    diagnostics: [diagnostic(code, ERROR_MESSAGES[code])],
  };
  return { ...base, fingerprint: await sha256Canonical(base) };
}

function validImplementationEvidence(
  input: ImplementationEvidenceInput,
): boolean {
  const exactKeys = (object: object, keys: readonly string[]) =>
    canonicalJson(Object.keys(object).sort()) ===
      canonicalJson([...keys].sort());
  if (
    !exactKeys(input, [
      "workspaceSnapshotIdentity",
      "discoveryState",
      "sources",
      "diagnostics",
    ]) ||
    !["complete", "unavailable"].includes(input.discoveryState) ||
    canonicalJson(input.diagnostics) !==
      canonicalJson(orderDiagnostics(input.diagnostics))
  ) return false;
  if (input.discoveryState === "unavailable") {
    return input.sources.length === 0 && input.diagnostics.length > 0;
  }
  let previous: string | undefined;
  for (const source of input.sources) {
    const p = source.filePath;
    if (
      !exactKeys(source, ["filePath", "text"]) || typeof p !== "string" ||
      typeof source.text !== "string" ||
      p.includes("\0") || p.split("/").includes("..") ||
      normalizePath(p) !== p || p.startsWith("/") ||
      /^[A-Za-z]:/.test(p) || !isSupportedImplementationSource(p) ||
      (previous !== undefined && compareScalarText(previous, p) >= 0)
    ) return false;
    previous = p;
  }
  return true;
}
