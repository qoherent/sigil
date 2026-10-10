//! Content-keyed implementation readings with selective design grounding.
use super::{
    admit::{self, Admitted},
    dialect::Row,
    prepare::Request,
};
use crate::sources::hash;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

pub const MEMO_VERSION: u32 = 1;
const DIR: &str = "claims/implementation";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grounding {
    pub cited_names: BTreeMap<String, String>,
    pub memberships: BTreeMap<String, String>,
    pub available_names: BTreeSet<String>,
    pub undesigned_elements: BTreeSet<String>,
}

impl Grounding {
    fn current(request: &Request, admitted: &Admitted) -> Self {
        let cited: BTreeSet<_> = admitted.rows.iter().filter_map(Row::design_name).collect();
        let members: BTreeSet<_> = admitted
            .facts
            .iter()
            .filter(|fact| fact.kind != "test")
            .filter_map(|fact| match &fact.row {
                Row::Realizes { design_name, .. } => Some(design_name.as_str()),
                _ => None,
            })
            .collect();
        Self {
            cited_names: request
                .names
                .iter()
                .filter(|name| cited.contains(name.id.as_str()))
                .map(|name| (name.id.clone(), name.digest.clone()))
                .collect(),
            memberships: request
                .names
                .iter()
                .filter(|name| name.kind == "Component" && members.contains(name.id.as_str()))
                .map(|name| (name.id.clone(), name.membership_digest.clone()))
                .collect(),
            available_names: request.names.iter().map(|name| name.id.clone()).collect(),
            undesigned_elements: admitted.undesigned_elements.clone(),
        }
    }

    fn fresh(&self, current: &Self) -> bool {
        self.cited_names == current.cited_names
            && self.memberships == current.memberships
            && (self.undesigned_elements.is_empty()
                || current.available_names.is_subset(&self.available_names))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stored {
    pub version: u32,
    pub rows: Vec<Row>,
    pub grounding: Grounding,
}

/// Paths and design context deliberately stay out of the content identity.
pub fn key(request: &Request) -> String {
    hash(
        &serde_json::to_vec(&(
            "sigil-align-memo",
            MEMO_VERSION,
            request.binding.format,
            &request.binding.content_hash,
            &request.binding.guidance_fingerprint,
            request.binding.vocabulary_generation,
        ))
        .expect("memo key serialization"),
    )
}

pub fn path(store: &Path, request: &Request) -> PathBuf {
    store.join(DIR).join(format!("{}.json", key(request)))
}

/// Re-admit canonical rows in the current path and design context. A reading
/// citing changed names or changed member promises must be interpreted again.
pub fn load(store: &Path, request: &Request) -> Option<Admitted> {
    let stored: Stored = serde_json::from_slice(&fs::read(path(store, request)).ok()?).ok()?;
    if stored.version != MEMO_VERSION {
        return None;
    }
    let admitted = admit::admit(request, &stored.rows).ok()?;
    stored
        .grounding
        .fresh(&Grounding::current(request, &admitted))
        .then_some(admitted)
}

#[derive(Debug, Default)]
pub struct Split {
    pub stale: Vec<Request>,
    pub reused: Vec<(Request, Admitted)>,
}

pub fn split(requests: &[Request], store: &Path) -> Split {
    let mut split = Split::default();
    for request in requests {
        match load(store, request) {
            Some(admitted) => split.reused.push((request.clone(), admitted)),
            None => split.stale.push(request.clone()),
        }
    }
    split
}

/// Save only an admitted reading; repeated identical ingest leaves its bytes
/// and modification time alone. Canonical rows carry local element names.
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::FileReadings interface
pub fn save(store: &Path, request: &Request, admitted: &Admitted) -> Result<bool, String> {
    let stored = Stored {
        version: MEMO_VERSION,
        rows: admitted.rows.clone(),
        grounding: Grounding::current(request, admitted),
    };
    let path = path(store, request);
    let mut bytes = serde_json::to_vec(&stored).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    if fs::read(&path).ok().as_ref() == Some(&bytes) {
        return Ok(false);
    }
    fs::create_dir_all(path.parent().expect("memo directory")).map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("json.tmp{}", std::process::id()));
    fs::write(&temporary, bytes).map_err(|e| format!("{}: {e}", temporary.display()))?;
    fs::rename(&temporary, &path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        format!("{}: {e}", path.display())
    })?;
    Ok(true)
}
