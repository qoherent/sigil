//! Workspace resolution: Tag identity, imports, interface-evidence
//! importability, name collisions, and bare references.
//! A port of `packages/core/src/resolver.ts`.
//!
//! The resolved model is keyed by position, not by id: a component is an index
//! into `ResolvedWorkspace::components`, a Tag is a `TagRef`, and a Facet is a
//! `FacetPos` within its component.
use super::{
    diagnostics::{Location, diagnostic, order_diagnostics},
    parse::{Component, Document, Facet, Group, Span, parse_document},
    path::{normalize_import_path, normalize_path},
    tags::match_tag_references,
    width::prose_width_diagnostics,
    workspace::Workspace,
};
use crate::structure::{Diagnostic, RelatedLocation};
use std::collections::{BTreeMap, HashMap, HashSet};

/// A Facet's position inside its component: section index, then unit index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FacetPos {
    pub section: usize,
    pub unit: usize,
}

/// A Tag owned by a component: component index, then index into its `tags`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TagRef {
    pub component: usize,
    pub tag: usize,
}

/// One selected name: import index, then index into its `names`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SelectionRef {
    pub import: usize,
    pub name: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagStatus {
    Resolved,
    Invalid,
    Ambiguous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntroductionKind {
    Group,
    Inline,
}

#[derive(Debug, Clone)]
pub struct Introduction {
    pub kind: IntroductionKind,
    pub name: String,
    pub section: String,
    pub facet: Option<FacetPos>,
    /// The header start of the grouping Tag that introduces the name.
    pub group_start: Option<usize>,
    pub range: Span,
    pub name_range: Span,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedTag {
    pub name: String,
    pub status: TagStatus,
    pub introductions: Vec<Introduction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessStatus {
    Resolved,
    Ambiguous,
}

#[derive(Debug, Clone)]
pub struct AccessibleTag {
    pub name: String,
    pub status: AccessStatus,
    pub tag: Option<TagRef>,
    pub candidates: Vec<TagRef>,
    pub selections: Vec<SelectionRef>,
}

#[derive(Debug, Clone)]
pub struct ResolvedReference {
    pub name: String,
    pub status: AccessStatus,
    pub tag: Option<TagRef>,
    pub facet: FacetPos,
    pub range: Span,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportStatus {
    Resolved,
    UnresolvedPath,
    UnresolvedProvider,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameStatus {
    Resolved,
    Unresolved,
    Duplicate,
    Ambiguous,
    Invalid,
}

#[derive(Debug, Clone)]
pub struct ImportUse {
    pub component: usize,
    /// Index into that component's `references`.
    pub reference: usize,
    pub facet: FacetPos,
    pub range: Span,
}

#[derive(Debug, Clone)]
pub struct ResolvedImportName {
    pub name: String,
    pub range: Span,
    pub status: NameStatus,
    /// Provider evidence survives duplicate selections; status controls accessibility.
    pub tag: Option<TagRef>,
    pub ambiguous_in: Vec<usize>,
    pub used: bool,
    pub uses: Vec<ImportUse>,
}

#[derive(Debug, Clone)]
pub struct ResolvedImport {
    /// The source file, as an index into `ResolvedWorkspace::documents`.
    pub file: usize,
    /// Index into that document's `imports`.
    pub declaration: usize,
    pub target: Option<usize>,
    pub provider: Option<usize>,
    pub status: ImportStatus,
    pub names: Vec<ResolvedImportName>,
}

#[derive(Debug, Clone)]
pub struct ResolvedComponent {
    pub file: usize,
    /// Index into that document's `components`.
    pub index: usize,
    pub name: String,
    pub identity_resolved: bool,
    pub tags: Vec<ResolvedTag>,
    pub accessible: Vec<AccessibleTag>,
    pub references: Vec<ResolvedReference>,
}

#[derive(Debug)]
pub struct ResolvedWorkspace {
    /// Workspace-relative source paths, aligned with `documents`.
    pub paths: Vec<String>,
    /// False when any file read was not valid UTF-8: nothing is exported.
    pub text_complete: bool,
    pub documents: Vec<Document>,
    pub components: Vec<ResolvedComponent>,
    pub imports: Vec<ResolvedImport>,
    pub diagnostics: Vec<Diagnostic>,
}

impl ResolvedWorkspace {
    pub fn declaration(&self, component: &ResolvedComponent) -> &Component {
        &self.documents[component.file].components[component.index]
    }

    pub fn facet(&self, component: &ResolvedComponent, pos: FacetPos) -> &Facet {
        &self.declaration(component).sections[pos.section].units[pos.unit]
    }
}

impl From<&Workspace> for ResolvedWorkspace {
    fn from(workspace: &Workspace) -> Self {
        let documents: Vec<Document> = workspace
            .sources
            .iter()
            .map(|s| parse_document(&s.path, &s.capture))
            .collect();
        resolve(workspace, documents)
    }
}

const WIDTH_CODES: [&str; 2] = ["SIGIL_LINE_TOO_LONG", "SIGIL_UNFORMATTABLE_LINE"];

fn conflict(
    diagnostics: &mut Vec<Diagnostic>,
    code: &str,
    message: String,
    places: &[(String, Span)],
) {
    if places.is_empty() {
        return;
    }
    let mut sorted = places.to_vec();
    sorted.sort();
    diagnostics.push(diagnostic(
        code,
        message,
        Location {
            file_path: Some(sorted[0].0.clone()),
            range: Some(sorted[0].1.range()),
            related: sorted[1..].iter().map(|p| related(&p.0, p.1)).collect(),
        },
    ));
}

fn related(file: &str, range: Span) -> RelatedLocation {
    RelatedLocation {
        file_path: Some(file.to_owned()),
        range: Some(range.range()),
        implementation_range: None,
        source_digest: None,
        message: None,
    }
}

fn quoted(name: &str) -> String {
    serde_json::to_string(name).expect("a string serializes")
}

fn introductions(component: &Component) -> Vec<Introduction> {
    fn collect(
        group: &Group,
        section: &str,
        out: &mut Vec<Introduction>,
        valid: &mut HashMap<usize, bool>,
    ) {
        valid.insert(group.header_range.start, group.valid);
        out.push(Introduction {
            kind: IntroductionKind::Group,
            name: group.name.clone(),
            section: section.to_owned(),
            facet: None,
            group_start: Some(group.header_range.start),
            range: group.header_range,
            name_range: group.name_range,
            valid: group.valid,
            complete: group.complete,
        });
        for child in &group.groups {
            collect(child, section, out, valid);
        }
    }
    let mut result = Vec::new();
    for (si, section) in component.sections.iter().enumerate() {
        if !section.known {
            continue;
        }
        let mut group_valid = HashMap::new();
        for group in &section.groups {
            collect(group, &section.name, &mut result, &mut group_valid);
        }
        for (ui, facet) in section.units.iter().enumerate() {
            for definition in &facet.definitions {
                result.push(Introduction {
                    kind: IntroductionKind::Inline,
                    name: definition.name.clone(),
                    section: facet.section.clone(),
                    facet: Some(FacetPos {
                        section: si,
                        unit: ui,
                    }),
                    group_start: None,
                    range: definition.range,
                    name_range: definition.name_range,
                    valid: definition.valid
                        && facet
                            .group
                            .as_ref()
                            .is_none_or(|g| group_valid.get(&g.header_start) == Some(&true)),
                    complete: true,
                });
            }
        }
    }
    result.sort_by_key(|i| i.range.start);
    result
}

struct State<'a> {
    workspace: &'a Workspace,
    documents: &'a [Document],
    components: Vec<ResolvedComponent>,
    imports: Vec<ResolvedImport>,
    diagnostics: Vec<Diagnostic>,
}

impl State<'_> {
    fn path(&self, file: usize) -> &str {
        &self.workspace.sources[file].path
    }

    fn declaration(&self, component: usize) -> &Component {
        let c = &self.components[component];
        &self.documents[c.file].components[c.index]
    }

    /// The accessible vocabulary of one component, given the selections of its file.
    fn set_vocabulary(
        &mut self,
        component: usize,
        selections: &BTreeMap<String, Vec<SelectionRef>>,
    ) {
        let locals: BTreeMap<&str, usize> = self.components[component]
            .tags
            .iter()
            .enumerate()
            .map(|(i, t)| (t.name.as_str(), i))
            .collect();
        let mut names: Vec<String> = locals.keys().map(|n| n.to_string()).collect();
        names.extend(selections.keys().cloned());
        names.sort();
        names.dedup();
        let file_path = self.path(self.components[component].file).to_owned();
        let component_name = self.components[component].name.clone();
        let mut accessible = Vec::new();
        let mut conflicts: Vec<(String, Vec<(String, Span)>)> = Vec::new();
        for name in names {
            let local = locals.get(name.as_str()).copied();
            let selected: &[SelectionRef] = selections.get(&name).map_or(&[], |v| v.as_slice());
            // Invalid headings are evidence, not declarations. Duplicate inline definitions
            // are ambiguous local declarations and cannot be rescued by another heading.
            let local_declaration =
                local.filter(|i| self.components[component].tags[*i].status != TagStatus::Invalid);
            let collision = local_declaration.is_some() && !selected.is_empty();
            if collision {
                let local_tag = &self.components[component].tags[local_declaration.unwrap()];
                let mut places: Vec<(String, Span)> = local_tag
                    .introductions
                    .iter()
                    .filter(|i| i.valid)
                    .map(|i| (file_path.clone(), i.range))
                    .collect();
                places.extend(selected.iter().map(|s| {
                    (
                        file_path.clone(),
                        self.imports[s.import].names[s.name].range,
                    )
                }));
                conflicts.push((name.clone(), places));
                for s in selected {
                    self.imports[s.import].names[s.name]
                        .ambiguous_in
                        .push(component);
                }
            }
            let mut candidates: Vec<TagRef> = local_declaration
                .map(|i| TagRef { component, tag: i })
                .into_iter()
                .collect();
            candidates.extend(selected.iter().map(|s| {
                self.imports[s.import].names[s.name]
                    .tag
                    .expect("selected tag")
            }));
            if candidates.is_empty() {
                continue;
            }
            let resolved = !collision
                && match local_declaration {
                    Some(i) => self.components[component].tags[i].status == TagStatus::Resolved,
                    None => {
                        selected.len() == 1
                            && self.imports[selected[0].import].names[selected[0].name].status
                                == NameStatus::Resolved
                    }
                };
            accessible.push(AccessibleTag {
                name,
                status: if resolved {
                    AccessStatus::Resolved
                } else {
                    AccessStatus::Ambiguous
                },
                tag: resolved.then(|| candidates[0]),
                candidates,
                selections: selected.to_vec(),
            });
        }
        for (name, places) in conflicts {
            conflict(
                &mut self.diagnostics,
                "SIGIL_TAG_NAME_COLLISION",
                format!(
                    "Local and selected Tags share {} in {component_name}.",
                    quoted(&name)
                ),
                &places,
            );
        }
        self.components[component].accessible = accessible;
    }
}

/// Names that a component's interface makes importable.
fn interface_tag_names(
    component: &ResolvedComponent,
    declaration: &Component,
    source: &super::text::SourceText,
    accessible_names: &[String],
) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut local_names = HashSet::new();
    for tag in &component.tags {
        if tag.status != TagStatus::Resolved {
            continue;
        }
        local_names.insert(tag.name.as_str());
        if tag
            .introductions
            .iter()
            .any(|i| i.section == "interface" && i.valid && i.complete)
        {
            names.insert(tag.name.clone());
        }
    }
    // Local names win over a same-named import, so prose evidence applies to them.
    for section in &declaration.sections {
        if section.name != "interface" || !section.known {
            continue;
        }
        for facet in &section.units {
            for m in match_tag_references(source, &facet.eligible, accessible_names) {
                if local_names.contains(m.name.as_str()) {
                    names.insert(m.name);
                }
            }
        }
    }
    names
}

pub fn resolve(workspace: &Workspace, documents: Vec<Document>) -> ResolvedWorkspace {
    let mut diagnostics: Vec<Diagnostic> = workspace.diagnostics.clone();
    for document in &documents {
        diagnostics.extend(document.diagnostics.iter().cloned());
    }
    diagnostics.retain(|d| !WIDTH_CODES.contains(&d.code.as_str()));
    let paths: Vec<String> = workspace.sources.iter().map(|s| s.path.clone()).collect();
    let by_path: HashMap<String, usize> = paths
        .iter()
        .enumerate()
        .map(|(i, p)| (normalize_path(p), i))
        .collect();

    let mut components: Vec<ResolvedComponent> = Vec::new();
    for (file, document) in documents.iter().enumerate() {
        for (index, declaration) in document.components.iter().enumerate() {
            components.push(ResolvedComponent {
                file,
                index,
                name: declaration.name.clone(),
                identity_resolved: false,
                tags: Vec::new(),
                accessible: Vec::new(),
                references: Vec::new(),
            });
        }
    }
    let mut component_names: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, c) in components.iter().enumerate() {
        component_names.entry(c.name.clone()).or_default().push(i);
    }
    for (name, copies) in &component_names {
        if copies.len() > 1 {
            let places: Vec<(String, Span)> = copies
                .iter()
                .map(|c| {
                    let comp = &components[*c];
                    (
                        paths[comp.file].clone(),
                        documents[comp.file].components[comp.index].name_range,
                    )
                })
                .collect();
            conflict(
                &mut diagnostics,
                "SIGIL_DUPLICATE_COMPONENT",
                format!("Component {name} has multiple declarations."),
                &places,
            );
        } else {
            components[copies[0]].identity_resolved = true;
        }
    }
    #[allow(clippy::needless_range_loop)] // the loop body reads other components too
    for ci in 0..components.len() {
        let (file, index) = (components[ci].file, components[ci].index);
        let mut buckets: BTreeMap<String, Vec<Introduction>> = BTreeMap::new();
        for intro in introductions(&documents[file].components[index]) {
            buckets.entry(intro.name.clone()).or_default().push(intro);
        }
        let mut tags = Vec::new();
        for (name, occurrences) in buckets {
            let definitions: Vec<&Introduction> = occurrences
                .iter()
                .filter(|i| i.kind == IntroductionKind::Inline && i.valid)
                .collect();
            let valid = occurrences.iter().any(|i| i.valid && i.complete);
            let duplicate = definitions.len() > 1;
            if duplicate {
                let places: Vec<(String, Span)> = definitions
                    .iter()
                    .map(|i| (paths[file].clone(), i.range))
                    .collect();
                conflict(
                    &mut diagnostics,
                    "SIGIL_DUPLICATE_TAG_DEFINITION",
                    format!("Tag {} has multiple inline definitions.", quoted(&name)),
                    &places,
                );
            }
            let status = if !components[ci].identity_resolved || duplicate {
                TagStatus::Ambiguous
            } else if valid {
                TagStatus::Resolved
            } else {
                TagStatus::Invalid
            };
            tags.push(ResolvedTag {
                name,
                status,
                introductions: occurrences,
            });
        }
        components[ci].tags = tags;
    }

    let mut imports: Vec<ResolvedImport> = Vec::new();
    for (file, document) in documents.iter().enumerate() {
        for (di, declaration) in document.imports.iter().enumerate() {
            let mut item = ResolvedImport {
                file,
                declaration: di,
                target: None,
                provider: None,
                status: ImportStatus::Resolved,
                names: declaration
                    .selections
                    .iter()
                    .map(|s| ResolvedImportName {
                        name: s.name.clone(),
                        range: s.range,
                        status: if s.valid {
                            NameStatus::Unresolved
                        } else {
                            NameStatus::Invalid
                        },
                        tag: None,
                        ambiguous_in: Vec::new(),
                        used: false,
                        uses: Vec::new(),
                    })
                    .collect(),
            };
            // A complete prefix and individual valid selections survive list recovery.
            let target = normalize_import_path(&declaration.path)
                .and_then(|relative| by_path.get(&relative).copied())
                .filter(|t| documents[*t].source.is_some());
            let Some(target) = target else {
                item.status = ImportStatus::UnresolvedPath;
                diagnostics.push(diagnostic(
                    "SIGIL_UNRESOLVED_IMPORT_PATH",
                    format!(
                        "Import {} does not select an included readable source.",
                        quoted(&declaration.path)
                    ),
                    Location::at(&paths[file], Some(declaration.path_range.range())),
                ));
                imports.push(item);
                continue;
            };
            item.target = Some(target);
            let providers: &[usize] = component_names
                .get(&declaration.provider)
                .map_or(&[], |v| v.as_slice());
            let provider = (providers.len() == 1 && components[providers[0]].file == target)
                .then(|| providers[0])
                .filter(|p| components[*p].identity_resolved);
            let Some(provider) = provider else {
                item.status = ImportStatus::UnresolvedProvider;
                // Missing content cannot establish an absence; known ambiguity remains an error.
                if documents[target].complete || providers.len() > 1 {
                    diagnostics.push(diagnostic(
                        "SIGIL_UNRESOLVED_IMPORTED_COMPONENT",
                        format!(
                            "Source {} does not supply an unambiguous component {}.",
                            paths[target], declaration.provider
                        ),
                        Location {
                            file_path: Some(paths[file].clone()),
                            range: Some(declaration.provider_range.range()),
                            related: providers
                                .iter()
                                .filter(|p| providers.len() > 1 || components[**p].file == target)
                                .map(|p| {
                                    let c = &components[*p];
                                    related(
                                        &paths[c.file],
                                        documents[c.file].components[c.index].name_range,
                                    )
                                })
                                .collect(),
                        },
                    ));
                }
                imports.push(item);
                continue;
            };
            item.provider = Some(provider);
            let provider_complete = documents[components[provider].file].components
                [components[provider].index]
                .complete;
            for selection in &mut item.names {
                if selection.status == NameStatus::Invalid {
                    continue;
                }
                let tag = components[provider]
                    .tags
                    .iter()
                    .position(|t| t.name == selection.name);
                let resolved =
                    tag.is_some_and(|t| components[provider].tags[t].status == TagStatus::Resolved);
                if !resolved {
                    if tag.is_some() || provider_complete {
                        diagnostics.push(unresolved_imported_tag(
                            &components[provider],
                            &paths,
                            &paths[file],
                            selection,
                            tag.map(|t| &components[provider].tags[t]),
                        ));
                    }
                    continue;
                }
                selection.tag = tag.map(|t| TagRef {
                    component: provider,
                    tag: t,
                });
                selection.status = NameStatus::Resolved;
            }
            imports.push(item);
        }
    }

    let mut imports_by_file: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, item) in imports.iter().enumerate() {
        imports_by_file.entry(item.file).or_default().push(i);
    }
    // Interface evidence: which Tags each provider makes importable.
    let mut interface_tags: HashMap<usize, HashSet<String>> = HashMap::new();
    for (ci, component) in components.iter().enumerate() {
        let Some(source) = documents[component.file].source.as_ref() else {
            continue;
        };
        let mut accessible: Vec<String> = component
            .tags
            .iter()
            .filter(|t| t.status == TagStatus::Resolved)
            .map(|t| t.name.clone())
            .collect();
        for ii in imports_by_file.get(&component.file).into_iter().flatten() {
            accessible.extend(
                imports[*ii]
                    .names
                    .iter()
                    .filter(|n| n.status == NameStatus::Resolved)
                    .map(|n| n.name.clone()),
            );
        }
        interface_tags.insert(
            ci,
            interface_tag_names(
                component,
                &documents[component.file].components[component.index],
                source,
                &accessible,
            ),
        );
    }
    for item in &mut imports {
        let Some(provider) = item.provider else {
            continue;
        };
        let source_file = item.file;
        for selection in &mut item.names {
            if selection.status != NameStatus::Resolved
                || interface_tags
                    .get(&provider)
                    .is_some_and(|names| names.contains(&selection.name))
            {
                continue;
            }
            let tag = selection.tag.take();
            selection.status = NameStatus::Unresolved;
            let provider_complete = documents[components[provider].file].components
                [components[provider].index]
                .complete;
            if tag.is_some() || provider_complete {
                diagnostics.push(unresolved_imported_tag(
                    &components[provider],
                    &paths,
                    &paths[source_file],
                    selection,
                    tag.map(|t| &components[provider].tags[t.tag]),
                ));
            }
        }
    }

    let mut state = State {
        workspace,
        documents: &documents,
        components,
        imports,
        diagnostics,
    };
    let mut components_by_file: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, c) in state.components.iter().enumerate() {
        components_by_file.entry(c.file).or_default().push(i);
    }
    for (file, import_indices) in &imports_by_file {
        let file_path = state.path(*file).to_owned();
        let selections: Vec<SelectionRef> = import_indices
            .iter()
            .flat_map(|i| {
                (0..state.imports[*i].names.len()).map(|n| SelectionRef {
                    import: *i,
                    name: n,
                })
            })
            .collect();
        let name_of =
            |state: &State, s: &SelectionRef| state.imports[s.import].names[s.name].clone();
        let selected: Vec<SelectionRef> = selections
            .iter()
            .copied()
            .filter(|s| name_of(&state, s).status == NameStatus::Resolved)
            .collect();
        let mut by_identity: BTreeMap<TagRef, Vec<SelectionRef>> = BTreeMap::new();
        for s in &selected {
            by_identity
                .entry(name_of(&state, s).tag.expect("resolved tag"))
                .or_default()
                .push(*s);
        }
        for duplicates in by_identity.values() {
            if duplicates.len() < 2 {
                continue;
            }
            for s in duplicates {
                state.imports[s.import].names[s.name].status = NameStatus::Duplicate;
            }
            let places: Vec<(String, Span)> = duplicates
                .iter()
                .map(|s| (file_path.clone(), name_of(&state, s).range))
                .collect();
            let message = format!(
                "Tag {} is selected more than once.",
                quoted(&name_of(&state, &duplicates[0]).name)
            );
            conflict(
                &mut state.diagnostics,
                "SIGIL_DUPLICATE_TAG_IMPORT",
                message,
                &places,
            );
        }
        let mut by_name: BTreeMap<String, Vec<SelectionRef>> = BTreeMap::new();
        for s in &selected {
            by_name.entry(name_of(&state, s).name).or_default().push(*s);
        }
        for (name, same_name) in &by_name {
            let identities: HashSet<TagRef> = same_name
                .iter()
                .map(|s| name_of(&state, s).tag.expect("resolved tag"))
                .collect();
            if identities.len() < 2 {
                continue;
            }
            for s in same_name {
                let n = &mut state.imports[s.import].names[s.name];
                if n.status != NameStatus::Duplicate {
                    n.status = NameStatus::Ambiguous;
                }
            }
            let places: Vec<(String, Span)> = same_name
                .iter()
                .map(|s| (file_path.clone(), name_of(&state, s).range))
                .collect();
            conflict(
                &mut state.diagnostics,
                "SIGIL_TAG_NAME_COLLISION",
                format!(
                    "Different selected identities share the name {}.",
                    quoted(name)
                ),
                &places,
            );
        }
        for component in components_by_file.get(file).into_iter().flatten() {
            state.set_vocabulary(*component, &by_name);
        }
    }

    // Sources without imports still have a complete local vocabulary.
    let empty = BTreeMap::new();
    for ci in 0..state.components.len() {
        let file = state.components[ci].file;
        let file_imports = imports_by_file.get(&file).cloned().unwrap_or_default();
        if file_imports.is_empty() {
            state.set_vocabulary(ci, &empty);
        }
        let Some(source) = documents[file].source.as_ref() else {
            continue;
        };
        let vocabulary: Vec<AccessibleTag> = state.components[ci].accessible.clone();
        let names: Vec<&str> = vocabulary.iter().map(|t| t.name.as_str()).collect();
        let declaration = state.declaration(ci).clone();
        let mut references = Vec::new();
        let mut uses: Vec<(SelectionRef, ImportUse)> = Vec::new();
        for (si, section) in declaration.sections.iter().enumerate() {
            for (ui, facet) in section.units.iter().enumerate() {
                let pos = FacetPos {
                    section: si,
                    unit: ui,
                };
                for m in match_tag_references(source, &facet.eligible, &names) {
                    let accessible = vocabulary
                        .iter()
                        .find(|t| t.name == m.name)
                        .expect("matched name is in the vocabulary");
                    let reference = ResolvedReference {
                        name: m.name,
                        status: accessible.status,
                        tag: accessible.tag,
                        facet: pos,
                        range: m.range,
                    };
                    references.push(reference.clone());
                    if reference.status != AccessStatus::Resolved {
                        continue;
                    }
                    for s in file_imports.iter().flat_map(|i| {
                        (0..state.imports[*i].names.len()).map(|n| SelectionRef {
                            import: *i,
                            name: n,
                        })
                    }) {
                        if accessible.selections.contains(&s)
                            && state.imports[s.import].names[s.name].status == NameStatus::Resolved
                        {
                            uses.push((
                                s,
                                ImportUse {
                                    component: ci,
                                    reference: references.len() - 1,
                                    facet: pos,
                                    range: m.range,
                                },
                            ));
                        }
                    }
                }
            }
        }
        for (s, usage) in uses {
            let n = &mut state.imports[s.import].names[s.name];
            n.used = true;
            n.uses.push(usage);
        }
        state.components[ci].references = references;
    }
    let mut unused = Vec::new();
    for item in &state.imports {
        for selection in &item.names {
            if selection.status == NameStatus::Resolved
                && !selection.used
                && selection.ambiguous_in.is_empty()
                && documents[item.file].complete
            {
                unused.push(diagnostic(
                    "SIGIL_UNUSED_TAG_IMPORT",
                    format!(
                        "Selected Tag {} has no eligible bare reference.",
                        quoted(&selection.name)
                    ),
                    Location::at(&paths[item.file], Some(selection.range.range())),
                ));
            }
        }
    }
    state.diagnostics.extend(unused);
    for (file, document) in documents.iter().enumerate() {
        let Some(source) = document.source.as_ref() else {
            continue;
        };
        let local: Vec<usize> = components_by_file.get(&file).cloned().unwrap_or_default();
        let facets: Vec<&Facet> = local
            .iter()
            .flat_map(|c| &document.components[state.components[*c].index].sections)
            .flat_map(|s| &s.units)
            .collect();
        let references: Vec<Span> = local
            .iter()
            .flat_map(|c| state.components[*c].references.iter().map(|r| r.range))
            .collect();
        let width = prose_width_diagnostics(&paths[file], source, &facets, &references);
        state.diagnostics.extend(width);
    }
    let State {
        components,
        imports,
        diagnostics,
        ..
    } = state;
    ResolvedWorkspace {
        paths,
        text_complete: workspace.text_complete,
        documents,
        components,
        imports,
        diagnostics: order_diagnostics(diagnostics),
    }
}

fn unresolved_imported_tag(
    provider: &ResolvedComponent,
    paths: &[String],
    file: &str,
    selection: &ResolvedImportName,
    tag: Option<&ResolvedTag>,
) -> Diagnostic {
    let _ = paths;
    diagnostic(
        "SIGIL_UNRESOLVED_IMPORTED_TAG",
        format!(
            "Component {} does not own an unambiguous Tag {}.",
            provider.name,
            quoted(&selection.name)
        ),
        Location {
            file_path: Some(file.to_owned()),
            range: Some(selection.range.range()),
            related: tag
                .map(|t| {
                    t.introductions
                        .iter()
                        .map(|i| related(&paths[provider.file], i.range))
                        .collect()
                })
                .unwrap_or_default(),
        },
    )
}
