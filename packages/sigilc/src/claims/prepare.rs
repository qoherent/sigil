//! Project a design export into an interpretation request.
//!
//! Everything the external interpreter needs travels through here: the exact
//! prose of each Facet, the guidance bundle, and an immutable binding that lets
//! ingest refuse a mismatched pair. No `.sigil` file is read — the export
//! already carries every source's full text.
use super::{guidance, vocabulary};
use crate::{
    frontend::{DesignInput, Unit},
    scope, sources,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

/// Changes when the request or binding layout becomes incompatible.
pub const REQUEST_FORMAT: u32 = 1;

/// One Facet handed to the interpreter, pre-filled with its own identity.
///
/// The contract role is present so the interpreter knows what kind of claim the
/// Facet can support, but it is not a column of any row that comes back: the
/// tool fills that from the export when it re-emits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FacetRow {
    /// Copied verbatim into every row the interpreter returns for this Facet.
    pub facet: String,
    pub component: String,
    pub component_label: String,
    pub section: String,
    pub source: String,
    pub prose: String,
}

/// An entity a claim from this design may name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdmissibleEntity {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub owner: Option<String>,
    pub source: String,
}

/// What ingest checks before it trusts a returned artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub format: u32,
    pub source: String,
    pub export_digest: String,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
    /// Every source in the selected source's resolved closure, including itself.
    pub closure: Vec<String>,
    /// The Facets this request asked about, which bounds what may come back.
    pub facets: Vec<String>,
}

impl Binding {
    pub fn digest(&self) -> String {
        sources::hash(
            &serde_json::to_vec(&("sigil-claims-binding-v1", self)).expect("binding serialization"),
        )
    }
}

/// A prepared interpretation request, before it reaches disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub binding: Binding,
    pub rows: Vec<FacetRow>,
    pub entities: Vec<AdmissibleEntity>,
    /// Contract roles that declare at least one Facet, as `component\tsection`
    /// pairs. This is the denominator for whether an interpretation covered the
    /// design, so it is recorded at preparation rather than recomputed later.
    pub declared: Vec<(String, String)>,
}

/// Digest of the whole export, so ingest can tell it was handed the same one.
pub fn export_digest(input: &DesignInput) -> String {
    sources::hash(
        &serde_json::to_vec(&("sigil-claims-export-v1", input)).expect("export serialization"),
    )
}

/// Build the request for one design source and its resolved closure.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn project(input: &DesignInput, source: &str) -> Result<Request, String> {
    if !input.sources.iter().any(|s| s.path == source) {
        return Err(format!("design source not exported: {source}"));
    }
    let closure = scope::design_membership(input, [source]).sources;

    let mut rows = Vec::new();
    let mut declared = BTreeSet::new();
    for unit in input.units.iter().filter(|u| u.source == source) {
        let Some(row) = facet_row(input, unit)? else {
            continue;
        };
        declared.insert((row.component.clone(), row.section.clone()));
        rows.push(row);
    }
    rows.sort_by(|a, b| a.facet.cmp(&b.facet));

    let mut entities: Vec<_> = input
        .entities
        .iter()
        .filter(|e| closure.contains(&e.source))
        .map(|e| AdmissibleEntity {
            id: e.id.clone(),
            kind: format!("{:?}", e.kind),
            label: e.label.clone(),
            owner: e.owner.clone(),
            source: e.source.clone(),
        })
        .collect();
    entities.sort_by(|a, b| a.id.cmp(&b.id));

    let binding = Binding {
        format: REQUEST_FORMAT,
        source: source.to_owned(),
        export_digest: export_digest(input),
        guidance_fingerprint: guidance::fingerprint(),
        vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
        closure: closure.into_iter().collect(),
        facets: rows.iter().map(|r| r.facet.clone()).collect(),
    };
    Ok(Request {
        binding,
        rows,
        entities,
        declared: declared.into_iter().collect(),
    })
}

/// A Facet's row, or `None` when the unit is not an interpretable Facet.
///
/// Structurally invalid units and units outside a component are skipped: the
/// compiler already reports them, and neither can carry a commitment.
fn facet_row(input: &DesignInput, unit: &Unit) -> Result<Option<FacetRow>, String> {
    if !unit.valid {
        return Ok(None);
    }
    let Some(owner) = unit.owner.as_deref() else {
        return Ok(None);
    };
    let text = &input
        .sources
        .iter()
        .find(|s| s.path == unit.source)
        .ok_or_else(|| format!("Facet {} names an unexported source", unit.id))?
        .text;
    let prose = text
        .get(unit.prose_range.start..unit.prose_range.end)
        .ok_or_else(|| {
            format!(
                "Facet {} prose range {}..{} is not a character boundary of {}",
                unit.id, unit.prose_range.start, unit.prose_range.end, unit.source
            )
        })?;
    let label = input
        .entities
        .iter()
        .find(|e| e.id == owner)
        .map(|e| e.label.clone())
        .unwrap_or_default();
    Ok(Some(FacetRow {
        facet: unit.id.clone(),
        component: owner.to_owned(),
        component_label: label,
        section: vocabulary::section_name(&unit.section).to_owned(),
        source: unit.source.clone(),
        prose: prose.to_owned(),
    }))
}

/// Write the request, the binding and the guidance into a fresh directory.
///
/// The caller keeps this directory, produces claims from it independently, and
/// passes the binding back to ingest. Refusing a non-empty destination keeps a
/// stale binding from being silently paired with a new request.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn write(request: &Request, out: &Path) -> Result<Vec<PathBuf>, String> {
    match std::fs::read_dir(out) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                return Err(format!(
                    "preparation directory is not empty: {}",
                    out.display()
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
        }
        Err(e) => return Err(format!("{}: {e}", out.display())),
    }

    let mut written = Vec::new();
    let mut emit = |name: &str, bytes: &[u8]| -> Result<(), String> {
        let path = out.join(name);
        std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path);
        Ok(())
    };
    emit("binding.json", &json(&request.binding)?)?;
    emit("request.json", &json(request)?)?;
    for doc in guidance::BUNDLE {
        emit(doc.name, doc.text.as_bytes())?;
    }
    Ok(written)
}

fn json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}
