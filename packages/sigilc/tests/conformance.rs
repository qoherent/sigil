//! The shared conformance corpus (`spec/conformance`), read by both the
//! TypeScript parser and this one. Each case compares the normalized structural
//! view: ids and diagnostic messages are left out, and ranges are UTF-8 bytes.
use serde_json::{Value, json};
use sigilc::language::{
    parse::Span,
    resolve::{
        AccessStatus, FacetPos, ImportStatus, IntroductionKind, NameStatus, ResolvedComponent,
        ResolvedWorkspace, TagRef, TagStatus,
    },
    workspace::Workspace,
};
use std::{
    cmp::Ordering,
    fs,
    path::{Path, PathBuf},
};

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/conformance")
}

fn span(s: Span) -> Value {
    json!([s.start, s.end])
}

/// The primary weight of a character under ICU root collation, enough for the
/// paths, digits, and diagnostic codes the view's sort keys contain.
fn primary(c: char) -> (u32, u32) {
    const PUNCTUATION: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    if let Some(i) = PUNCTUATION.find(c) {
        (0, i as u32)
    } else if c.is_ascii_digit() {
        (1, c as u32)
    } else if c.is_alphabetic() {
        (2, c.to_lowercase().next().unwrap() as u32)
    } else {
        (3, c as u32)
    }
}

/// `String.prototype.localeCompare` as the TypeScript view sorts with it: NUL is
/// ignorable, letters compare ignoring case first, then lowercase before uppercase.
fn locale_compare(a: &str, b: &str) -> Ordering {
    let strip = |s: &str| s.chars().filter(|c| *c != '\0').collect::<Vec<char>>();
    let (a, b) = (strip(a), strip(b));
    let by_primary = a
        .iter()
        .map(|c| primary(*c))
        .cmp(b.iter().map(|c| primary(*c)));
    by_primary.then_with(|| {
        a.iter()
            .zip(&b)
            .find(|(x, y)| x != y)
            .map_or(Ordering::Equal, |(x, y)| {
                y.is_lowercase().cmp(&x.is_lowercase())
            })
    })
}

fn sorted(mut items: Vec<(String, Value)>) -> Vec<Value> {
    items.sort_by(|a, b| locale_compare(&a.0, &b.0));
    items.into_iter().map(|(_, v)| v).collect()
}

fn key(source: &str, start: usize, extra: &str) -> String {
    format!("{source}\0{start:010}\0{extra}")
}

fn tag_label(resolved: &ResolvedWorkspace, tag: TagRef) -> String {
    let component = &resolved.components[tag.component];
    format!("{}::{}", component.name, component.tags[tag.tag].name)
}

fn owner(resolved: &ResolvedWorkspace, tag: Option<TagRef>) -> Value {
    tag.map_or(Value::Null, |t| json!(tag_label(resolved, t)))
}

fn view_diagnostics(resolved: &ResolvedWorkspace) -> Vec<Value> {
    let items = resolved
        .diagnostics
        .iter()
        .map(|d| {
            let start = d.range.as_ref().map_or(-1, |r| r.start as i64);
            let file = d.file_path.clone();
            (
                format!("{}\0{start}\0{}", file.as_deref().unwrap_or("null"), d.code),
                json!({
                    "code": d.code,
                    "stage": d.stage,
                    "severity": d.severity,
                    "file": d.file_path,
                    "range": d.range.as_ref().map(|r| json!([r.start, r.end])),
                    "related": d.related.iter().map(|r| json!({
                        "file": r.file_path,
                        "range": r.range.as_ref().map(|r| json!([r.start, r.end])),
                    })).collect::<Vec<_>>(),
                }),
            )
        })
        .collect();
    sorted(items)
}

fn facet_view(
    resolved: &ResolvedWorkspace,
    component: &ResolvedComponent,
    ci: usize,
    pos: FacetPos,
) -> Value {
    let document = &resolved.documents[component.file];
    let source = document.source.as_ref().expect("a parsed source");
    let facet = resolved.facet(component, pos);
    let mut introductions = Vec::new();
    for (ti, tag) in component.tags.iter().enumerate() {
        for i in tag.introductions.iter().filter(|i| i.facet == Some(pos)) {
            let tag_ref = (tag.status == TagStatus::Resolved).then_some(TagRef {
                component: ci,
                tag: ti,
            });
            introductions.push(json!({
                "name": i.name,
                "kind": match i.kind { IntroductionKind::Group => "group", IntroductionKind::Inline => "inline" },
                "tag": owner(resolved, tag_ref),
                "range": span(i.range),
                "nameRange": span(i.name_range),
            }));
        }
    }
    let references: Vec<Value> = component
        .references
        .iter()
        .filter(|r| r.facet == pos)
        .map(|r| {
            json!({
                "name": r.name,
                "status": match r.status { AccessStatus::Resolved => "resolved", AccessStatus::Ambiguous => "ambiguous" },
                "tag": owner(resolved, r.tag),
                "range": span(r.range),
            })
        })
        .collect();
    let links: Vec<Value> = facet
        .links
        .iter()
        .map(|l| json!({"destination": l.destination, "image": l.image, "range": span(l.range)}))
        .collect();
    let payload = facet.payload.as_ref().map(|p| {
        json!({
            "type": p.kind,
            "range": span(p.range),
            "bodyRange": span(p.body_range),
            "openingRange": span(p.opening_range),
            "closingRange": p.closing_range.map(span),
            "fenceLength": p.fence_length,
            "rawBody": &source.text[p.body_range.start..p.body_range.end],
        })
    });
    json!({
        "source": resolved.paths[component.file],
        "component": component.name,
        "section": facet.section,
        "group": facet.group.as_ref().map(|g| g.name.clone()),
        "range": span(facet.range),
        "proseRange": span(facet.prose_range),
        "introductions": introductions,
        "references": references,
        "links": links,
        "payload": payload,
        "valid": facet.valid,
        "complete": facet.complete,
    })
}

fn push_groups(
    resolved: &ResolvedWorkspace,
    component: &ResolvedComponent,
    ci: usize,
    section: &sigilc::language::parse::Section,
    group: &sigilc::language::parse::Group,
    out: &mut Vec<(String, Value)>,
) {
    let tag = component
        .tags
        .iter()
        .position(|t| t.name == group.name && t.status == TagStatus::Resolved)
        .map(|tag| TagRef { component: ci, tag });
    let source = &resolved.paths[component.file];
    out.push((
        key(source, group.range.start, ""),
        json!({
            "source": source,
            "component": component.name,
            "name": group.name,
            "tag": owner(resolved, tag),
            "section": section.name,
            "range": span(group.range),
            "headerRange": span(group.header_range),
            "bodyRange": span(group.body_range),
            "valid": group.valid,
            "complete": group.complete,
        }),
    ));
    for child in &group.groups {
        push_groups(resolved, component, ci, section, child, out);
    }
}

/// The normalized corpus view of one resolved workspace.
fn structural_view(resolved: &ResolvedWorkspace) -> Value {
    let diagnostics = view_diagnostics(resolved);
    if !resolved.text_complete {
        return json!({
            "exported": false, "sources": [], "components": [], "tags": [],
            "groups": [], "facets": [], "imports": [], "diagnostics": diagnostics,
        });
    }
    let (mut components, mut tags, mut groups, mut facets) = (vec![], vec![], vec![], vec![]);
    for (ci, component) in resolved.components.iter().enumerate() {
        let source = &resolved.paths[component.file];
        let declaration = resolved.declaration(component);
        components.push((
            key(source, declaration.range.start, ""),
            json!({
                "source": source,
                "name": component.name,
                "range": span(declaration.range),
                "nameRange": span(declaration.name_range),
                "identityResolved": component.identity_resolved,
                "valid": declaration.valid,
                "complete": declaration.complete,
            }),
        ));
        for tag in component
            .tags
            .iter()
            .filter(|t| t.status == TagStatus::Resolved)
        {
            tags.push((
                format!("{source}\0{}\0{}", component.name, tag.name),
                json!({
                    "source": source,
                    "component": component.name,
                    "name": tag.name,
                    "identityResolved": true,
                }),
            ));
        }
        for (si, section) in declaration.sections.iter().enumerate() {
            for group in &section.groups {
                push_groups(resolved, component, ci, section, group, &mut groups);
            }
            for (ui, facet) in section.units.iter().enumerate() {
                facets.push((
                    key(source, facet.range.start, ""),
                    facet_view(
                        resolved,
                        component,
                        ci,
                        FacetPos {
                            section: si,
                            unit: ui,
                        },
                    ),
                ));
            }
        }
    }
    let imports: Vec<(String, Value)> = resolved
        .imports
        .iter()
        .map(|item| {
            let document = &resolved.documents[item.file];
            let declaration = &document.imports[item.declaration];
            let source = &resolved.paths[item.file];
            (
                key(source, declaration.range.start, ""),
                json!({
                    "source": source,
                    "target": item.target.map(|t| resolved.paths[t].clone()),
                    "path": declaration.path,
                    "provider": declaration.provider,
                    "range": span(declaration.range),
                    "status": match item.status {
                        ImportStatus::Resolved => "resolved",
                        ImportStatus::UnresolvedPath => "unresolved-path",
                        ImportStatus::UnresolvedProvider => "unresolved-provider",
                    },
                    "names": item.names.iter().map(|n| json!({
                        "name": n.name,
                        "status": match n.status {
                            NameStatus::Resolved => "resolved",
                            NameStatus::Unresolved => "unresolved",
                            NameStatus::Duplicate => "duplicate",
                            NameStatus::Ambiguous => "ambiguous",
                            NameStatus::Invalid => "invalid",
                        },
                        "entity": owner(resolved, n.tag),
                        "range": span(n.range),
                    })).collect::<Vec<_>>(),
                }),
            )
        })
        .collect();
    json!({
        "exported": true,
        "sources": resolved.paths,
        "components": sorted(components),
        "tags": sorted(tags),
        "groups": sorted(groups),
        "facets": sorted(facets),
        "imports": sorted(imports),
        "diagnostics": diagnostics,
    })
}

#[test]
fn every_corpus_case_matches_the_typescript_view() {
    let mut names: Vec<String> = fs::read_dir(corpus())
        .unwrap()
        .map(|e| e.unwrap())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut failures = Vec::new();
    let mut facets = 0;
    let mut diagnostics = 0;
    for name in &names {
        let case = corpus().join(name);
        let workspace = Workspace::load(&case.join("workspace")).unwrap();
        let actual = structural_view(&ResolvedWorkspace::from(&workspace));
        let expected: Value =
            serde_json::from_slice(&fs::read(case.join("expected.json")).unwrap()).unwrap();
        facets += expected["facets"].as_array().unwrap().len();
        diagnostics += expected["diagnostics"].as_array().unwrap().len();
        let bad: Vec<&str> = [
            "exported",
            "sources",
            "components",
            "tags",
            "groups",
            "facets",
            "imports",
            "diagnostics",
        ]
        .into_iter()
        .filter(|k| actual[*k] != expected[*k])
        .collect();
        if !bad.is_empty() {
            failures.push(format!("{name}: differs in {bad:?}"));
            if std::env::var("SIGIL_CONFORMANCE_DEBUG").as_deref() == Ok(name.as_str()) {
                for k in &bad {
                    eprintln!(
                        "--- {k}\nactual:   {}\nexpected: {}",
                        actual[*k], expected[*k]
                    );
                }
            }
        }
    }
    assert!(
        names.len() >= 29,
        "expected the whole corpus, found {}",
        names.len()
    );
    assert!(
        facets > 30 && diagnostics > 15,
        "the corpus must exercise the parser"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
