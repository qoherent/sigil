//! Ground one whole file's reading against its presented design names.
use super::{
    dialect::Row,
    prepare::{DesignName, Request},
};
use crate::sources::hash;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fact {
    pub id: String,
    pub path: String,
    /// File-qualified identity, kept out of the memo's local rows.
    pub element: String,
    pub kind: String,
    pub row: Row,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Admitted {
    pub rows: Vec<Row>,
    pub facts: Vec<Fact>,
    pub undesigned_elements: BTreeSet<String>,
}

/// Accept IDs and qualified labels, or a label unique within promise scope.
fn on_list<'a>(names: &'a [DesignName], reference: &str) -> Result<&'a DesignName, String> {
    if let Some(name) = names.iter().find(|name| name.id == reference) {
        return Ok(name);
    }
    let candidates: Vec<_> = names
        .iter()
        .filter(|name| name.qualified_label == reference || name.label == reference)
        .collect();
    match candidates.as_slice() {
        [name] => Ok(name),
        [] => Err(format!(
            "design name {reference:?} is not on this file's names list"
        )),
        _ => Err(format!(
            "design name {reference:?} is ambiguous; use {}",
            candidates
                .iter()
                .map(|name| name.qualified_label.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::FileReadings interface,constraints
pub fn admit(request: &Request, rows: &[Row]) -> Result<Admitted, String> {
    let mut elements = BTreeMap::new();
    for row in rows {
        row.validate()?;
        if let Row::Element { name, kind } = row
            && let Some(prior) = elements.insert(name.clone(), kind.clone())
            && prior != *kind
        {
            return Err(format!(
                "element {name:?} has conflicting kinds {prior:?} and {kind:?}"
            ));
        }
    }
    if elements.is_empty() {
        return Err("an answer with no element row leaves the file unread".into());
    }
    let mut canonical = Vec::new();
    let mut mapped = BTreeSet::new();
    for row in rows {
        if !elements.contains_key(row.element()) {
            return Err(format!(
                "element {:?} is not declared in this file",
                row.element()
            ));
        }
        let mut row = row.clone();
        match &mut row {
            Row::Realizes {
                element,
                design_name,
            } => {
                *design_name = on_list(&request.names, design_name)?.id.clone();
                mapped.insert(element.clone());
            }
            Row::Act { design_name, .. } => {
                *design_name = on_list(&request.names, design_name)?.id.clone()
            }
            _ => {}
        }
        canonical.push(row);
    }
    canonical.sort();
    canonical.dedup();
    let facts = canonical
        .iter()
        .map(|row| {
            let element = format!("{}::{}", request.binding.path, row.element());
            Fact {
                id: hash(
                    &serde_json::to_vec(&("sigil-align-fact-v1", &request.binding.path, row))
                        .expect("fact serialization"),
                ),
                path: request.binding.path.clone(),
                kind: elements[row.element()].clone(),
                element,
                row: row.clone(),
            }
        })
        .collect();
    Ok(Admitted {
        rows: canonical,
        facts,
        undesigned_elements: elements
            .into_keys()
            .filter(|name| !mapped.contains(name))
            .collect(),
    })
}
