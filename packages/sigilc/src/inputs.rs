//! Captured semantic inputs; no producer identity or Implementation resolution.
use crate::{
    catalog::Catalog,
    sources::{CapturedSource, SourceIdentity, hash},
    structure::{DesignInput, Severity},
    turtle::ontology_fingerprint,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

/// Format 3: a Design binding holds the source's content identity and the
/// interface hashes of what it imports, not whole-closure checksums.
pub const PROJECTION_FORMAT: u32 = 3;

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
        reader_version: String,
        imports: Vec<ImportedInterface>,
        context: Vec<ContextIdentity>,
        structure: String,
    },
}

/// What a source reads of one imported component: nothing but its interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedInterface {
    /// The workspace path of the importing target.
    pub path: String,
    pub component: String,
    /// The interface hash of every component of that name in the target,
    /// sorted. Empty when the import did not resolve.
    pub interface: Vec<String>,
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

#[derive(Debug, Clone)]
pub struct SourceBasis {
    /// The source's path and its content file id from the tree, which a pure
    /// reformat leaves unchanged.
    pub identity: SourceIdentity,
    pub imports: Vec<ImportedInterface>,
    /// Hash of the source's own resolution, with no position in it.
    pub structure: String,
    /// Own component IRI to the Tag names its interface exposes.
    pub exposed: BTreeMap<String, Vec<String>>,
}

/// Everything a Design binding reads from the trees, for every source.
#[derive(Debug, Clone)]
pub struct DesignBasis {
    pub reader_version: String,
    pub sources: BTreeMap<String, SourceBasis>,
    pub context: Vec<ContextIdentity>,
}

impl DesignBasis {
    pub fn binding(&self, source: &str) -> Result<Binding, String> {
        let basis = self
            .sources
            .get(source)
            .ok_or_else(|| format!("Design source not selected: {source}"))?;
        Ok(Binding {
            source: basis.identity.clone(),
            ontology: ontology_fingerprint(),
            projection_format: PROJECTION_FORMAT,
            semantic: SemanticInput::Design {
                reader_version: self.reader_version.clone(),
                imports: basis.imports.clone(),
                context: self.context.clone(),
                structure: basis.structure.clone(),
            },
        })
    }
}

/// Name every field that differs between two bindings, for a rejection message.
pub fn moved(previous: &Binding, current: &Binding) -> String {
    let mut fields = Vec::new();
    if previous.ontology != current.ontology {
        fields.push("ontology".to_owned());
    }
    if previous.projection_format != current.projection_format {
        fields.push("projection format".to_owned());
    }
    if previous.source != current.source {
        fields.push("source content".to_owned());
    }
    match (&previous.semantic, &current.semantic) {
        (
            SemanticInput::Design {
                reader_version: pv,
                imports: pi,
                context: pc,
                structure: ps,
            },
            SemanticInput::Design {
                reader_version: cv,
                imports: ci,
                context: cc,
                structure: cs,
            },
        ) => {
            if pv != cv {
                fields.push("reader version".into());
            }
            let key = |i: &ImportedInterface| (i.path.clone(), i.component.clone());
            let before: BTreeMap<_, _> = pi.iter().map(|i| (key(i), &i.interface)).collect();
            let after: BTreeMap<_, _> = ci.iter().map(|i| (key(i), &i.interface)).collect();
            for k in before.keys().chain(after.keys()).collect::<BTreeSet<_>>() {
                if before.get(k) != after.get(k) {
                    fields.push(format!("interface of {}::{}", k.0, k.1));
                }
            }
            if pc != cc {
                fields.push("context".into());
            }
            if ps != cs {
                fields.push("source structure".into());
            }
        }
        (
            SemanticInput::Implementation {
                catalog_fingerprint: p,
            },
            SemanticInput::Implementation {
                catalog_fingerprint: c,
            },
        ) => {
            if p != c {
                fields.push("entity catalog".into());
            }
        }
        _ => fields.push("side".into()),
    }
    fields.join(", ")
}

/// Whether the structure rows hold anything unresolved or incomplete, for one
/// source or (with `None`) for every source.
pub fn structural_flaw(input: &DesignInput, source: Option<&str>) -> bool {
    let of = |s: &str| source.is_none_or(|p| p == s);
    input
        .entities
        .iter()
        .any(|e| of(&e.source) && (!e.valid || !e.complete || !e.identity_resolved))
        || input
            .units
            .iter()
            .any(|u| of(&u.source) && (!u.valid || !u.complete || u.owner.is_none()))
        || input
            .groups
            .iter()
            .any(|g| of(&g.source) && (!g.valid || !g.complete))
        || input
            .introductions
            .iter()
            .any(|i| of(&i.source) && (!i.valid || !i.complete || i.tag.is_none()))
        || input
            .references
            .iter()
            .any(|r| of(&r.source) && r.tag.is_none())
        || input.imports.iter().any(|i| {
            of(&i.source)
                && (!i.valid
                    || !i.complete
                    || i.status != crate::structure::ImportStatus::Resolved
                    || i.names
                        .iter()
                        .any(|n| n.status != crate::structure::SelectionStatus::Resolved))
        })
}

/// Sources that cannot be interpreted, with why. A source is invalid when its
/// own tree, or any source in its import closure, has an error diagnostic or an
/// unresolved structure; a workspace-level error invalidates every source.
/// Nothing widens another source's closure.
fn invalid_sources(input: &DesignInput) -> BTreeMap<String, String> {
    let paths: BTreeSet<&str> = input.sources.iter().map(|s| s.path.as_str()).collect();
    let error = |d: &&crate::structure::Diagnostic| matches!(d.severity, Severity::Error);
    let describe =
        |d: &crate::structure::Diagnostic| format!("design error {}: {}", d.code, d.message);
    let global = input
        .diagnostics
        .iter()
        .filter(error)
        .find(|d| d.file_path.as_deref().is_none_or(|p| !paths.contains(p)))
        .map(describe);
    let own: BTreeMap<&str, String> = paths
        .iter()
        .filter_map(|&p| {
            let reason = input
                .diagnostics
                .iter()
                .filter(error)
                .find(|d| d.file_path.as_deref() == Some(p))
                .map(describe)
                .or_else(|| {
                    structural_flaw(input, Some(p))
                        .then(|| "unresolved or incomplete language structure".to_owned())
                });
            reason.map(|r| (p, r))
        })
        .collect();
    let mut invalid = BTreeMap::new();
    for &path in &paths {
        if let Some(reason) = &global {
            invalid.insert(path.to_owned(), reason.clone());
            continue;
        }
        let mut seen = BTreeSet::new();
        let mut pending = vec![path];
        while let Some(current) = pending.pop() {
            if !seen.insert(current) {
                continue;
            }
            if let Some(reason) = own.get(current) {
                let reason = if current == path {
                    reason.clone()
                } else {
                    format!("import closure: {current}: {reason}")
                };
                invalid.insert(path.to_owned(), reason);
                break;
            }
            pending.extend(
                input
                    .imports
                    .iter()
                    .filter(|i| i.source == current)
                    .filter_map(|i| i.target.as_deref()),
            );
        }
    }
    invalid
}

fn strip_ranges(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|k, _| !k.to_ascii_lowercase().ends_with("range"));
            map.values_mut().for_each(strip_ranges);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_ranges),
        _ => (),
    }
}

fn rows<T: Serialize>(items: impl Iterator<Item = T>) -> Vec<Value> {
    items
        .map(|i| serde_json::to_value(i).expect("rows serialize"))
        .collect()
}

pub struct DesignSnapshot {
    input: DesignInput,
    basis: DesignBasis,
    invalid: BTreeMap<String, String>,
}

impl DesignSnapshot {
    /// `input` may be narrowed to a scope; bindings never depend on it.
    pub fn new(input: DesignInput, basis: DesignBasis) -> Result<Self, String> {
        input.assert_consistent()?;
        let invalid = invalid_sources(&input);
        Ok(Self {
            input,
            basis,
            invalid,
        })
    }

    /// Read the workspace at `root` with its tree cache in `store`.
    pub fn load(root: &Path, store: &Path) -> Result<Self, String> {
        let (input, basis) = crate::tree::design_input::load_design(root, store)?;
        Self::new(input, basis)
    }

    pub fn input(&self) -> &DesignInput {
        &self.input
    }

    /// Why this source cannot be interpreted or compiled, if it cannot.
    pub fn invalid(&self, source: &str) -> Option<&str> {
        self.invalid.get(source).map(String::as_str)
    }

    pub fn require_valid(&self, source: &str) -> Result<(), String> {
        if !self.input.sources.iter().any(|s| s.path == source) {
            return Err(format!("Design source not selected: {source}"));
        }
        match self.invalid(source) {
            Some(reason) => Err(format!("Design source is invalid: {source}: {reason}")),
            None => Ok(()),
        }
    }

    /// What a Design interpreter is shown: the source's own tree, and of each
    /// component it imports only the interface (its Facets with their text, and
    /// the Component and interface Tag entities that ground references to it).
    /// No other section of a dependency and none of its source text is here.
    pub fn preparation(&self, source: &str) -> Result<Value, String> {
        let input = &self.input;
        let binding = self.binding(source)?;
        let SemanticInput::Design { imports, .. } = &binding.semantic else {
            unreachable!()
        };
        let own = |s: &str| s == source;
        let basis = &self.basis.sources;
        let used_tags: BTreeSet<&str> = input
            .references
            .iter()
            .filter(|r| own(&r.source))
            .filter_map(|r| r.tag.as_deref())
            .chain(
                input
                    .imports
                    .iter()
                    .filter(|i| own(&i.source))
                    .flat_map(|i| &i.names)
                    .filter_map(|n| n.entity.as_deref()),
            )
            .collect();
        let mut dependencies = Vec::new();
        let mut dependency_entities: Vec<&crate::structure::Entity> = Vec::new();
        let mut seen = BTreeSet::new();
        for import in input.imports.iter().filter(|i| own(&i.source)) {
            let (Some(target), Some(component)) = (&import.target, &import.provider_id) else {
                continue;
            };
            if !seen.insert(component.as_str()) {
                continue;
            }
            let exposed: BTreeSet<&str> = basis
                .get(target)
                .and_then(|b| b.exposed.get(component))
                .into_iter()
                .flatten()
                .map(String::as_str)
                .collect();
            let entities: Vec<&crate::structure::Entity> = input
                .entities
                .iter()
                .filter(|e| {
                    e.id == *component
                        || (e.owner.as_deref() == Some(component)
                            && (exposed.contains(e.label.as_str())
                                || used_tags.contains(e.id.as_str())))
                })
                .collect();
            dependency_entities.extend(entities.iter().copied());
            let text = &input
                .sources
                .iter()
                .find(|s| s.path == *target)
                .ok_or("imported source is not selected")?
                .text;
            let groups: BTreeMap<&str, &crate::structure::Group> =
                input.groups.iter().map(|g| (g.id.as_str(), g)).collect();
            let units: Vec<Value> = input
                .units
                .iter()
                .filter(|u| {
                    u.owner.as_deref() == Some(component.as_str())
                        && u.section == crate::structure::Section::Interface
                })
                .map(|u| {
                    serde_json::json!({
                        "id": u.id,
                        "owner": u.owner,
                        "section": u.section,
                        "text": text.get(u.range.start..u.range.end).unwrap_or(""),
                        "grouping": u.grouping.as_deref().and_then(|g| groups.get(g)).map(|g| serde_json::json!({"name": g.name, "tag": g.tag})),
                    })
                })
                .collect();
            let interface = imports
                .iter()
                .find(|i| i.path == *target && i.component == import.provider)
                .map(|i| i.interface.clone())
                .unwrap_or_default();
            dependencies.push(serde_json::json!({
                "source": target,
                "component": component,
                "label": import.provider,
                "interfaceHash": interface,
                "units": units,
                "entities": entities.iter().map(|e| e.id.clone()).collect::<Vec<_>>(),
            }));
        }
        let mut entities = rows(input.entities.iter().filter(|e| own(&e.source)));
        let mut imported = rows(dependency_entities.iter());
        imported.iter_mut().for_each(strip_ranges);
        entities.extend(imported);
        // The same Component can be imported twice; each entity is listed once.
        let mut listed = BTreeSet::new();
        entities.retain(|e| listed.insert(e["id"].as_str().unwrap_or_default().to_owned()));
        let mut dependencies = Value::Array(dependencies);
        strip_ranges(&mut dependencies);
        Ok(serde_json::json!({
            "schemaVersion": input.schema_version,
            "readerVersion": input.reader_version,
            "languageVersion": input.language_version,
            "target": input.sources.iter().find(|s| s.path == source),
            "dependencies": dependencies,
            "context": input.context,
            "entities": entities,
            "units": rows(input.units.iter().filter(|u| own(&u.source))),
            "imports": rows(input.imports.iter().filter(|i| own(&i.source))),
            "groups": rows(input.groups.iter().filter(|g| own(&g.source))),
            "introductions": rows(input.introductions.iter().filter(|i| own(&i.source))),
            "references": rows(input.references.iter().filter(|r| own(&r.source))),
            "links": rows(input.links.iter().filter(|l| own(&l.source))),
        }))
    }

    pub fn binding(&self, source: &str) -> Result<Binding, String> {
        if !self.input.sources.iter().any(|s| s.path == source) {
            return Err(format!("Design source not selected: {source}"));
        }
        self.basis.binding(source)
    }

    /// World membership changes reports without polluting an Implementation key.
    pub fn fingerprint(&self) -> Result<String, String> {
        let paths: BTreeSet<&str> = self.input.sources.iter().map(|s| s.path.as_str()).collect();
        let bindings: Vec<_> = paths
            .into_iter()
            .map(|p| self.binding(p))
            .collect::<Result<_, _>>()?;
        Ok(hash(
            &serde_json::to_vec(&("sigil-design-input-v3", bindings)).map_err(|e| e.to_string())?,
        ))
    }
}
