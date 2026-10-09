//! The structural `DesignInput` the compiler's modules read, derived from the
//! workspace trees instead of a pre-exported JSON file.
//!
//! This is a transitional adapter: the arrays and their meaning are those the
//! TypeScript export produced (`packages/core/src/design-input.ts`), with one
//! difference. A Facet's id is its content id from the tree (KTD3), so it
//! survives edits that move the Facet. Every other node keeps the old
//! `{kind}:{path}:{start}` occurrence id, because those never feed content
//! identity.
use super::{Snapshot, cache::TreeCache, facet_ids_by_start, ids::encode};
use crate::inputs::{ContextIdentity, DesignBasis, ImportedInterface, SourceBasis};
use crate::language::{
    parse::{self, Span},
    resolve::{
        AccessStatus, ImportStatus, IntroductionKind as ResolvedKind, NameStatus,
        ResolvedComponent, ResolvedWorkspace, TagRef, TagStatus,
    },
    text::SourceText,
    workspace::Workspace,
};
use crate::sources::{self, SourceIdentity};
use crate::structure::{
    self, Context, DesignInput, Entity, EntityType, Group, Import, ImportedName, Introduction,
    IntroductionKind, Link, Payload, Range, Reference, ReferenceStatus, Section, SelectionStatus,
    Source, Unit,
};
use std::{collections::HashMap, path::Path};

/// The reader that produced a derived input; part of every Design binding.
pub const READER_VERSION: &str = concat!("sigilc-", env!("CARGO_PKG_VERSION"));

fn range(span: Span) -> Range {
    span.range()
}

/// Read the workspace at `root`, building its trees into `<store>/trees`, and
/// derive the structural input.
pub fn load_design_input(root: &Path, store: &Path) -> Result<DesignInput, String> {
    load_design(root, store).map(|(input, _)| input)
}

fn load_workspace(root: &Path) -> Result<Workspace, String> {
    if !root.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            root.display()
        ));
    }
    Workspace::load(root).map_err(|e| format!("read workspace: {e}"))
}

/// The structural input and what every Design binding reads from the trees.
pub fn load_design(root: &Path, store: &Path) -> Result<(DesignInput, DesignBasis), String> {
    let workspace = load_workspace(root)?;
    let mut cache = TreeCache::new(&store.join("trees"));
    let snapshot = Snapshot::build(&workspace, &mut cache);
    let resolved = ResolvedWorkspace::from(&workspace);
    let input = design_input(&workspace, &snapshot, &resolved)?;
    let basis = design_basis(&workspace, &snapshot);
    Ok((input, basis))
}

/// Only the binding basis, for a liveness check that needs no structure rows.
pub fn load_basis(root: &Path, store: &Path) -> Result<DesignBasis, String> {
    let workspace = load_workspace(root)?;
    let mut cache = TreeCache::new(&store.join("trees"));
    let snapshot = Snapshot::build(&workspace, &mut cache);
    Ok(design_basis(&workspace, &snapshot))
}

/// What a Design binding records per source (KTD7): the content file id, never
/// `ResolvedTree::id` (which moves with a rewrap), the interface hash of every
/// imported component, and a hash of the source's own resolution with no
/// position in it. A dependency's private sections reach none of these.
pub fn design_basis(workspace: &Workspace, snapshot: &Snapshot) -> DesignBasis {
    let sources = snapshot
        .trees
        .iter()
        .map(|tree| {
            let imports: Vec<ImportedInterface> = tree
                .parse
                .imports
                .iter()
                .zip(&tree.resolution.imports)
                .map(|(declaration, resolved)| {
                    let target = resolved.target.as_deref();
                    let mut interface: Vec<String> = target
                        .and_then(|t| snapshot.tree(t))
                        .into_iter()
                        .flat_map(|t| &t.parse.components)
                        .filter(|c| c.name == declaration.provider)
                        .map(|c| c.interface_hash.clone())
                        .collect();
                    interface.sort();
                    ImportedInterface {
                        path: target.unwrap_or(&declaration.path).to_owned(),
                        component: declaration.provider.clone(),
                        interface,
                    }
                })
                .collect();
            let resolution = &tree.resolution;
            let structure = sources::hash(
                &serde_json::to_vec(&(
                    "sigil-design-structure-v1",
                    crate::language::SIGIL_VERSION,
                    resolution
                        .components
                        .iter()
                        .map(|c| {
                            (
                                &c.iri,
                                c.identity_resolved,
                                c.tags
                                    .iter()
                                    .map(|t| (&t.name, &t.status, &t.iri))
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .collect::<Vec<_>>(),
                    resolution
                        .imports
                        .iter()
                        .map(|i| {
                            (
                                &i.path,
                                &i.provider,
                                &i.status,
                                &i.target,
                                &i.provider_iri,
                                i.names
                                    .iter()
                                    .map(|n| (&n.name, &n.status, n.used, &n.tag_iri))
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .collect::<Vec<_>>(),
                    resolution
                        .references
                        .iter()
                        .map(|r| (&r.facet, &r.name, &r.status, &r.tag_iri))
                        .collect::<Vec<_>>(),
                ))
                .expect("structure serializes"),
            );
            let exposed = tree
                .parse
                .components
                .iter()
                .map(|c| {
                    (
                        c.iri.clone(),
                        c.interface_tags
                            .iter()
                            .map(|t| t.rsplit_once('#').map_or(t.as_str(), |(n, _)| n).to_owned())
                            .collect(),
                    )
                })
                .collect();
            (
                tree.parse.path.clone(),
                SourceBasis {
                    identity: SourceIdentity {
                        path: tree.parse.path.clone(),
                        checksum: tree.parse.file_id.clone(),
                    },
                    imports,
                    structure,
                    exposed,
                },
            )
        })
        .collect();
    let mut context: Vec<ContextIdentity> = workspace
        .context
        .iter()
        .map(|f| ContextIdentity {
            path: f.path.to_owned(),
            checksum: f.bytes.as_ref().map(|b| sources::hash(b)),
        })
        .collect();
    context.sort_by(|a, b| a.path.cmp(&b.path));
    DesignBasis {
        reader_version: READER_VERSION.to_owned(),
        sources,
        context,
    }
}

/// Derive the structural input from a loaded workspace and its snapshot.
pub fn design_input(
    workspace: &Workspace,
    snapshot: &Snapshot,
    resolved: &ResolvedWorkspace,
) -> Result<DesignInput, String> {
    if !workspace.text_complete || !snapshot.text_complete || !resolved.text_complete {
        let detail = snapshot
            .diagnostics
            .iter()
            .filter(|d| matches!(d.severity, structure::Severity::Error))
            .map(|d| format!("{}: {}", d.code, d.message))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!(
            "workspace has a file that is not valid UTF-8, so no faithful structure exists: {detail}"
        ));
    }
    if snapshot.trees.len() != resolved.documents.len() {
        return Err("workspace trees and documents disagree".into());
    }
    let component_iri: Vec<String> = resolved
        .components
        .iter()
        .map(|c| {
            let base = format!(
                "urn:sigil:component:{}:{}",
                encode(&resolved.paths[c.file]),
                encode(&c.name)
            );
            if c.identity_resolved {
                base
            } else {
                format!("{base}:at:{}", resolved.declaration(c).range.start)
            }
        })
        .collect();
    let tag_iri = |t: TagRef| -> Option<String> {
        let tag = &resolved.components[t.component].tags[t.tag];
        (tag.status == TagStatus::Resolved)
            .then(|| format!("{}:tag:{}", component_iri[t.component], encode(&tag.name)))
    };
    let facet_ids: Vec<HashMap<usize, String>> = snapshot
        .trees
        .iter()
        .map(|tree| {
            let mut ids = HashMap::new();
            for component in &tree.parse.components {
                for section in &component.sections {
                    facet_ids_by_start(&section.children, &mut ids);
                }
            }
            ids
        })
        .collect();
    let facet_id = |c: &ResolvedComponent, unit: &parse::Facet| -> Result<String, String> {
        facet_ids[c.file]
            .get(&unit.range.start)
            .cloned()
            .ok_or_else(|| format!("no tree id for a Facet in {}", resolved.paths[c.file]))
    };

    let mut entities = Vec::new();
    let mut introductions = Vec::new();
    let mut group_tags: HashMap<String, Option<String>> = HashMap::new();
    // Tag introductions of every component come first, as the export collected them.
    for (ci, c) in resolved.components.iter().enumerate() {
        let source = &resolved.paths[c.file];
        let owner = &component_iri[ci];
        let declaration = resolved.declaration(c);
        entities.push(Entity {
            id: owner.clone(),
            kind: EntityType::Component,
            label: c.name.clone(),
            source: source.clone(),
            owner: None,
            range: range(declaration.range),
            name_range: range(declaration.name_range),
            identity_resolved: c.identity_resolved,
            valid: declaration.valid,
            complete: declaration.complete,
        });
        for (ti, tag) in c.tags.iter().enumerate() {
            let id = tag_iri(TagRef {
                component: ci,
                tag: ti,
            });
            if let Some(id) = &id {
                let first = tag
                    .introductions
                    .first()
                    .ok_or_else(|| format!("Tag {} has no introduction", tag.name))?;
                entities.push(Entity {
                    id: id.clone(),
                    kind: EntityType::Tag,
                    label: tag.name.clone(),
                    source: source.clone(),
                    owner: Some(owner.clone()),
                    range: range(first.range),
                    name_range: range(first.name_range),
                    identity_resolved: true,
                    valid: true,
                    complete: true,
                });
            }
            for i in &tag.introductions {
                let (kind, occurrence, facet, group) = match i.kind {
                    ResolvedKind::Group => {
                        let start = i.group_start.ok_or("group introduction has no header")?;
                        let group = format!("group:{}:{start}", encode(source));
                        group_tags.insert(group.clone(), id.clone());
                        (IntroductionKind::Group, group.clone(), None, Some(group))
                    }
                    ResolvedKind::Inline => {
                        let pos = i.facet.ok_or("inline introduction has no Facet")?;
                        (
                            IntroductionKind::Inline,
                            format!("definition:{}:{}", encode(source), i.range.start),
                            Some(facet_id(c, resolved.facet(c, pos))?),
                            None,
                        )
                    }
                };
                introductions.push(Introduction {
                    id: occurrence,
                    kind,
                    name: i.name.clone(),
                    source: source.clone(),
                    owner: owner.clone(),
                    tag: id.clone(),
                    section: section(&i.section)?,
                    facet,
                    group,
                    range: range(i.range),
                    name_range: range(i.name_range),
                    valid: i.valid,
                    complete: i.complete,
                });
            }
        }
    }
    let mut by_facet: HashMap<&str, Vec<String>> = HashMap::new();
    for i in &introductions {
        if let Some(f) = &i.facet {
            by_facet.entry(f).or_default().push(i.id.clone());
        }
    }

    let mut references = Vec::new();
    let mut references_by_facet: HashMap<String, Vec<String>> = HashMap::new();
    let mut groups = Vec::new();
    let mut units = Vec::new();
    let mut links = Vec::new();
    for (ci, c) in resolved.components.iter().enumerate() {
        let source = &resolved.paths[c.file];
        let owner = &component_iri[ci];
        let text = resolved.documents[c.file]
            .source
            .as_ref()
            .ok_or("source has no text")?;
        for r in &c.references {
            let facet = facet_id(c, resolved.facet(c, r.facet))?;
            let id = format!("reference:{}:{}", encode(source), r.range.start);
            references_by_facet
                .entry(facet.clone())
                .or_default()
                .push(id.clone());
            references.push(Reference {
                id,
                source: source.clone(),
                owner: owner.clone(),
                facet,
                name: r.name.clone(),
                tag: r.tag.and_then(&tag_iri),
                status: match r.status {
                    AccessStatus::Resolved => ReferenceStatus::Resolved,
                    AccessStatus::Ambiguous => ReferenceStatus::Ambiguous,
                },
                range: range(r.range),
            });
        }
        // An unknown section's body is skipped, so it holds no Facets or groups.
        for s in resolved.declaration(c).sections.iter().filter(|s| s.known) {
            let section_name = section(&s.name)?;
            for g in &s.groups {
                add_groups(&mut groups, &group_tags, g, source, owner, &s.name)?;
            }
            for facet in &s.units {
                let id = facet_id(c, facet)?;
                let facet_links: Vec<Link> = facet
                    .links
                    .iter()
                    .map(|l| Link {
                        id: format!("link:{}:{}", encode(source), l.range.start),
                        source: source.clone(),
                        owner: owner.clone(),
                        facet: id.clone(),
                        raw: text
                            .text
                            .get(l.range.start..l.range.end)
                            .unwrap_or("")
                            .to_owned(),
                        label: l.label.clone(),
                        destination: l.destination.clone(),
                        title: l.title.clone(),
                        image: l.image,
                        range: range(l.range),
                        destination_range: range(l.destination_range),
                    })
                    .collect();
                units.push(Unit {
                    source: source.clone(),
                    owner: Some(owner.clone()),
                    section: section_name,
                    range: range(facet.range),
                    prose_range: range(facet.prose_range),
                    grouping: facet
                        .group
                        .as_ref()
                        .map(|g| format!("group:{}:{}", encode(source), g.header_start)),
                    introductions: by_facet.get(id.as_str()).cloned().unwrap_or_default(),
                    references: references_by_facet.get(&id).cloned().unwrap_or_default(),
                    links: facet_links.iter().map(|l| l.id.clone()).collect(),
                    payload: facet.payload.as_ref().map(|p| payload(text, p)),
                    valid: facet.valid,
                    complete: facet.complete,
                    id,
                });
                links.extend(facet_links);
            }
        }
    }

    let imports = resolved
        .imports
        .iter()
        .map(|item| {
            let source = &resolved.paths[item.file];
            let declaration = &resolved.documents[item.file].imports[item.declaration];
            Import {
                id: format!("import:{}:{}", encode(source), declaration.range.start),
                source: source.clone(),
                target: item.target.map(|t| resolved.paths[t].clone()),
                path: declaration.path.clone(),
                provider: declaration.provider.clone(),
                provider_id: item.provider.map(|p| component_iri[p].clone()),
                range: range(declaration.range),
                path_range: range(declaration.path_range),
                provider_range: range(declaration.provider_range),
                status: match item.status {
                    ImportStatus::Resolved => structure::ImportStatus::Resolved,
                    ImportStatus::UnresolvedPath => structure::ImportStatus::UnresolvedPath,
                    ImportStatus::UnresolvedProvider => structure::ImportStatus::UnresolvedProvider,
                },
                valid: declaration.valid,
                complete: declaration.complete,
                names: item
                    .names
                    .iter()
                    .map(|n| ImportedName {
                        id: format!("selection:{}:{}", encode(source), n.range.start),
                        name: n.name.clone(),
                        entity: n.tag.and_then(&tag_iri),
                        range: range(n.range),
                        status: match n.status {
                            NameStatus::Resolved => SelectionStatus::Resolved,
                            NameStatus::Unresolved => SelectionStatus::Unresolved,
                            NameStatus::Duplicate => SelectionStatus::Duplicate,
                            NameStatus::Ambiguous => SelectionStatus::Ambiguous,
                            NameStatus::Invalid => SelectionStatus::Invalid,
                        },
                        uses: n
                            .uses
                            .iter()
                            .map(|u| {
                                let reference =
                                    &resolved.components[u.component].references[u.reference];
                                format!("reference:{}:{}", encode(source), reference.range.start)
                            })
                            .collect(),
                    })
                    .collect(),
            }
        })
        .collect();

    let mut sources: Vec<Source> = workspace
        .sources
        .iter()
        .map(|s| {
            Ok(Source {
                path: s.path.clone(),
                text: s
                    .capture
                    .source
                    .as_ref()
                    .ok_or("source has no text")?
                    .text
                    .clone(),
            })
        })
        .collect::<Result<_, String>>()?;
    sources.sort_by(|a, b| a.path.cmp(&b.path));
    let context = workspace
        .context
        .iter()
        .map(|f| {
            Ok(Context {
                path: f.path.to_owned(),
                text: f
                    .bytes
                    .as_ref()
                    .map(|b| {
                        String::from_utf8(b.clone()).map_err(|_| format!("{}: not UTF-8", f.path))
                    })
                    .transpose()?,
            })
        })
        .collect::<Result<_, String>>()?;

    entities.sort_by(|a: &Entity, b| a.id.cmp(&b.id));
    units.sort_by(|a: &Unit, b| a.id.cmp(&b.id));
    groups.sort_by(|a: &Group, b| a.id.cmp(&b.id));
    introductions.sort_by(|a: &Introduction, b| a.id.cmp(&b.id));
    references.sort_by(|a: &Reference, b| a.id.cmp(&b.id));
    links.sort_by(|a: &Link, b| a.id.cmp(&b.id));
    let mut imports: Vec<Import> = imports;
    imports.sort_by(|a, b| a.id.cmp(&b.id));

    let input = DesignInput {
        schema_version: 2,
        language_version: crate::language::SIGIL_VERSION.to_owned(),
        reader_version: READER_VERSION.to_owned(),
        sources,
        context,
        diagnostics: snapshot.diagnostics.clone(),
        imports,
        entities,
        units,
        groups,
        introductions,
        references,
        links,
    };
    input
        .assert_consistent()
        .map_err(|e| format!("derived structure is inconsistent: {e}"))?;
    Ok(input)
}

fn add_groups(
    out: &mut Vec<Group>,
    tags: &HashMap<String, Option<String>>,
    g: &parse::Group,
    source: &str,
    owner: &str,
    section_name: &str,
) -> Result<(), String> {
    let id = format!("group:{}:{}", encode(source), g.header_range.start);
    out.push(Group {
        tag: tags.get(&id).cloned().flatten(),
        id,
        source: source.to_owned(),
        owner: owner.to_owned(),
        name: g.name.clone(),
        section: section(section_name)?,
        range: range(g.range),
        name_range: range(g.name_range),
        header_range: range(g.header_range),
        body_range: range(g.body_range),
        valid: g.valid,
        complete: g.complete,
    });
    for child in &g.groups {
        add_groups(out, tags, child, source, owner, section_name)?;
    }
    Ok(())
}

fn section(name: &str) -> Result<Section, String> {
    Ok(match name {
        "goal" => Section::Goal,
        "interface" => Section::Interface,
        "state" => Section::State,
        "logic" => Section::Logic,
        "constraints" => Section::Constraints,
        "decisions" => Section::Decisions,
        "cases" => Section::Cases,
        other => return Err(format!("unknown section `{other}`")),
    })
}

/// A fenced payload as the export carried it: the body with the opening
/// fence's indentation removed, and the raw body exactly as written.
fn payload(source: &SourceText, p: &parse::Payload) -> Payload {
    let text = &source.text;
    let (start, end) = (p.body_range.start, p.body_range.end);
    let lines: Vec<_> = source
        .lines
        .iter()
        .filter(|l| l.start >= start && l.end <= end)
        .collect();
    let mut body = String::new();
    let mut source_lines = Vec::new();
    for line in &lines {
        let content = &text[line.start..line.content_end];
        body.push_str(
            content
                .strip_prefix(p.indentation.as_str())
                .unwrap_or(content),
        );
        body.push_str(&text[line.content_end..line.end]);
        source_lines.push(content.to_owned());
    }
    Payload {
        kind: p.kind.clone(),
        body,
        raw_body: text[start..end].to_owned(),
        source_lines,
        range: range(p.range),
        body_range: range(p.body_range),
        opening_range: range(p.opening_range),
        closing_range: p.closing_range.map(range),
        fence_length: p.fence_length,
        indentation: p.indentation.clone(),
        valid: p.valid,
        complete: p.complete,
    }
}
