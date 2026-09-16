//! Captured semantic inputs; no producer identity or Implementation resolution.
use crate::{
    catalog::Catalog,
    frontend::DesignInput,
    sources::{self, CapturedSource, SourceIdentity, hash},
    turtle::ontology_fingerprint,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub const PROJECTION_FORMAT: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub source: SourceIdentity,
    pub ontology: String,
    pub projection_format: u32,
    pub semantic: SemanticInput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "side", rename_all = "lowercase", deny_unknown_fields)]
pub enum SemanticInput {
    Implementation {
        catalog_fingerprint: String,
    },
    Design {
        frontend_version: String,
        dependencies: Vec<SourceIdentity>,
        context: Vec<ContextIdentity>,
        structure: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextIdentity {
    pub path: String,
    pub checksum: Option<String>,
}

impl Binding {
    pub fn fingerprint(&self) -> String {
        hash(&serde_json::to_vec(&("sigil-input-v1", self)).expect("input serialization"))
    }
    pub fn side(&self) -> &'static str {
        match self.semantic {
            SemanticInput::Design { .. } => "design",
            SemanticInput::Implementation { .. } => "implementation",
        }
    }
}

// @sigil implements packages/sigilc/sources.sigil::SigilSourceIdentity::SemanticInputs interface
pub fn implementation(source: &CapturedSource, catalog: &Catalog) -> Binding {
    implementation_identity(&source.identity, catalog)
}

pub fn implementation_identity(source: &SourceIdentity, catalog: &Catalog) -> Binding {
    Binding {
        source: source.clone(),
        ontology: ontology_fingerprint(),
        projection_format: PROJECTION_FORMAT,
        semantic: SemanticInput::Implementation {
            catalog_fingerprint: catalog.fingerprint().into(),
        },
    }
}

pub struct DesignSnapshot {
    input: DesignInput,
    sources: BTreeMap<String, SourceIdentity>,
    context: Vec<ContextIdentity>,
}

impl DesignSnapshot {
    pub fn input(&self) -> &DesignInput {
        &self.input
    }

    /// Everything supplied to a Design interpreter is covered by this source's key.
    pub fn preparation(&self, source: &str) -> Result<serde_json::Value, String> {
        let binding = self.binding(source)?;
        let SemanticInput::Design { dependencies, .. } = &binding.semantic else {
            unreachable!()
        };
        let paths: BTreeSet<_> = dependencies
            .iter()
            .map(|d| d.path.as_str())
            .chain(std::iter::once(source))
            .collect();
        Ok(serde_json::json!({
            "schemaVersion": self.input.schema_version,
            "frontendVersion": self.input.frontend_version,
            "languageVersion": self.input.language_version,
            "target": self.input.sources.iter().find(|s| s.path == source),
            "dependencies": self.input.sources.iter().filter(|s| s.path != source && paths.contains(s.path.as_str())).collect::<Vec<_>>(),
            "context": self.input.context,
            "entities": self.input.entities.iter().filter(|e| paths.contains(e.source.as_str())).collect::<Vec<_>>(),
            "units": self.input.units.iter().filter(|u| paths.contains(u.source.as_str())).collect::<Vec<_>>(),
            "imports": self.input.imports.iter().filter(|i| paths.contains(i.source.as_str())).collect::<Vec<_>>(),
            "groups": self.input.groups.iter().filter(|g| paths.contains(g.source.as_str())).collect::<Vec<_>>(),
            "introductions": self.input.introductions.iter().filter(|i| paths.contains(i.source.as_str())).collect::<Vec<_>>(),
            "references": self.input.references.iter().filter(|r| paths.contains(r.source.as_str())).collect::<Vec<_>>(),
            "links": self.input.links.iter().filter(|l| paths.contains(l.source.as_str())).collect::<Vec<_>>(),
        }))
    }

    /// Check the exact buffers resolved by TypeScript, including absent context.
    pub fn capture(root: &Path, input: DesignInput, max_file_bytes: u64) -> Result<Self, String> {
        input.validate()?;
        let mut sources = BTreeMap::new();
        for source in &input.sources {
            let current = sources::capture(root, &source.path, max_file_bytes)?;
            if current.bytes != source.text.as_bytes() {
                return Err(format!("frontend source changed: {}", source.path));
            }
            sources.insert(source.path.clone(), current.identity);
        }
        let mut context = Vec::new();
        for source in &input.context {
            let path = sources::checked_path(root, &source.path)?;
            let checksum = if let Some(text) = &source.text {
                let current = sources::capture(root, &source.path, max_file_bytes)?;
                if current.bytes != text.as_bytes() {
                    return Err(format!("frontend context changed: {}", source.path));
                }
                Some(current.identity.checksum)
            } else {
                match std::fs::symlink_metadata(path) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(e) => return Err(e.to_string()),
                    Ok(_) => return Err(format!("frontend context appeared: {}", source.path)),
                }
            };
            context.push(ContextIdentity {
                path: source.path.clone(),
                checksum,
            });
        }
        context.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Self {
            input,
            sources,
            context,
        })
    }

    pub fn binding(&self, source: &str) -> Result<Binding, String> {
        let target = self
            .sources
            .get(source)
            .ok_or_else(|| format!("Design source not selected: {source}"))?;
        let closure = crate::scope::design_membership(&self.input, [source]).sources;
        let dependencies = closure
            .iter()
            .filter(|p| p.as_str() != source)
            .map(|p| self.sources[p].clone())
            .collect();
        let structure = hash(
            &serde_json::to_vec(&(
                self.input.schema_version,
                &self.input.language_version,
                sorted(
                    self.input
                        .groups
                        .iter()
                        .filter(|g| closure.contains(&g.source)),
                )?,
                sorted(
                    self.input
                        .introductions
                        .iter()
                        .filter(|i| closure.contains(&i.source)),
                )?,
                sorted(
                    self.input
                        .references
                        .iter()
                        .filter(|r| closure.contains(&r.source)),
                )?,
                sorted(
                    self.input
                        .links
                        .iter()
                        .filter(|l| closure.contains(&l.source)),
                )?,
                sorted(
                    self.input
                        .imports
                        .iter()
                        .filter(|i| closure.contains(i.source.as_str())),
                )?,
                sorted(
                    self.input
                        .entities
                        .iter()
                        .filter(|e| closure.contains(e.source.as_str())),
                )?,
                sorted(
                    self.input
                        .units
                        .iter()
                        .filter(|u| closure.contains(u.source.as_str())),
                )?,
            ))
            .map_err(|e| e.to_string())?,
        );
        Ok(Binding {
            source: target.clone(),
            ontology: ontology_fingerprint(),
            projection_format: PROJECTION_FORMAT,
            semantic: SemanticInput::Design {
                frontend_version: self.input.frontend_version.clone(),
                dependencies,
                context: self.context.clone(),
                structure,
            },
        })
    }

    /// World membership changes reports without polluting an Implementation key.
    pub fn fingerprint(&self) -> Result<String, String> {
        let bindings: Vec<_> = self
            .sources
            .keys()
            .map(|p| self.binding(p))
            .collect::<Result<_, _>>()?;
        Ok(hash(
            &serde_json::to_vec(&("sigil-design-input-v2", bindings)).map_err(|e| e.to_string())?,
        ))
    }
}

fn sorted<T: Serialize>(items: impl Iterator<Item = T>) -> Result<Vec<String>, String> {
    let mut rows = items
        .map(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    rows.sort();
    Ok(rows)
}
