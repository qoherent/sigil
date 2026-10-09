//! Per-source Merkle trees: a parse layer carrying content ids, and a
//! resolution layer carrying resolved Tags, imports, references, and
//! diagnostics. Trees are cached under `.sigil/trees` and diffable by id.
//!
//! Identity never depends on a position: ranges ride along for diagnostics and
//! editor locations only.
pub mod cache;
pub mod command;
pub mod design_input;
pub mod diff;
pub mod ids;

use crate::language::{
    diagnostics::order_diagnostics,
    parse::parse_document,
    path::{normalize_import_path, normalize_path},
    resolve::{AccessStatus, ImportStatus, NameStatus, ResolvedWorkspace, TagStatus},
    workspace::Workspace,
};
use crate::sources;
use crate::structure::Diagnostic;
use cache::{CacheStats, TreeCache};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    io,
    path::Path,
};

/// Bumping this invalidates every cached tree and changes every id.
pub const TREE_FORMAT: u32 = 1;

/// A half-open byte range `[start, end]`.
pub type Rng = [usize; 2];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadNode {
    pub kind: Option<String>,
    pub body: String,
    pub range: Rng,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkNode {
    pub label: String,
    pub destination: String,
    pub title: Option<String>,
    pub image: bool,
    pub range: Rng,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetNode {
    pub id: String,
    pub section: String,
    pub group: Option<String>,
    /// Sorted Tag names the Facet defines inline.
    pub introduces: Vec<String>,
    /// Whitespace-normalized prose, as hashed.
    pub prose: String,
    pub payload: Option<PayloadNode>,
    pub range: Rng,
    pub prose_range: Rng,
    pub links: Vec<LinkNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupNode {
    pub id: String,
    pub name: String,
    pub range: Rng,
    pub children: Vec<Child>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Child {
    Facet(FacetNode),
    Group(GroupNode),
}

impl Child {
    pub fn id(&self) -> &str {
        match self {
            Child::Facet(f) => &f.id,
            Child::Group(g) => &g.id,
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Child::Facet(f) => f.range[0],
            Child::Group(g) => g.range[0],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionNode {
    pub name: String,
    pub id: String,
    pub known: bool,
    pub range: Rng,
    pub children: Vec<Child>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNode {
    pub name: String,
    pub iri: String,
    pub id: String,
    pub interface_hash: String,
    /// The own Tags the interface evidences, as `name#definitions`.
    pub interface_tags: Vec<String>,
    pub range: Rng,
    pub sections: Vec<SectionNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDecl {
    pub path: String,
    pub provider: String,
    pub selections: Vec<String>,
    pub range: Rng,
}

/// The parse layer of one source: depends only on path, bytes, and format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseTree {
    pub format: u32,
    /// The cache key: path, source bytes, and format version.
    pub key: String,
    pub path: String,
    /// Content id of the whole file; stable under formatting changes.
    pub file_id: String,
    pub readable: bool,
    pub valid: bool,
    pub complete: bool,
    pub imports: Vec<ImportDecl>,
    pub components: Vec<ComponentNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNode {
    pub name: String,
    pub status: String,
    pub iri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedComponentNode {
    pub iri: String,
    pub identity_resolved: bool,
    pub tags: Vec<TagNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNameNode {
    pub name: String,
    pub status: String,
    pub used: bool,
    pub tag_iri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImportNode {
    pub path: String,
    pub provider: String,
    pub status: String,
    pub target: Option<String>,
    pub provider_iri: Option<String>,
    pub names: Vec<ImportNameNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceNode {
    pub facet: String,
    pub name: String,
    pub status: String,
    pub range: Rng,
    pub tag_iri: Option<String>,
}

/// The resolution layer of one source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    /// Aligned with the parse layer's components.
    pub components: Vec<ResolvedComponentNode>,
    /// Aligned with the parse layer's imports.
    pub imports: Vec<ResolvedImportNode>,
    pub references: Vec<ReferenceNode>,
    pub diagnostics: Vec<Diagnostic>,
}

/// A resolved source tree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTree {
    /// The resolution key, which doubles as the resolved tree id: the parse key,
    /// the imported components' interface hashes, and the context digest.
    /// Resolution is a pure function of it.
    pub id: String,
    pub parse: ParseTree,
    pub resolution: Resolution,
}

impl ResolvedTree {
    /// Deterministic JSON: field order is struct order and no map is unsorted.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("a tree serializes")
    }
}

/// The resolved trees of a whole workspace.
#[derive(Debug)]
pub struct Snapshot {
    pub trees: Vec<ResolvedTree>,
    /// Workspace-level plus every source's diagnostics, in canonical order.
    pub diagnostics: Vec<Diagnostic>,
    pub text_complete: bool,
    pub stats: CacheStats,
}

impl Snapshot {
    pub fn tree(&self, path: &str) -> Option<&ResolvedTree> {
        self.trees.iter().find(|t| t.parse.path == path)
    }

    /// Load the workspace at `root`, caching under `<root>/.sigil/trees`.
    pub fn load(root: &Path) -> io::Result<Self> {
        Self::load_with(root, Some(&root.join(".sigil").join("trees")))
    }

    /// Load the workspace at `root` with the cache in `cache_dir`, or none.
    pub fn load_with(root: &Path, cache_dir: Option<&Path>) -> io::Result<Self> {
        let workspace = Workspace::load(root)?;
        let mut cache = cache_dir.map_or_else(TreeCache::disabled, TreeCache::new);
        Ok(Self::build(&workspace, &mut cache))
    }

    pub fn build(workspace: &Workspace, cache: &mut TreeCache) -> Self {
        let start = cache.stats;
        let parses: Vec<ParseTree> = workspace
            .sources
            .iter()
            .map(|source| match &source.capture.source {
                Some(text) => {
                    let key = ids::parse_key(&source.path, &text.text);
                    cache.load_parse(&key).unwrap_or_else(|| {
                        let document = parse_document(&source.path, &source.capture);
                        let tree = ids::build_parse_tree(&source.path, &document, key);
                        cache.store_parse(&tree);
                        tree
                    })
                }
                None => {
                    // No faithful text, so nothing to key a cache entry on.
                    let key = ids::parse_key(&source.path, "\0unreadable");
                    let document = parse_document(&source.path, &source.capture);
                    ids::build_parse_tree(&source.path, &document, key)
                }
            })
            .collect();

        let inputs = resolution_inputs(workspace, &parses);
        let mut resolved: Option<ResolvedWorkspace> = None;
        let mut trees = Vec::with_capacity(parses.len());
        for (fi, parse) in parses.iter().enumerate() {
            let id = inputs[fi].clone();
            let cacheable = workspace.sources[fi].capture.source.is_some();
            let cached = cacheable.then(|| cache.load_resolved(&id)).flatten();
            let resolution = cached.unwrap_or_else(|| {
                let resolved = resolved.get_or_insert_with(|| ResolvedWorkspace::from(workspace));
                let resolution = resolution_from(resolved, fi, &parses);
                if cacheable {
                    cache.store_resolved(&id, &resolution);
                }
                resolution
            });
            trees.push(ResolvedTree {
                id,
                parse: parse.clone(),
                resolution,
            });
        }
        for tree in &trees {
            if workspace
                .sources
                .iter()
                .any(|s| s.path == tree.parse.path && s.capture.source.is_some())
            {
                cache.record(&tree.parse.path, &tree.parse.key, &tree.id);
            }
        }

        let source_paths: Vec<&str> = workspace.sources.iter().map(|s| s.path.as_str()).collect();
        let mut diagnostics: Vec<Diagnostic> = workspace
            .diagnostics
            .iter()
            .filter(|d| {
                d.file_path
                    .as_deref()
                    .is_none_or(|p| !source_paths.contains(&p))
            })
            .cloned()
            .collect();
        for tree in &trees {
            diagnostics.extend(tree.resolution.diagnostics.iter().cloned());
        }
        Snapshot {
            trees,
            diagnostics: order_diagnostics(diagnostics),
            text_complete: workspace.text_complete,
            stats: cache.stats.since(start),
        }
    }
}

#[derive(Serialize)]
struct ImportInput {
    target: Option<String>,
    readable: bool,
    /// Every source declaring a component with the provider's name.
    providers: Vec<String>,
    /// Interface hashes of the target's components with that name.
    interface: Vec<String>,
}

/// The resolution key of every source (KTD1): its parse key, the glossary and
/// config digest, each import's target and interface hashes, and which other
/// sources declare a clashing component name. The last two are inputs the
/// resolver reads across files, so a change in them must move the key.
fn resolution_inputs(workspace: &Workspace, parses: &[ParseTree]) -> Vec<String> {
    let mut context = ids::Fields::new("context/v1");
    for file in &workspace.context {
        context = context
            .str(file.path)
            .opt(file.bytes.as_ref().map(|b| sources::hash(b)).as_deref());
    }
    let context = context.finish();
    let by_path: HashMap<String, usize> = parses
        .iter()
        .enumerate()
        .map(|(i, p)| (normalize_path(&p.path), i))
        .collect();
    let mut declaring: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for parse in parses {
        for component in &parse.components {
            declaring
                .entry(&component.name)
                .or_default()
                .push(&parse.path);
        }
    }
    parses
        .iter()
        .map(|parse| {
            let imports: Vec<ImportInput> = parse
                .imports
                .iter()
                .map(|decl| {
                    let target = normalize_import_path(&decl.path)
                        .and_then(|p| by_path.get(&p).copied())
                        .map(|t| &parses[t]);
                    let mut providers: Vec<String> = declaring
                        .get(decl.provider.as_str())
                        .into_iter()
                        .flatten()
                        .map(|p| (*p).to_owned())
                        .collect();
                    providers.sort();
                    let mut interface: Vec<String> = target
                        .into_iter()
                        .flat_map(|t| &t.components)
                        .filter(|c| c.name == decl.provider)
                        .map(|c| c.interface_hash.clone())
                        .collect();
                    interface.sort();
                    ImportInput {
                        target: target.map(|t| t.path.clone()),
                        readable: target.is_some_and(|t| t.readable),
                        providers,
                        interface,
                    }
                })
                .collect();
            let mut clashes: Vec<(&str, &str)> = Vec::new();
            for component in &parse.components {
                for other in declaring.get(component.name.as_str()).into_iter().flatten() {
                    if *other != parse.path {
                        clashes.push((&component.name, other));
                    }
                }
            }
            clashes.sort();
            clashes.dedup();
            ids::Fields::new("resolution/v1")
                .num(u64::from(TREE_FORMAT))
                .str(&parse.key)
                .str(&context)
                .str(&serde_json::to_string(&imports).expect("inputs serialize"))
                .str(&serde_json::to_string(&clashes).expect("clashes serialize"))
                .finish()
        })
        .collect()
}

fn status_name<T: std::fmt::Debug>(status: T) -> String {
    format!("{status:?}").to_lowercase()
}

pub(crate) fn facet_ids_by_start(children: &[Child], out: &mut HashMap<usize, String>) {
    for child in children {
        match child {
            Child::Facet(f) => {
                out.insert(f.range[0], f.id.clone());
            }
            Child::Group(g) => facet_ids_by_start(&g.children, out),
        }
    }
}

/// Extract source `fi`'s resolution layer from a whole-workspace resolution.
fn resolution_from(resolved: &ResolvedWorkspace, fi: usize, parses: &[ParseTree]) -> Resolution {
    let parse = &parses[fi];
    let component_iri = |ci: usize| {
        let c = &resolved.components[ci];
        parses[c.file].components[c.index].iri.clone()
    };
    let tag_iri = |component: usize, tag: usize| {
        format!(
            "{}:tag:{}",
            component_iri(component),
            ids::encode(&resolved.components[component].tags[tag].name)
        )
    };
    let mut starts = HashMap::new();
    for component in &parse.components {
        for section in &component.sections {
            facet_ids_by_start(&section.children, &mut starts);
        }
    }
    let mut components = Vec::new();
    let mut references = Vec::new();
    for (ci, component) in resolved
        .components
        .iter()
        .enumerate()
        .filter(|(_, c)| c.file == fi)
    {
        components.push(ResolvedComponentNode {
            iri: component_iri(ci),
            identity_resolved: component.identity_resolved,
            tags: component
                .tags
                .iter()
                .enumerate()
                .map(|(ti, tag)| TagNode {
                    name: tag.name.clone(),
                    status: status_name(tag.status),
                    iri: (tag.status == TagStatus::Resolved).then(|| tag_iri(ci, ti)),
                })
                .collect(),
        });
        for reference in &component.references {
            let facet = resolved.facet(component, reference.facet);
            references.push(ReferenceNode {
                facet: starts.get(&facet.range.start).cloned().unwrap_or_default(),
                name: reference.name.clone(),
                status: status_name(reference.status),
                range: [reference.range.start, reference.range.end],
                tag_iri: (reference.status == AccessStatus::Resolved)
                    .then_some(reference.tag)
                    .flatten()
                    .map(|t| tag_iri(t.component, t.tag)),
            });
        }
    }
    let imports = resolved
        .imports
        .iter()
        .filter(|i| i.file == fi)
        .map(|item| {
            let declaration = &resolved.documents[fi].imports[item.declaration];
            ResolvedImportNode {
                path: declaration.path.clone(),
                provider: declaration.provider.clone(),
                status: match item.status {
                    ImportStatus::Resolved => "resolved",
                    ImportStatus::UnresolvedPath => "unresolvedPath",
                    ImportStatus::UnresolvedProvider => "unresolvedProvider",
                }
                .to_owned(),
                target: item.target.map(|t| resolved.paths[t].clone()),
                provider_iri: item.provider.map(component_iri),
                names: item
                    .names
                    .iter()
                    .map(|n| ImportNameNode {
                        name: n.name.clone(),
                        status: match n.status {
                            NameStatus::Resolved => "resolved",
                            NameStatus::Unresolved => "unresolved",
                            NameStatus::Duplicate => "duplicate",
                            NameStatus::Ambiguous => "ambiguous",
                            NameStatus::Invalid => "invalid",
                        }
                        .to_owned(),
                        used: n.used,
                        tag_iri: (n.status == NameStatus::Resolved)
                            .then_some(n.tag)
                            .flatten()
                            .map(|t| tag_iri(t.component, t.tag)),
                    })
                    .collect(),
            }
        })
        .collect();
    let diagnostics = resolved
        .diagnostics
        .iter()
        .filter(|d| d.file_path.as_deref() == Some(parse.path.as_str()))
        .cloned()
        .collect();
    Resolution {
        components,
        imports,
        references,
        diagnostics,
    }
}
