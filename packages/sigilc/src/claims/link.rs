//! Link the stored readings of a workspace into one program.
//!
//! Interpretation is per source and sees only imported interfaces. A reading is
//! stored under its Facet's content id, so the readings of every source already
//! sit side by side in the store; what is missing is one program that holds
//! them all. Linking builds it: each source is projected on its own, its valid
//! stored readings are admitted in its own world, and the admitted facts are
//! joined. Fact ids are content hashes with no per-request numbering, so facts
//! from different worlds concatenate without remapping.
//!
//! Nothing here launches a model, and nothing here writes the store: a reading
//! whose recorded context moved is re-checked every time rather than refreshed.
use super::{
    dialect::Row,
    guidance,
    identity::{Admitter, Fact},
    memo,
    prepare::{self, AdmissibleEntity, Binding, FacetRow, LogicSection, Request, SourceImports},
    vocabulary,
};
use crate::{
    inputs::DesignBasis,
    structure::{DesignInput, ImportStatus},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

/// The source name a workspace-wide report carries. Source paths keep their
/// `.sigil` suffix, so it cannot collide with one.
pub const WORKSPACE: &str = "workspace";

/// Units no valid stored reading covers.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Unread {
    pub source: String,
    pub component: String,
    pub section: String,
    pub facets: Vec<String>,
    /// Why a stored reading was not linked, when one existed and admission
    /// refused it. Absent when nothing was stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal: Option<String>,
}

/// An import the workspace could not resolve, so its dependency never joins.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnresolvedImport {
    pub source: String,
    pub path: String,
    pub provider: String,
    pub status: String,
}

/// The binding digest of one source's request, so a linked report names what
/// each source was read against.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceEvidence {
    pub source: String,
    pub binding_digest: String,
}

/// Every source's valid readings, joined.
#[derive(Debug)]
pub struct Linked {
    /// One request holding the own rows, entities and flows of every source.
    pub request: Request,
    /// Facts admitted in their own source's world, joined and deduplicated.
    pub facts: Vec<Fact>,
    pub unread: Vec<Unread>,
    pub unresolved_imports: Vec<UnresolvedImport>,
    pub sources: Vec<SourceEvidence>,
    /// The memo keys of the readings that were linked.
    pub memo_keys: Vec<String>,
    pub workspace_digest: String,
}

/// Rows in the order admission reads them, with repeats dropped.
fn sorted(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort();
    rows.dedup();
    rows
}

/// Link the workspace's stored readings, read-only.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::SectionAwareClosure interface,constraints,cases
pub fn link(input: &DesignInput, basis: &DesignBasis, store: &Path) -> Result<Linked, String> {
    let mut paths: Vec<&str> = input.sources.iter().map(|s| s.path.as_str()).collect();
    paths.sort_unstable();

    let mut rows: BTreeMap<String, FacetRow> = BTreeMap::new();
    let mut entities: BTreeMap<String, AdmissibleEntity> = BTreeMap::new();
    let mut declared: BTreeSet<(String, String)> = BTreeSet::new();
    let mut flows: Vec<LogicSection> = Vec::new();
    let mut imports: Vec<SourceImports> = Vec::new();
    let mut facts: Vec<Fact> = Vec::new();
    let mut unread: Vec<Unread> = Vec::new();
    let mut sources: Vec<SourceEvidence> = Vec::new();
    let mut memo_keys: BTreeSet<String> = BTreeSet::new();

    for path in paths {
        let request = prepare::project(input, basis, path)?;
        sources.push(SourceEvidence {
            source: path.to_owned(),
            binding_digest: request.binding.digest(),
        });
        let split = memo::split(&request, input, store);
        let label = |facet: &str| {
            request
                .rows
                .iter()
                .find(|r| r.facet == facet)
                .map(|r| r.component_label.clone())
                .unwrap_or_default()
        };
        let describe = |unit: &memo::Unit, refusal: Option<String>| Unread {
            source: unit.source.clone(),
            component: unit.facets.first().map(|f| label(f)).unwrap_or_default(),
            section: unit.section.clone(),
            facets: unit.facets.clone(),
            refusal,
        };
        for unit in &split.stale {
            unread.push(describe(unit, None));
        }

        // Each unit's valid rows are admitted against this source's own request,
        // never a dependent's. A refusal of the whole set is retried a unit at
        // a time, so one refused reading leaves its unit unread without
        // dropping the rest of the source.
        let admitter = Admitter::new(&request, input);
        let all = sorted(
            split
                .reused
                .iter()
                .flat_map(|(_, rows)| rows.iter().cloned())
                .collect(),
        );
        match admitter.admit(&all) {
            Ok(admitted) => {
                facts.extend(admitted);
                memo_keys.extend(split.reused.iter().map(|(unit, _)| unit.key.clone()));
            }
            Err(_) => {
                for (unit, unit_rows) in &split.reused {
                    match admitter.admit(&sorted(unit_rows.clone())) {
                        Ok(admitted) => {
                            facts.extend(admitted);
                            memo_keys.insert(unit.key.clone());
                        }
                        Err(refusal) => unread.push(describe(unit, Some(refusal))),
                    }
                }
            }
        }

        for row in request.own_rows() {
            rows.insert(row.facet.clone(), row.clone());
        }
        for entity in &request.entities {
            entities
                .entry(entity.id.clone())
                .or_insert_with(|| entity.clone());
        }
        declared.extend(request.declared.iter().cloned());
        flows.extend(request.flows.iter().cloned());
        imports.extend(request.imports.iter().cloned());
    }

    facts.sort();
    facts.dedup();
    unread.sort();
    unread.dedup();
    flows.sort_by(|a, b| (&a.source, &a.component).cmp(&(&b.source, &b.component)));
    sources.sort();

    let mut unresolved_imports: Vec<UnresolvedImport> = input
        .imports
        .iter()
        .filter(|i| i.status != ImportStatus::Resolved)
        .map(|i| UnresolvedImport {
            source: i.source.clone(),
            path: i.path.clone(),
            provider: i.provider.clone(),
            // The kebab-case name the import status serializes to.
            status: serde_json::to_value(&i.status)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
        })
        .collect();
    unresolved_imports.sort();
    unresolved_imports.dedup();

    let workspace_digest = prepare::workspace_digest(basis);
    let mut facets: Vec<String> = rows.keys().cloned().collect();
    facets.sort();
    let request = Request {
        binding: Binding {
            format: prepare::REQUEST_FORMAT,
            source: WORKSPACE.to_owned(),
            source_content: workspace_digest.clone(),
            interfaces: Vec::new(),
            guidance_fingerprint: guidance::fingerprint(),
            vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
            facets,
        },
        rows: rows.into_values().collect(),
        flows,
        entities: entities.into_values().collect(),
        imports,
        declared: declared.into_iter().collect(),
    };

    Ok(Linked {
        request,
        facts,
        unread,
        unresolved_imports,
        sources,
        memo_keys: memo_keys.into_iter().collect(),
        workspace_digest,
    })
}
