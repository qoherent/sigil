//! Content ids for the parse layer (KTD2-KTD4).
//!
//! Every id is BLAKE3 over length-prefixed fields under a kind-and-version
//! domain tag. No span, offset, or line number is ever hashed; ranges are
//! stored beside the ids only.
//!
//! Component IRI scheme: `urn:sigil:component:<enc(path)>:<enc(name)>`, as
//! today. A component whose name is declared more than once in the same file
//! cannot be told apart by name, so the second and later declarations take a
//! `:dup:<n>` suffix, where `n` is the 1-based occurrence among same-named
//! declarations in that file. The first declaration has no suffix. This is a
//! parse-layer rule on purpose: it needs no resolution, and it replaces the
//! `:at:<offset>` suffix, which would put a position into identity. Deleting
//! an earlier duplicate renumbers the later ones, as with Facet ordinals.
use super::{
    Child, ComponentNode, FacetNode, GroupNode, ImportDecl, LinkNode, ParseTree, PayloadNode, Rng,
    SectionNode, TREE_FORMAT,
};
use crate::language::{
    parse::{Component, Document, Facet, Group, Section, Span},
    tags::match_tag_references,
};
use crate::sources;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// `encodeURIComponent`: every byte but `A-Za-z0-9-_.!~*'()` is percent-encoded.
pub fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("writing to String");
        }
    }
    encoded
}

/// A domain-separated, unambiguous field hash.
pub struct Fields(Vec<u8>);

impl Fields {
    pub fn new(domain: &str) -> Self {
        let mut f = Fields(Vec::new());
        f = f.str(domain);
        f
    }

    pub fn str(mut self, value: &str) -> Self {
        self.0.extend((value.len() as u64).to_le_bytes());
        self.0.extend(value.as_bytes());
        self
    }

    pub fn num(mut self, value: u64) -> Self {
        self.0.extend(value.to_le_bytes());
        self
    }

    pub fn opt(mut self, value: Option<&str>) -> Self {
        match value {
            Some(v) => {
                self.0.push(1);
                self.str(v)
            }
            None => {
                self.0.push(0);
                self
            }
        }
    }

    pub fn list<S: AsRef<str>>(mut self, values: &[S]) -> Self {
        self = self.num(values.len() as u64);
        for v in values {
            self = self.str(v.as_ref());
        }
        self
    }

    pub fn finish(self) -> String {
        sources::hash(&self.0)
    }
}

/// Whitespace runs collapse to one space and the ends are trimmed.
pub fn normalize_prose(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_key(path: &str, text: &str) -> String {
    // The compiler version is part of the key, so a parser change in a new
    // release never reuses trees an older parser built.
    Fields::new("parse/v1")
        .num(u64::from(TREE_FORMAT))
        .str(env!("CARGO_PKG_VERSION"))
        .str(path)
        .str(&sources::hash(text.as_bytes()))
        .finish()
}

fn rng(span: Span) -> Rng {
    [span.start, span.end]
}

fn slice(text: &str, span: Span) -> &str {
    text.get(span.start..span.end).unwrap_or("")
}

struct Ctx<'a> {
    text: &'a str,
    iri: &'a str,
    /// Occurrences of each (section, base hash) seen so far in this component.
    seen: HashMap<(String, String), usize>,
}

impl Ctx<'_> {
    fn facet(&mut self, facet: &Facet) -> FacetNode {
        let prose = normalize_prose(slice(self.text, facet.prose_range));
        let mut introduces: Vec<String> =
            facet.definitions.iter().map(|d| d.name.clone()).collect();
        introduces.sort();
        introduces.dedup();
        let payload = facet.payload.as_ref().map(|p| PayloadNode {
            kind: p.kind.clone(),
            body: slice(self.text, p.body_range).to_owned(),
            range: rng(p.range),
        });
        let group = facet.group.as_ref().map(|g| g.name.as_str());
        let hash = Fields::new("facet/v1")
            .str(self.iri)
            .str(&facet.section)
            .opt(group)
            .list(&introduces)
            .str(&prose)
            .opt(payload.as_ref().and_then(|p| p.kind.as_deref()))
            .opt(payload.as_ref().map(|p| p.body.as_str()))
            .finish();
        let seen = self
            .seen
            .entry((facet.section.clone(), hash.clone()))
            .or_insert(0);
        *seen += 1;
        let id = if *seen == 1 {
            format!("facet:{hash}")
        } else {
            format!("facet:{hash}:{seen}")
        };
        FacetNode {
            id,
            section: facet.section.clone(),
            group: group.map(str::to_owned),
            introduces,
            prose,
            payload,
            range: rng(facet.range),
            prose_range: rng(facet.prose_range),
            links: facet
                .links
                .iter()
                .map(|l| LinkNode {
                    label: l.label.clone(),
                    destination: l.destination.clone(),
                    title: l.title.clone(),
                    image: l.image,
                    range: rng(l.range),
                })
                .collect(),
        }
    }
}

/// The ordered or sorted roll-up of child ids.
fn roll_up(domain: &str, name: &str, ordered: bool, children: &[Child]) -> String {
    let mut ids: Vec<&str> = children.iter().map(Child::id).collect();
    if !ordered {
        ids.sort_unstable();
    }
    Fields::new(domain)
        .str(name)
        .num(u64::from(ordered))
        .list(&ids)
        .finish()
}

fn group_node(group: &Group, nodes: &[FacetNode], ordered: bool) -> GroupNode {
    let mut children: Vec<Child> = group
        .units
        .iter()
        .filter_map(|i| nodes.get(*i))
        .cloned()
        .map(Child::Facet)
        .chain(
            group
                .groups
                .iter()
                .map(|g| Child::Group(group_node(g, nodes, ordered))),
        )
        .collect();
    children.sort_by_key(Child::start);
    GroupNode {
        id: roll_up("group/v1", &group.name, ordered, &children),
        name: group.name.clone(),
        range: rng(group.range),
        children,
    }
}

fn claimed(group: &Group, out: &mut HashSet<usize>) {
    out.extend(group.units.iter().copied());
    for g in &group.groups {
        claimed(g, out);
    }
}

fn section_node(ctx: &mut Ctx, section: &Section) -> SectionNode {
    // Step order is part of a flow, so only Logic hashes its children in order.
    let ordered = section.name == "logic";
    let nodes: Vec<FacetNode> = section.units.iter().map(|f| ctx.facet(f)).collect();
    let mut taken = HashSet::new();
    for g in &section.groups {
        claimed(g, &mut taken);
    }
    let mut children: Vec<Child> = nodes
        .iter()
        .enumerate()
        .filter(|(i, _)| !taken.contains(i))
        .map(|(_, n)| Child::Facet(n.clone()))
        .chain(
            section
                .groups
                .iter()
                .map(|g| Child::Group(group_node(g, &nodes, ordered))),
        )
        .collect();
    children.sort_by_key(Child::start);
    SectionNode {
        name: section.name.clone(),
        id: roll_up("section/v1", &section.name, ordered, &children),
        known: section.known,
        range: rng(section.range),
        children,
    }
}

fn group_names(group: &Group, out: &mut BTreeSet<String>) {
    out.insert(group.name.clone());
    for g in &group.groups {
        group_names(g, out);
    }
}

/// The component's own Tags that its interface evidences, as `name#definitions`,
/// from the parse layer alone: defined in the interface, a grouping heading
/// there, or spelled in its prose. The definition count is part of the entry
/// because a second definition makes the Tag ambiguous and so unimportable.
/// Over-inclusion can only cause extra invalidation.
fn interface_tags(document: &Document, component: &Component) -> Vec<String> {
    let mut definitions: BTreeMap<String, usize> = BTreeMap::new();
    let mut local: BTreeSet<String> = BTreeSet::new();
    for section in component.sections.iter().filter(|s| s.known) {
        for g in &section.groups {
            group_names(g, &mut local);
        }
        for facet in &section.units {
            for d in facet.definitions.iter().filter(|d| d.valid) {
                *definitions.entry(d.name.clone()).or_default() += 1;
                local.insert(d.name.clone());
            }
        }
    }
    let mut evidenced: BTreeSet<String> = BTreeSet::new();
    let names: Vec<String> = local.iter().cloned().collect();
    for section in component
        .sections
        .iter()
        .filter(|s| s.known && s.name == "interface")
    {
        for g in &section.groups {
            group_names(g, &mut evidenced);
        }
        for facet in &section.units {
            evidenced.extend(facet.definitions.iter().map(|d| d.name.clone()));
            if let Some(source) = &document.source {
                evidenced.extend(
                    match_tag_references(source, &facet.eligible, &names)
                        .into_iter()
                        .map(|m| m.name),
                );
            }
        }
    }
    evidenced
        .into_iter()
        .map(|n| format!("{}#{}", n, definitions.get(&n).copied().unwrap_or(0)))
        .collect()
}

fn component_node(
    path: &str,
    document: &Document,
    component: &Component,
    dup: usize,
) -> ComponentNode {
    let base = format!(
        "urn:sigil:component:{}:{}",
        encode(path),
        encode(&component.name)
    );
    let iri = if dup == 1 {
        base
    } else {
        format!("{base}:dup:{dup}")
    };
    let text = document.source.as_ref().map_or("", |s| s.text.as_str());
    let mut ctx = Ctx {
        text,
        iri: &iri,
        seen: HashMap::new(),
    };
    let sections: Vec<SectionNode> = component
        .sections
        .iter()
        .map(|s| section_node(&mut ctx, s))
        .collect();
    // Sections are keyed by name, so their order is not identity.
    let mut section_ids: Vec<String> = sections
        .iter()
        .map(|s| {
            Fields::new("section-ref/v1")
                .str(&s.name)
                .str(&s.id)
                .finish()
        })
        .collect();
    section_ids.sort();
    let id = Fields::new("component/v1")
        .str(&component.name)
        .list(&section_ids)
        .finish();
    let mut interface_ids: Vec<&str> = sections
        .iter()
        .filter(|s| s.known && s.name == "interface")
        .map(|s| s.id.as_str())
        .collect();
    interface_ids.sort_unstable();
    let tags = interface_tags(document, component);
    let interface_hash = Fields::new("interface/v1")
        .str(&iri)
        .list(&interface_ids)
        .list(&tags)
        .num(u64::from(component.complete))
        .finish();
    ComponentNode {
        name: component.name.clone(),
        iri,
        id,
        interface_hash,
        interface_tags: tags,
        range: rng(component.range),
        sections,
    }
}

pub fn build_parse_tree(path: &str, document: &Document, key: String) -> ParseTree {
    let mut occurrences: HashMap<&str, usize> = HashMap::new();
    let components: Vec<ComponentNode> = document
        .components
        .iter()
        .map(|c| {
            let n = occurrences.entry(&c.name).or_insert(0);
            *n += 1;
            component_node(path, document, c, *n)
        })
        .collect();
    let imports: Vec<ImportDecl> = document
        .imports
        .iter()
        .map(|i| {
            let mut selections: Vec<String> = i.selections.iter().map(|s| s.name.clone()).collect();
            selections.sort();
            ImportDecl {
                path: i.path.clone(),
                provider: i.provider.clone(),
                selections,
                range: rng(i.range),
            }
        })
        .collect();
    let mut import_ids: Vec<String> = imports
        .iter()
        .map(|i| {
            Fields::new("import/v1")
                .str(&i.path)
                .str(&i.provider)
                .list(&i.selections)
                .finish()
        })
        .collect();
    import_ids.sort();
    let mut component_ids: Vec<&str> = components.iter().map(|c| c.id.as_str()).collect();
    component_ids.sort_unstable();
    let file_id = Fields::new("file/v1")
        .str(path)
        .list(&import_ids)
        .list(&component_ids)
        .finish();
    ParseTree {
        format: TREE_FORMAT,
        key,
        path: path.to_owned(),
        file_id,
        readable: document.source.is_some(),
        valid: document.valid,
        complete: document.complete,
        imports,
        components,
    }
}
