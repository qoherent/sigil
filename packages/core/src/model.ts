// @sigil implements packages/core/src/model/_module.sigil::SigilSemanticModel interface,constraints
// deno-lint-ignore no-empty-interface -- marker interface for the Sigil model boundary
export interface SigilSemanticModelNamespace {}

export * from "./model/language.ts";
export * from "./model/configuration.ts";
export * from "./model/diagnostics.ts";
export * from "./model/source.ts";
export * from "./model/glossary.ts";
export * from "./model/ownership.ts";
export * from "./model/workspace.ts";
export * from "./model/resolution.ts";
export * from "./model/graph.ts";
export * from "./model/retrieval.ts";

export * from "./model/projections.ts";
