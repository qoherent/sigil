//! Project a workspace's trees into an interpretation request.
//!
//! Everything the external interpreter needs travels through here: the exact
//! prose of each Facet, the guidance bundle, and an immutable binding that lets
//! ingest refuse a mismatched pair.
//!
//! A request is a black box over dependencies. It presents the selected source
//! in full, plus the interface Facets of each component the source imports as
//! read-only context. A dependency's Logic, State, Constraints, Cases and
//! Decisions Facets are never presented, and neither is any entity introduced
//! only there.
use super::{guidance, identity::Grounding, vocabulary};
use crate::{
    inputs::DesignBasis,
    sources,
    structure::{DesignInput, EntityType, ImportStatus, ReferenceStatus, SelectionStatus, Unit},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Changes when the request or binding layout becomes incompatible.
///
/// 2 adds the Logic grouping: a flow spans a component's whole Logic section,
/// so a request that presents those Facets only one at a time cannot express
/// one. 3 widened presentation to the whole resolved closure and 4 added a
/// per-source `imports` list so an interpreter could tell an imported component
/// from one that merely shared the closure. 5 narrows presentation again, to
/// the black box: the selected source plus each imported component's interface
/// Facets, marked `context`, and an entity list limited to local entities and
/// the Tags those interfaces expose. The binding stops covering the whole input
/// and covers the source's content id and its imports' interface hashes
/// instead. A directory prepared under an earlier format must be re-prepared.
/// 6 gives each own Facet a handle and the list of names it may use, and each
/// Logic section the handles of its Facets.
pub const REQUEST_FORMAT: u32 = 6;

/// One Facet handed to the interpreter, pre-filled with its own identity.
///
/// The contract role is present so the interpreter knows what kind of claim the
/// Facet can support, but it is not a column of any row that comes back: the
/// tool fills that from the workspace when it re-emits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FacetRow {
    /// Copied verbatim into every row the interpreter returns for this Facet.
    /// A content id: it survives an edit that only moves the Facet.
    pub facet: String,
    pub component: String,
    pub component_label: String,
    pub section: String,
    pub source: String,
    pub prose: String,
    /// A short name for this Facet, `#N`, which an answer may use wherever it
    /// names the Facet. Numbered over the request's own Facets in id order, so a
    /// handle means the same Facet in every presentation of one binding. An
    /// imported component's interface Facet has none.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub handle: String,
    /// The names this Facet may use, as labels: its own component, the
    /// components its source imports from, and the Tags its prose references or
    /// introduces. A row naming anything else is refused.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub names: Vec<String>,
    /// An imported component's interface Facet. Read-only context: the
    /// interpreter reads it to understand the names it exposes and returns
    /// nothing for it. Its own reading comes from its own source's run.
    #[serde(default, skip_serializing_if = "is_false")]
    pub context: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// An entity a claim from this design may name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmissibleEntity {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub owner: Option<String>,
    pub source: String,
}

/// One component a source imports from, with the Tag names it takes.
///
/// Only a resolved import enters here, and only the names that resolved. A claim
/// may name a component only when the Facet's own component or the Facet's
/// source imports from it, so this is the list an interpreter checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedFrom {
    pub component: String,
    pub component_label: String,
    pub names: Vec<String>,
}

/// The components one source imports from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceImports {
    pub source: String,
    pub from: Vec<ImportedFrom>,
}

/// The interface hash of one component the selected source imports.
///
/// The hash covers exactly what an importer may select, so a dependency's
/// private sections never move it. An unresolved import has an empty hash.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterfaceBinding {
    /// The workspace path of the importing target.
    pub path: String,
    pub component: String,
    pub hash: String,
}

impl InterfaceBinding {
    /// `path::component`, the key a stored reading records the hash under.
    pub fn key(&self) -> String {
        format!("{}::{}", self.path, self.component)
    }
}

/// What ingest checks before it trusts a returned artifact.
///
/// Every field is a content identity or a tool constant, never an offset or the
/// resolved tree id, which moves with source bytes. An edit to an unrelated
/// file or to a dependency's private sections moves none of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub format: u32,
    pub source: String,
    /// The selected source's content file id, stable under reformatting.
    pub source_content: String,
    /// The interface hash of each component the source imports.
    pub interfaces: Vec<InterfaceBinding>,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
    /// The Facet ids this request presented, including imported interface
    /// context, which bounds what may come back.
    pub facets: Vec<String>,
}

impl Binding {
    pub fn digest(&self) -> String {
        sources::hash(
            &serde_json::to_vec(&("sigil-claims-binding-v2", self)).expect("binding serialization"),
        )
    }
}

/// One component's Logic section, named as a whole.
///
/// A flow spans a section rather than a Facet, because a Facet is a paragraph:
/// the flow in `packages/core/src/pipeline.sigil` runs through three of its five
/// Logic Facets. An interpreter shown those Facets one at a time cannot express
/// an edge between them, so the section is named here and its Facets listed in
/// source order.
///
/// This carries no prose. Each Facet keeps its own row in `rows`, with its own
/// identity and prose slice, exactly as every other role does; the grouping adds
/// membership and order, and takes nothing away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogicSection {
    pub component: String,
    pub component_label: String,
    pub source: String,
    /// The section's Facet identities in source order. A step's ordinal runs
    /// across this whole list, which is what lets an edge cross from one Facet
    /// to another.
    pub facets: Vec<String>,
    /// The handles of those Facets, in the same order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handles: Vec<String>,
}

/// A prepared interpretation request, before it reaches disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub binding: Binding,
    /// The selected source's Facets, then imported interface Facets marked
    /// `context`.
    pub rows: Vec<FacetRow>,
    /// One entry per component of the selected source that declares a Logic
    /// section, in component order. A component without one appears nowhere
    /// here rather than as an empty group.
    pub flows: Vec<LogicSection>,
    pub entities: Vec<AdmissibleEntity>,
    /// The components the selected source imports from. Empty when it imports
    /// nothing.
    pub imports: Vec<SourceImports>,
    /// Contract roles of the selected source that declare at least one Facet,
    /// as `component\tsection` pairs. This is the denominator for whether an
    /// interpretation covered the design, so it is recorded at preparation
    /// rather than recomputed later.
    pub declared: Vec<(String, String)>,
}

impl Request {
    /// The rows of the selected source: the interpretation targets.
    pub fn own_rows(&self) -> impl Iterator<Item = &FacetRow> {
        self.rows.iter().filter(|r| !r.context)
    }
}

/// The same request, presenting only the units named.
///
/// The binding is copied whole rather than narrowed. Ingest recomputes the
/// request from the workspace and compares bindings, so a narrowed binding would
/// make every prepared directory fail its own check. What narrows is what the
/// interpreter is shown; what it may return is unchanged, and a row it sends
/// back for a unit that was not asked for is a second interpretation of that
/// unit rather than an error. Imported interface context is shown only when
/// something is asked, because it exists to explain the units that are.
pub fn presenting(request: &Request, units: &[super::memo::Unit]) -> Request {
    let asked: BTreeSet<&str> = units
        .iter()
        .filter(|u| !u.context)
        .flat_map(|u| u.facets.iter().map(String::as_str))
        .collect();
    let any = !asked.is_empty();
    // A flow's guard names the Constraints Facet it guards on. When a Logic
    // section is asked again alone, that Facet may be stored already and so not
    // asked, and the interpreter could not name what it cannot see. It is shown
    // as context: read for its prose and handle, answered by nothing.
    let flowing: BTreeSet<&str> = request
        .flows
        .iter()
        .filter(|f| f.facets.iter().any(|x| asked.contains(x.as_str())))
        .map(|f| f.component.as_str())
        .collect();
    let rows = request
        .rows
        .iter()
        .filter_map(|r| {
            if asked.contains(r.facet.as_str()) || (any && r.context) {
                Some(r.clone())
            } else if !r.context
                && r.section == "constraints"
                && flowing.contains(r.component.as_str())
            {
                Some(FacetRow {
                    context: true,
                    names: Vec::new(),
                    ..r.clone()
                })
            } else {
                None
            }
        })
        .collect();
    Request {
        binding: request.binding.clone(),
        rows,
        flows: request
            .flows
            .iter()
            .filter(|f| f.facets.iter().any(|x| asked.contains(x.as_str())))
            .cloned()
            .collect(),
        entities: request.entities.clone(),
        imports: request.imports.clone(),
        declared: request.declared.clone(),
    }
}

/// Hash of every resolved tree's content file id: run evidence that names the
/// workspace a `prepare` read. Never bound on, because an edit anywhere would
/// then reject an `ingest` it does not concern.
pub fn workspace_digest(basis: &DesignBasis) -> String {
    let files: Vec<(&String, &String)> = basis
        .sources
        .iter()
        .map(|(path, source)| (path, &source.identity.checksum))
        .collect();
    sources::hash(
        &serde_json::to_vec(&("sigil-claims-workspace-v1", files)).expect("digest serialization"),
    )
}

/// Build the request for one design source: itself in full and the interface of
/// each component it imports.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn project(input: &DesignInput, basis: &DesignBasis, source: &str) -> Result<Request, String> {
    if !input.sources.iter().any(|s| s.path == source) {
        return Err(format!("design source not found: {source}"));
    }
    let own_basis = basis
        .sources
        .get(source)
        .ok_or_else(|| format!("design source has no tree: {source}"))?;

    // The imported components, through the selected source's resolved imports.
    let mut providers: BTreeMap<&str, &str> = BTreeMap::new(); // component IRI -> target path
    for import in &input.imports {
        if import.source != source || import.status != ImportStatus::Resolved {
            continue;
        }
        if let (Some(provider), Some(target)) = (import.provider_id.as_deref(), &import.target)
            && target != source
        {
            providers.insert(provider, target.as_str());
        }
    }

    let mut rows = Vec::new();
    // Coverage is the selected source's alone. Imported interface Facets are
    // context, never a gap this run's report names.
    let mut declared = BTreeSet::new();
    // Logic Facets, keyed by component, in the order the prose is authored.
    // Ordered by the unit's byte offset rather than by Facet identity, which is
    // a content hash. The offset orders and identifies nothing.
    let mut flows: BTreeMap<(String, String, String), Vec<(usize, String)>> = BTreeMap::new();
    for unit in input.units.iter().filter(|u| u.source == source) {
        let Some(row) = facet_row(input, unit, false)? else {
            continue;
        };
        declared.insert((row.component.clone(), row.section.clone()));
        if row.section == "logic" {
            flows
                .entry((
                    row.component.clone(),
                    row.component_label.clone(),
                    row.source.clone(),
                ))
                .or_default()
                .push((unit.prose_range.start, row.facet.clone()));
        }
        rows.push(row);
    }
    rows.sort_by(|a, b| a.facet.cmp(&b.facet));

    // Interface Facets of each imported component, as read-only context.
    let mut context_rows = Vec::new();
    for unit in input.units.iter().filter(|u| {
        u.owner
            .as_deref()
            .is_some_and(|owner| providers.contains_key(owner))
            && vocabulary::section_name(&u.section) == "interface"
    }) {
        if let Some(row) = facet_row(input, unit, true)? {
            context_rows.push(row);
        }
    }
    context_rows.sort_by(|a, b| a.facet.cmp(&b.facet));
    context_rows.dedup_by(|a, b| a.facet == b.facet);
    rows.extend(context_rows);

    // A handle and a list of names for each of the source's own Facets. The
    // handle is numbered over the whole source, never over what a later
    // presentation narrows to, so it stays the same across a re-ask.
    for (index, row) in rows.iter_mut().filter(|r| !r.context).enumerate() {
        row.handle = format!("{}{}", vocabulary::HANDLE_PREFIX, index + 1);
    }
    let grounding = Grounding::build(input, &rows);
    let entity_label: BTreeMap<&str, &str> = input
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.label.as_str()))
        .collect();
    for row in rows.iter_mut().filter(|r| !r.context) {
        let names: BTreeSet<&str> = grounding
            .allowed(&row.facet)
            .into_iter()
            .flatten()
            .filter_map(|id| entity_label.get(id.as_str()).copied())
            .collect();
        row.names = names.into_iter().map(str::to_owned).collect();
    }
    let handle_of: BTreeMap<String, String> = rows
        .iter()
        .map(|r| (r.facet.clone(), r.handle.clone()))
        .collect();

    let flows: Vec<LogicSection> = flows
        .into_iter()
        .map(|((component, component_label, source), mut facets)| {
            facets.sort_by_key(|(offset, _)| *offset);
            let facets: Vec<String> = facets.into_iter().map(|(_, facet)| facet).collect();
            LogicSection {
                component,
                component_label,
                source,
                handles: facets
                    .iter()
                    .map(|facet| handle_of.get(facet).cloned().unwrap_or_default())
                    .collect(),
                facets,
            }
        })
        .collect();

    // Entities: the selected source's own, each imported component and the Tags
    // its interface exposes, and any Tag a presented Facet resolves a name to.
    // The last keeps an interface Facet's own references admissible even when
    // they came from a third component; nothing else of a dependency enters.
    let presented: BTreeSet<&str> = rows.iter().map(|r| r.facet.as_str()).collect();
    let mut visible: BTreeSet<&str> = providers.keys().copied().collect();
    for reference in &input.references {
        if reference.status == ReferenceStatus::Resolved
            && presented.contains(reference.facet.as_str())
            && let Some(tag) = reference.tag.as_deref()
        {
            visible.insert(tag);
        }
    }
    for introduction in &input.introductions {
        if let (Some(facet), Some(tag)) =
            (introduction.facet.as_deref(), introduction.tag.as_deref())
            && presented.contains(facet)
        {
            visible.insert(tag);
        }
    }
    let exposed = |owner: &str| -> Option<&Vec<String>> {
        let target = providers.get(owner)?;
        basis.sources.get(*target)?.exposed.get(owner)
    };
    let mut entities: Vec<_> = input
        .entities
        .iter()
        .filter(|e| {
            e.source == source
                || visible.contains(e.id.as_str())
                || (e.kind == EntityType::Tag
                    && e.owner
                        .as_deref()
                        .and_then(exposed)
                        .is_some_and(|names| names.contains(&e.label)))
        })
        .map(|e| AdmissibleEntity {
            id: e.id.clone(),
            kind: format!("{:?}", e.kind),
            label: e.label.clone(),
            owner: e.owner.clone(),
            source: e.source.clone(),
        })
        .collect();
    entities.sort_by(|a, b| a.id.cmp(&b.id));

    let labels: BTreeMap<&str, &str> = input
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.label.as_str()))
        .collect();
    let mut taken: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for import in &input.imports {
        if import.status != ImportStatus::Resolved || import.source != source {
            continue;
        }
        let Some(provider) = import.provider_id.as_deref() else {
            continue;
        };
        taken.entry(provider).or_default().extend(
            import
                .names
                .iter()
                .filter(|n| n.status == SelectionStatus::Resolved)
                .map(|n| n.name.as_str()),
        );
    }
    let imports: Vec<SourceImports> = if taken.is_empty() {
        Vec::new()
    } else {
        vec![SourceImports {
            source: source.to_owned(),
            from: taken
                .into_iter()
                .map(|(provider, names)| ImportedFrom {
                    component: provider.to_owned(),
                    component_label: labels.get(provider).copied().unwrap_or(provider).to_owned(),
                    names: names.into_iter().map(str::to_owned).collect(),
                })
                .collect(),
        }]
    };

    let mut interfaces: Vec<InterfaceBinding> = own_basis
        .imports
        .iter()
        .map(|i| InterfaceBinding {
            path: i.path.clone(),
            component: i.component.clone(),
            hash: if i.interface.len() <= 1 {
                i.interface.first().cloned().unwrap_or_default()
            } else {
                sources::hash(i.interface.join("\n").as_bytes())
            },
        })
        .collect();
    interfaces.sort();
    interfaces.dedup();

    let mut facets: Vec<String> = rows.iter().map(|r| r.facet.clone()).collect();
    facets.sort();
    let binding = Binding {
        format: REQUEST_FORMAT,
        source: source.to_owned(),
        source_content: own_basis.identity.checksum.clone(),
        interfaces,
        guidance_fingerprint: guidance::fingerprint(),
        vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
        facets,
    };
    Ok(Request {
        binding,
        rows,
        flows,
        entities,
        imports,
        declared: declared.into_iter().collect(),
    })
}

/// A Facet's row, or `None` when the unit is not an interpretable Facet.
///
/// Structurally invalid units and units outside a component are skipped: the
/// compiler already reports them, and neither can carry a commitment.
fn facet_row(input: &DesignInput, unit: &Unit, context: bool) -> Result<Option<FacetRow>, String> {
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
        handle: String::new(),
        names: Vec::new(),
        context,
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
