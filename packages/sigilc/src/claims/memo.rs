//! Stored interpretations, so a request asks only for what is stale.
//!
//! Presenting a source's whole resolved closure is what lets a claim in one
//! component reach a flow graph in a component it depends on. It also means the
//! same dependency Facets are handed over once per dependent: projecting
//! `packages/core/src/pipeline.sigil` grows from 16 Facets to 441, and across a
//! workspace the shared ones are re-read many times over. This module removes
//! that repetition, which is the whole of the widening's cost.
//!
//! Nothing here launches a model. A stored interpretation is one a caller
//! already supplied; reusing it is reuse of their own input, not a new call.
use super::{
    dialect::Row,
    prepare::{REQUEST_FORMAT, Request},
};
use crate::sources::hash;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// Where stored interpretations live, under the path this component owns.
const DIR: &str = ".sigil/claims/interpretations";

/// One thing the interpreter is shown, and the unit staleness is judged in.
///
/// Not always a Facet. Logic is presented as a whole section, because a flow
/// spans one, so a Logic unit is the section and its key covers every Facet's
/// prose in it: edit one Logic paragraph and the section is re-read, because
/// the flow through it may have changed. Every other role is presented one
/// Facet at a time and is keyed on its own prose alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    pub key: String,
    pub component: String,
    pub section: String,
    /// Every Facet this unit covers, in source order.
    pub facets: Vec<String>,
}

/// The presentation units of a request, each with the key it is stored under.
///
/// The key deliberately excludes the binding. A binding is taken over the whole
/// export digest, so any edit anywhere in a 15-source closure moves it; keying
/// on it would empty the store on every run, which is the cost this module
/// exists to remove. It also excludes the closure: grounding runs at admission
/// rather than at interpretation, so adding an import re-grounds stored rows
/// without re-reading them.
///
/// It includes the owning component and the contract role because prose alone
/// does not identify a unit. Two Facets can carry byte-identical prose, and
/// grounding is checked against each one's own component and references, so
/// reusing the wrong one could judge a row grounded against a Facet that never
/// named the entity.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn units(request: &Request) -> Vec<Unit> {
    let prose: BTreeMap<&str, &str> = request
        .rows
        .iter()
        .map(|r| (r.facet.as_str(), r.prose.as_str()))
        .collect();
    let identity = (
        REQUEST_FORMAT,
        request.binding.guidance_fingerprint.as_str(),
        request.binding.vocabulary_generation,
    );

    let mut units = Vec::new();
    let mut grouped: Vec<&str> = Vec::new();
    for flow in &request.flows {
        let body: Vec<&str> = flow
            .facets
            .iter()
            .map(|f| prose.get(f.as_str()).copied().unwrap_or_default())
            .collect();
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&(
                    "sigil-claims-memo-v1",
                    identity,
                    &flow.component,
                    "logic",
                    &body,
                ))
                .expect("memo key serialization"),
            ),
            component: flow.component.clone(),
            section: "logic".to_owned(),
            facets: flow.facets.clone(),
        });
        grouped.extend(flow.facets.iter().map(String::as_str));
    }

    for row in &request.rows {
        if grouped.contains(&row.facet.as_str()) {
            continue; // carried by its section's unit
        }
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&(
                    "sigil-claims-memo-v1",
                    identity,
                    &row.component,
                    &row.section,
                    &[row.prose.as_str()],
                ))
                .expect("memo key serialization"),
            ),
            component: row.component.clone(),
            section: row.section.clone(),
            facets: vec![row.facet.clone()],
        });
    }
    units
}

fn path(root: &Path, key: &str) -> PathBuf {
    root.join(DIR).join(format!("{key}.json"))
}

/// The rows stored for a unit, or `None` when it is stale.
pub fn load(root: &Path, key: &str) -> Option<Vec<Row>> {
    let bytes = std::fs::read(path(root, key)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Store the rows a caller supplied for one unit.
///
/// Writes under this component's own path and never the compiler's world cache,
/// which the contract makes read-only here.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn save(root: &Path, key: &str, rows: &[Row]) -> Result<(), String> {
    let path = path(root, key);
    let dir = path.parent().expect("memo path has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut bytes = serde_json::to_vec(rows).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// Split a request's units into those a caller must interpret and those stored.
pub fn split(request: &Request, root: &Path) -> (Vec<Unit>, Vec<(Unit, Vec<Row>)>) {
    let mut stale = Vec::new();
    let mut reused = Vec::new();
    for unit in units(request) {
        match load(root, &unit.key) {
            Some(rows) => reused.push((unit, rows)),
            None => stale.push(unit),
        }
    }
    (stale, reused)
}
