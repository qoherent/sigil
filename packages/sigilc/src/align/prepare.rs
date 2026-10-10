//! Present one whole code file against the names in configured promise scope.
use super::{
    guidance,
    selection::{self, ResolvedSelection},
    vocabulary,
};
use crate::{
    claims::{
        identity::{Body, Fact},
        link::{self, Linked},
        prepare::{FacetRow, json},
    },
    sources::{self, SourceIdentity},
    structure::DesignInput,
    tree::design_input::load_design,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

pub const REQUEST_FORMAT: u32 = 1;
/// A selected file larger than this stays visible as unpresentable.
pub const MAX_FILE_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub format: u32,
    pub path: String,
    pub content_hash: String,
    pub names_digest: String,
    pub selection_digest: String,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
}

impl Binding {
    pub fn digest(&self) -> String {
        sources::hash(
            &serde_json::to_vec(&("sigil-align-binding-v1", self)).expect("binding serialization"),
        )
    }
}

/// A declared name, its exact source prose, and admitted design facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignName {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub qualified_label: String,
    pub owner: Option<String>,
    pub source: String,
    pub digest: String,
    /// All names and claims on its component, for membership freshness.
    pub membership_digest: String,
    pub claims: Vec<Fact>,
    pub facets: Vec<FacetRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub binding: Binding,
    pub source: String,
    pub names: Vec<DesignName>,
}

/// Keep the full linked design for the later design gate; only name context is
/// restricted to promise scope. Loading does not invent or store readings.
pub struct Workspace {
    pub input: DesignInput,
    pub linked: Linked,
    pub selection: ResolvedSelection,
    pub names: Vec<DesignName>,
    pub names_digest: String,
}

#[derive(Debug)]
pub enum LoadError {
    Usage(String),
    Operational(String),
}

impl LoadError {
    pub fn output(self) -> (u8, String) {
        match self {
            Self::Usage(message) => (2, message),
            Self::Operational(message) => (3, message),
        }
    }
}

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::FileRequests interface
pub fn load(root: &Path, store: &Path) -> Result<Workspace, LoadError> {
    let (input, basis) = load_design(root, store).map_err(LoadError::Operational)?;
    let selection = selection::load(root)
        .map_err(LoadError::Usage)?
        .resolve(root, &input, MAX_FILE_BYTES)
        .map_err(LoadError::Usage)?;
    let linked = link::link(&input, &basis, store).map_err(LoadError::Operational)?;
    let names = design_names(&linked, &selection).map_err(LoadError::Operational)?;
    let grounding: Vec<_> = names
        .iter()
        .map(|name| (&name.id, &name.digest, &name.membership_digest))
        .collect();
    let names_digest = sources::hash(
        &serde_json::to_vec(&("sigil-align-names-v1", grounding))
            .map_err(|e| LoadError::Operational(e.to_string()))?,
    );
    Ok(Workspace {
        input,
        linked,
        selection,
        names,
        names_digest,
    })
}

pub fn design_names(
    linked: &Linked,
    selection: &ResolvedSelection,
) -> Result<Vec<DesignName>, String> {
    let entities: Vec<_> = linked
        .request
        .entities
        .iter()
        .filter(|e| selection.design.sources.contains(&e.source))
        .collect();
    let components: BTreeMap<_, _> = entities
        .iter()
        .filter(|e| e.kind == "Component")
        .map(|e| (e.id.as_str(), e.label.as_str()))
        .collect();
    let scoped_facts: Vec<_> = linked
        .facts
        .iter()
        .filter(|fact| {
            linked
                .request
                .rows
                .iter()
                .any(|r| r.facet == fact.facet && selection.design.sources.contains(&r.source))
        })
        .collect();
    let mut names = Vec::new();
    let mut membership_digests = BTreeMap::new();
    for entity in &entities {
        let component = entity.owner.as_deref().unwrap_or(&entity.id);
        let qualified_label = if entity.kind == "Tag" {
            format!(
                "{}::{}",
                components
                    .get(component)
                    .ok_or_else(|| format!("missing owner for {}", entity.label))?,
                entity.label
            )
        } else {
            entity.label.clone()
        };
        let claims: Vec<Fact> = scoped_facts
            .iter()
            .filter(|f| {
                if entity.kind == "Component" {
                    f.component == entity.id || cites(f, &entity.id)
                } else {
                    cites(f, &entity.id)
                }
            })
            .map(|f| (*f).clone())
            .collect();
        let facets: Vec<_> = linked
            .request
            .rows
            .iter()
            .filter(|r| {
                selection.design.sources.contains(&r.source)
                    && (if entity.kind == "Component" {
                        r.component == entity.id
                    } else {
                        claims.iter().any(|c| c.facet == r.facet)
                            || (r.component == component && r.names.contains(&entity.label))
                    })
            })
            .cloned()
            .collect();
        let digest = sources::hash(
            &serde_json::to_vec(&(
                "sigil-align-name-v1",
                entity,
                grounding_claims(claims.iter()),
            ))
            .map_err(|e| e.to_string())?,
        );
        let membership_digest = if let Some(digest) = membership_digests.get(component) {
            String::clone(digest)
        } else {
            let component_names: Vec<_> = entities
                .iter()
                .filter(|e| e.id == component || e.owner.as_deref() == Some(component))
                .collect();
            let component_claims: Vec<_> = scoped_facts
                .iter()
                .filter(|f| f.component == component)
                .collect();
            let component_facets: Vec<_> = linked
                .request
                .rows
                .iter()
                .filter(|r| r.component == component)
                .collect();
            let digest = sources::hash(
                &serde_json::to_vec(&(
                    "sigil-align-membership-v1",
                    component_names,
                    grounding_claims(component_claims.into_iter().copied()),
                    grounding_facets(&component_facets.into_iter().cloned().collect::<Vec<_>>()),
                ))
                .map_err(|e| e.to_string())?,
            );
            membership_digests.insert(component.to_owned(), digest.clone());
            digest
        };
        names.push(DesignName {
            id: entity.id.clone(),
            kind: entity.kind.clone(),
            label: entity.label.clone(),
            qualified_label,
            owner: entity.owner.clone(),
            source: entity.source.clone(),
            digest,
            membership_digest,
            claims,
            facets,
        });
    }
    names.sort_by(|a, b| (&a.qualified_label, &a.id).cmp(&(&b.qualified_label, &b.id)));
    Ok(names)
}

/// Provenance changes when another name in a shared Facet changes. The
/// semantic claim body, role and defects are the cited name's meaning.
fn grounding_claims<'a>(
    facts: impl Iterator<Item = &'a Fact>,
) -> Vec<(
    &'a str,
    &'a str,
    &'a Body,
    &'a [crate::claims::identity::Defect],
)> {
    let mut claims: Vec<_> = facts
        .map(|fact| {
            (
                fact.component.as_str(),
                fact.section.as_str(),
                &fact.body,
                fact.defects.as_slice(),
            )
        })
        .collect();
    claims.sort();
    claims.dedup();
    claims
}

/// Handles number presentation rows, not design meaning. An unrelated Facet
/// can renumber them without changing a name's grounding context.
fn grounding_facets(facets: &[FacetRow]) -> Vec<FacetRow> {
    facets
        .iter()
        .cloned()
        .map(|mut facet| {
            facet.handle.clear();
            facet.context = false;
            facet
        })
        .collect()
}

fn cites(fact: &Fact, name: &str) -> bool {
    match &fact.body {
        Body::Claim {
            subject, object, ..
        } => subject == name || object == name,
        Body::Property { subject, .. } | Body::Measure { subject, .. } => subject == name,
        Body::Guard { value, .. } => value == name,
        Body::Undeclared { declared, .. } => declared.as_deref() == Some(name),
        _ => false,
    }
}

impl Workspace {
    pub fn requests(&self, root: &Path) -> Result<Vec<Request>, String> {
        self.selection
            .implementation
            .files
            .iter()
            .map(|file| self.request(root, file))
            .collect()
    }

    pub fn request(&self, root: &Path, file: &SourceIdentity) -> Result<Request, String> {
        let captured = sources::capture(root, &file.path, MAX_FILE_BYTES)?;
        if captured.identity != *file {
            return Err(format!("{} changed during preparation", file.path));
        }
        let source =
            String::from_utf8(captured.bytes).map_err(|_| format!("{} is not UTF-8", file.path))?;
        Ok(Request {
            binding: Binding {
                format: REQUEST_FORMAT,
                path: file.path.clone(),
                content_hash: file.checksum.clone(),
                names_digest: self.names_digest.clone(),
                selection_digest: self.selection.selection_fingerprint.clone(),
                guidance_fingerprint: guidance::fingerprint(),
                vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
            },
            source,
            names: self.names.clone(),
        })
    }
}

/// Validate before creating any file, including when there are no requests.
pub fn empty_output(out: &Path) -> Result<(), String> {
    match fs::read_dir(out) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                Err(format!(
                    "preparation directory is not empty: {}",
                    out.display()
                ))
            } else {
                Ok(())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", out.display())),
    }
}

pub fn write(requests: &[Request], out: &Path) -> Result<Vec<PathBuf>, String> {
    empty_output(out)?;
    fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut directories = Vec::new();
    for request in requests {
        // Paths never become directory components. Hashing the normalized path
        // gives duplicate-content files distinct safe presentation directories.
        let directory = out.join(format!(
            "file-{}",
            sources::hash(request.binding.path.as_bytes())
        ));
        fs::create_dir(&directory).map_err(|e| format!("{}: {e}", directory.display()))?;
        let emit = |name: &str, bytes: &[u8]| {
            fs::write(directory.join(name), bytes)
                .map_err(|e| format!("{}: {e}", directory.join(name).display()))
        };
        emit("binding.json", &json(&request.binding)?)?;
        emit("request.json", &json(request)?)?;
        emit("source.txt", request.source.as_bytes())?;
        for document in guidance::BUNDLE {
            emit(document.name, document.text.as_bytes())?;
        }
        directories.push(directory);
    }
    Ok(directories)
}
