//! Tree diff by id (R10): Facets added, removed, and changed, never descending
//! into a subtree whose rolled-up id is equal.
use super::{Child, ComponentNode, FacetNode, ParseTree, SectionNode};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetRef {
    pub component: String,
    pub section: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetChange {
    pub before: FacetRef,
    pub after: FacetRef,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub component: String,
    pub section: String,
}

/// How many nodes the diff opened; equal subtrees open none of their children.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Visits {
    pub components: usize,
    pub sections: usize,
    pub facets: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeDiff {
    pub added: Vec<FacetRef>,
    pub removed: Vec<FacetRef>,
    /// An unmatched removed and added Facet in the same component and section,
    /// paired in source order.
    pub changed: Vec<FacetChange>,
    /// Sections whose id differs, including a reorder of Logic steps that
    /// changes no Facet id.
    pub sections_changed: Vec<SectionRef>,
    pub visits: Visits,
}

impl TreeDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.removed.is_empty()
            && self.changed.is_empty()
            && self.sections_changed.is_empty()
    }
}

fn facets<'a>(children: &'a [Child], out: &mut Vec<&'a FacetNode>) {
    for child in children {
        match child {
            Child::Facet(f) => out.push(f),
            Child::Group(g) => facets(&g.children, out),
        }
    }
}

fn reference(component: &ComponentNode, section: &str, id: &str) -> FacetRef {
    FacetRef {
        component: component.iri.clone(),
        section: section.to_owned(),
        id: id.to_owned(),
    }
}

/// Sections keyed by name and occurrence, so repeated names still pair up.
fn keyed(component: &ComponentNode) -> BTreeMap<(String, usize), &SectionNode> {
    let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
    component
        .sections
        .iter()
        .map(|s| {
            let n = seen.entry(&s.name).or_insert(0);
            *n += 1;
            ((s.name.clone(), *n), s)
        })
        .collect()
}

fn whole(
    component: &ComponentNode,
    sections: &[&SectionNode],
    visits: &mut Visits,
    out: &mut Vec<FacetRef>,
) {
    visits.components += 1;
    for section in sections {
        visits.sections += 1;
        let mut found = Vec::new();
        facets(&section.children, &mut found);
        visits.facets += found.len();
        out.extend(
            found
                .iter()
                .map(|f| reference(component, &section.name, &f.id)),
        );
    }
}

pub fn diff_trees(before: &ParseTree, after: &ParseTree) -> TreeDiff {
    let mut diff = TreeDiff::default();
    if before.file_id == after.file_id {
        return diff;
    }
    let old: BTreeMap<&str, &ComponentNode> = before
        .components
        .iter()
        .map(|c| (c.iri.as_str(), c))
        .collect();
    let new: BTreeMap<&str, &ComponentNode> = after
        .components
        .iter()
        .map(|c| (c.iri.as_str(), c))
        .collect();
    let iris: BTreeSet<&str> = old.keys().chain(new.keys()).copied().collect();
    for iri in iris {
        match (old.get(iri), new.get(iri)) {
            (Some(c), None) => {
                let all: Vec<&SectionNode> = c.sections.iter().collect();
                whole(c, &all, &mut diff.visits, &mut diff.removed);
            }
            (None, Some(c)) => {
                let all: Vec<&SectionNode> = c.sections.iter().collect();
                whole(c, &all, &mut diff.visits, &mut diff.added);
            }
            (Some(a), Some(b)) if a.id != b.id => {
                diff.visits.components += 1;
                let (sa, sb) = (keyed(a), keyed(b));
                let keys: BTreeSet<&(String, usize)> = sa.keys().chain(sb.keys()).collect();
                for key in keys {
                    match (sa.get(key), sb.get(key)) {
                        (Some(x), None) => whole_section(a, x, &mut diff.visits, &mut diff.removed),
                        (None, Some(y)) => whole_section(b, y, &mut diff.visits, &mut diff.added),
                        (Some(x), Some(y)) if x.id != y.id => {
                            diff.visits.sections += 1;
                            diff.sections_changed.push(SectionRef {
                                component: b.iri.clone(),
                                section: y.name.clone(),
                            });
                            compare_section(b, x, y, &mut diff);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    diff
}

fn whole_section(
    component: &ComponentNode,
    section: &SectionNode,
    visits: &mut Visits,
    out: &mut Vec<FacetRef>,
) {
    visits.sections += 1;
    let mut found = Vec::new();
    facets(&section.children, &mut found);
    visits.facets += found.len();
    out.extend(
        found
            .iter()
            .map(|f| reference(component, &section.name, &f.id)),
    );
}

fn compare_section(
    component: &ComponentNode,
    before: &SectionNode,
    after: &SectionNode,
    diff: &mut TreeDiff,
) {
    let (mut old, mut new) = (Vec::new(), Vec::new());
    facets(&before.children, &mut old);
    facets(&after.children, &mut new);
    diff.visits.facets += old.len() + new.len();
    let kept: BTreeSet<&str> = {
        let o: BTreeSet<&str> = old.iter().map(|f| f.id.as_str()).collect();
        new.iter()
            .map(|f| f.id.as_str())
            .filter(|id| o.contains(id))
            .collect()
    };
    let removed: Vec<&&FacetNode> = old
        .iter()
        .filter(|f| !kept.contains(f.id.as_str()))
        .collect();
    let added: Vec<&&FacetNode> = new
        .iter()
        .filter(|f| !kept.contains(f.id.as_str()))
        .collect();
    let paired = removed.len().min(added.len());
    for i in 0..paired {
        diff.changed.push(FacetChange {
            before: reference(component, &before.name, &removed[i].id),
            after: reference(component, &after.name, &added[i].id),
        });
    }
    for f in &removed[paired..] {
        diff.removed.push(reference(component, &before.name, &f.id));
    }
    for f in &added[paired..] {
        diff.added.push(reference(component, &after.name, &f.id));
    }
}
