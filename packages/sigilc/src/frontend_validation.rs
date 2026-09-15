//! Referential validation against captured original UTF-8 buffers.
use crate::frontend::*;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn validate(input: &DesignInput) -> Result<(), String> {
    ensure(
        input.schema_version == 2,
        "unsupported frontend schema version",
    )?;
    ensure(
        input.language_version == "0.8.0",
        "unsupported frontend language version",
    )?;
    ensure(
        !input.frontend_version.is_empty(),
        "missing frontend version",
    )?;
    unique(input.sources.iter().map(|s| s.path.as_str()), "source path")?;
    for s in &input.sources {
        normalized_path(&s.path)?;
        ensure(
            s.path.ends_with(".sigil") && !s.path.starts_with(".sigil/"),
            "invalid Design source path",
        )?;
    }
    let sources: BTreeMap<_, _> = input
        .sources
        .iter()
        .map(|s| (s.path.as_str(), s.text.as_str()))
        .collect();
    let context = unique(
        input.context.iter().map(|c| c.path.as_str()),
        "context path",
    )?;
    ensure(
        context
            == BTreeSet::from([
                ".sigil/config.json",
                ".sigil/glossary.json",
                ".sigil/local.json",
            ]),
        "context must capture config, local config and glossary, including absence",
    )?;
    unique(
        input.entities.iter().map(|e| e.id.as_str()),
        "entity identity",
    )?;
    let entities: BTreeMap<_, _> = input.entities.iter().map(|e| (e.id.as_str(), e)).collect();
    let component = |id: &str| -> Result<&Entity, String> {
        entities
            .get(id)
            .filter(|e| e.kind == EntityType::Component)
            .copied()
            .ok_or_else(|| "owner is not a component".into())
    };
    let tag = |id: &str| -> Result<&Entity, String> {
        entities
            .get(id)
            .filter(|e| e.kind == EntityType::Tag)
            .copied()
            .ok_or_else(|| "unknown Tag identity".into())
    };
    let owned = |owner: &str, source: &str, range: &Range| -> Result<(), String> {
        let c = component(owner)?;
        ensure(
            c.source == source && contains(&c.range, range),
            "occurrence outside its component owner",
        )
    };
    for e in &input.entities {
        let text = source(&sources, &e.source)?;
        checked_range(text, &e.range)?;
        checked_range(text, &e.name_range)?;
        ensure(
            contains(&e.range, &e.name_range),
            "entity name outside range",
        )?;
        ensure(!e.label.is_empty(), "empty entity label")?;
        ensure(
            !e.valid || slice(text, &e.name_range) == e.label,
            "entity name differs from source",
        )?;
        match e.kind {
            EntityType::Component => {
                ensure(e.owner.is_none(), "component has an owner")?;
                let base = format!(
                    "urn:sigil:component:{}:{}",
                    encode_identifier(&e.source),
                    encode_identifier(&e.label)
                );
                let id = if e.identity_resolved {
                    base
                } else {
                    format!("{base}:at:{}", e.range.start)
                };
                ensure(
                    e.id == id,
                    "component identity differs from source occurrence",
                )?;
            }
            EntityType::Tag => {
                let c = component(e.owner.as_deref().ok_or("Tag has no owner")?)?;
                owned(&c.id, &e.source, &e.range)?;
                ensure(
                    c.identity_resolved && e.identity_resolved && e.valid,
                    "unresolved Tag identity",
                )?;
                ensure(
                    e.id == format!("{}:tag:{}", c.id, encode_identifier(&e.label)),
                    "Tag identity differs from exact owner and name",
                )?;
            }
        }
    }
    unique(input.units.iter().map(|u| u.id.as_str()), "unit identity")?;
    unique(input.groups.iter().map(|g| g.id.as_str()), "group identity")?;
    unique(
        input.introductions.iter().map(|i| i.id.as_str()),
        "introduction identity",
    )?;
    unique(
        input.references.iter().map(|r| r.id.as_str()),
        "reference identity",
    )?;
    unique(input.links.iter().map(|l| l.id.as_str()), "link identity")?;
    unique(
        input.imports.iter().map(|i| i.id.as_str()),
        "import identity",
    )?;
    unique(
        input
            .imports
            .iter()
            .flat_map(|i| i.names.iter().map(|n| n.id.as_str())),
        "selection identity",
    )?;
    let units: BTreeMap<_, _> = input.units.iter().map(|u| (u.id.as_str(), u)).collect();
    let groups: BTreeMap<_, _> = input.groups.iter().map(|g| (g.id.as_str(), g)).collect();
    let refs: BTreeMap<_, _> = input
        .references
        .iter()
        .map(|r| (r.id.as_str(), r))
        .collect();
    let facet = |id: &str, owner: &str, source: &str, range: &Range| -> Result<&Unit, String> {
        let u = units.get(id).ok_or("unknown Facet")?;
        ensure(
            u.owner.as_deref() == Some(owner)
                && u.source == source
                && contains(&u.prose_range, range),
            "occurrence outside consumer Facet prose",
        )?;
        Ok(*u)
    };
    for u in &input.units {
        let text = source(&sources, &u.source)?;
        occurrence("facet", &u.id, &u.source, &u.range, text)?;
        checked_range(text, &u.prose_range)?;
        ensure(
            contains(&u.range, &u.prose_range),
            "Facet prose outside its range",
        )?;
        if let Some(owner) = &u.owner {
            owned(owner, &u.source, &u.range)?;
        } else {
            ensure(!u.valid, "valid Facet has no owner")?;
        }
        if let Some(id) = &u.grouping {
            let g = groups
                .get(id.as_str())
                .ok_or("unknown grouping occurrence")?;
            ensure(
                u.owner.as_deref() == Some(&g.owner)
                    && u.source == g.source
                    && u.section == g.section
                    && contains(&g.body_range, &u.range),
                "foreign grouping owner or contract",
            )?;
        }
        if let Some(p) = &u.payload {
            for r in [&p.range, &p.body_range, &p.opening_range]
                .into_iter()
                .chain(p.closing_range.iter())
            {
                checked_range(text, r)?;
                ensure(
                    contains(&u.range, r) && contains(&p.range, r),
                    "payload range outside Facet",
                )?;
            }
            ensure(
                slice(text, &p.body_range) == p.raw_body,
                "payload raw body differs from source",
            )?;
        }
        exact_members(
            &u.introductions,
            input
                .introductions
                .iter()
                .filter(|i| i.facet.as_deref() == Some(&u.id))
                .map(|i| i.id.as_str()),
        )?;
        exact_members(
            &u.references,
            input
                .references
                .iter()
                .filter(|r| r.facet == u.id)
                .map(|r| r.id.as_str()),
        )?;
        exact_members(
            &u.links,
            input
                .links
                .iter()
                .filter(|l| l.facet == u.id)
                .map(|l| l.id.as_str()),
        )?;
    }
    for g in &input.groups {
        let text = source(&sources, &g.source)?;
        occurrence("group", &g.id, &g.source, &g.range, text)?;
        owned(&g.owner, &g.source, &g.range)?;
        for r in [&g.name_range, &g.header_range, &g.body_range] {
            checked_range(text, r)?;
            ensure(contains(&g.range, r), "group subrange outside group")?;
        }
        ensure(
            !g.valid || slice(text, &g.name_range) == g.name,
            "group name differs from source",
        )?;
        if let Some(id) = &g.tag {
            let t = tag(id)?;
            ensure(
                t.owner.as_deref() == Some(&g.owner) && t.label == g.name,
                "group has foreign Tag owner",
            )?;
        }
    }
    for i in &input.introductions {
        let text = source(&sources, &i.source)?;
        occurrence(
            if i.kind == IntroductionKind::Group {
                "group"
            } else {
                "definition"
            },
            &i.id,
            &i.source,
            &i.range,
            text,
        )?;
        owned(&i.owner, &i.source, &i.range)?;
        checked_range(text, &i.name_range)?;
        ensure(
            contains(&i.range, &i.name_range),
            "introduction name outside range",
        )?;
        ensure(
            !i.valid || slice(text, &i.name_range) == i.name,
            "introduction name differs from source",
        )?;
        if let Some(id) = &i.tag {
            let t = tag(id)?;
            ensure(
                t.owner.as_deref() == Some(&i.owner) && t.label == i.name,
                "introduction has foreign Tag owner",
            )?;
        }
        match i.kind {
            IntroductionKind::Inline => {
                let u = facet(
                    i.facet
                        .as_deref()
                        .ok_or("inline introduction has no Facet")?,
                    &i.owner,
                    &i.source,
                    &i.range,
                )?;
                ensure(
                    u.section == i.section && i.group.is_none(),
                    "inline introduction has foreign contract or grouping",
                )?;
            }
            IntroductionKind::Group => {
                let g = groups
                    .get(
                        i.group
                            .as_deref()
                            .ok_or("group introduction has no group")?,
                    )
                    .ok_or("unknown introduction group")?;
                ensure(
                    i.facet.is_none()
                        && g.owner == i.owner
                        && g.section == i.section
                        && g.header_range == i.range
                        && g.tag == i.tag,
                    "group introduction differs from grouping",
                )?;
            }
        }
    }
    for r in &input.references {
        let text = source(&sources, &r.source)?;
        occurrence("reference", &r.id, &r.source, &r.range, text)?;
        facet(&r.facet, &r.owner, &r.source, &r.range)?;
        ensure(
            slice(text, &r.range) == r.name,
            "reference name differs from source",
        )?;
        ensure(
            (r.status == ReferenceStatus::Resolved) == r.tag.is_some(),
            "reference status differs from identity",
        )?;
        if let Some(id) = &r.tag {
            let t = tag(id)?;
            ensure(t.label == r.name, "reference Tag spelling differs")?;
            ensure(
                t.owner.as_deref() == Some(&r.owner)
                    || input.imports.iter().any(|i| {
                        i.source == r.source
                            && i.names.iter().any(|n| {
                                n.status == SelectionStatus::Resolved
                                    && n.entity.as_ref() == Some(id)
                                    && n.uses.contains(&r.id)
                            })
                    }),
                "reference has no local or selected Tag origin",
            )?;
        }
    }
    for l in &input.links {
        let text = source(&sources, &l.source)?;
        occurrence("link", &l.id, &l.source, &l.range, text)?;
        facet(&l.facet, &l.owner, &l.source, &l.range)?;
        checked_range(text, &l.destination_range)?;
        ensure(
            contains(&l.range, &l.destination_range) && slice(text, &l.range) == l.raw,
            "link source evidence differs",
        )?;
    }
    for i in &input.imports {
        let text = source(&sources, &i.source)?;
        occurrence("import", &i.id, &i.source, &i.range, text)?;
        for r in [&i.path_range, &i.provider_range] {
            checked_range(text, r)?;
            ensure(contains(&i.range, r), "import subrange outside declaration")?;
        }
        if let Some(target) = &i.target {
            source(&sources, target)?;
        }
        if let Some(id) = &i.provider_id {
            let c = component(id)?;
            ensure(
                c.identity_resolved
                    && i.target.as_deref() == Some(&c.source)
                    && c.label == i.provider,
                "import provider identity differs",
            )?;
        }
        ensure(
            i.status != ImportStatus::Resolved || (i.target.is_some() && i.provider_id.is_some()),
            "resolved import has no provider",
        )?;
        for n in &i.names {
            occurrence("selection", &n.id, &i.source, &n.range, text)?;
            ensure(contains(&i.range, &n.range), "selection outside import")?;
            ensure(
                n.status == SelectionStatus::Invalid || slice(text, &n.range) == n.name,
                "selection spelling differs from source",
            )?;
            ensure(
                n.status != SelectionStatus::Resolved || n.entity.is_some(),
                "resolved selection has no Tag",
            )?;
            if let Some(id) = &n.entity {
                let t = tag(id)?;
                ensure(
                    t.label == n.name && t.owner == i.provider_id,
                    "selection does not belong to declared provider",
                )?;
            }
            for id in unique(n.uses.iter().map(String::as_str), "selection use")? {
                let r = refs.get(id).ok_or("selection use is not a reference")?;
                ensure(
                    n.status == SelectionStatus::Resolved
                        && r.source == i.source
                        && r.tag == n.entity
                        && r.name == n.name,
                    "selection use differs from consumer reference",
                )?;
            }
        }
    }
    for t in input.entities.iter().filter(|e| e.kind == EntityType::Tag) {
        let introductions: Vec<_> = input
            .introductions
            .iter()
            .filter(|i| i.tag.as_deref() == Some(&t.id))
            .collect();
        ensure(
            !introductions.is_empty() && introductions.iter().any(|i| i.valid),
            "Tag has no valid introduction",
        )?;
        ensure(
            introductions
                .iter()
                .filter(|i| i.kind == IntroductionKind::Inline && i.valid)
                .count()
                <= 1,
            "Tag has duplicate inline definitions",
        )?;
    }
    for r in &input.references {
        ensure(
            !input
                .links
                .iter()
                .any(|l| l.source == r.source && overlaps(&l.range, &r.range))
                && !input.introductions.iter().any(|i| {
                    i.kind == IntroductionKind::Inline
                        && i.source == r.source
                        && overlaps(&i.range, &r.range)
                }),
            "reference overlaps protected inline content",
        )?;
    }
    let diagnostic_sources: BTreeMap<_, _> = sources
        .into_iter()
        .chain(
            input
                .context
                .iter()
                .filter_map(|c| c.text.as_deref().map(|t| (c.path.as_str(), t))),
        )
        .collect();
    for d in &input.diagnostics {
        location(
            &diagnostic_sources,
            d.file_path.as_deref(),
            d.range.as_ref(),
            d.implementation_range.as_ref(),
        )?;
        for r in &d.related {
            location(
                &diagnostic_sources,
                r.file_path.as_deref(),
                r.range.as_ref(),
                r.implementation_range.as_ref(),
            )?;
        }
    }
    Ok(())
}
fn source<'a>(sources: &BTreeMap<&str, &'a str>, path: &str) -> Result<&'a str, String> {
    sources
        .get(path)
        .copied()
        .ok_or_else(|| format!("source is not captured: {path}"))
}
fn checked_range(text: &str, r: &Range) -> Result<(), String> {
    ensure(
        r.start <= r.end
            && r.end <= text.len()
            && text.is_char_boundary(r.start)
            && text.is_char_boundary(r.end),
        "range is not on original UTF-8 boundaries",
    )
}
fn contains(outer: &Range, inner: &Range) -> bool {
    outer.start <= inner.start && inner.end <= outer.end
}
fn slice<'a>(text: &'a str, r: &Range) -> &'a str {
    &text[r.start..r.end]
}
fn occurrence(kind: &str, id: &str, path: &str, range: &Range, text: &str) -> Result<(), String> {
    checked_range(text, range)?;
    ensure(
        id == format!("{kind}:{}:{}", encode_identifier(path), range.start),
        "occurrence identity differs from source range",
    )
}
fn exact_members<'a>(
    actual: &[String],
    expected: impl Iterator<Item = &'a str>,
) -> Result<(), String> {
    ensure(
        unique(actual.iter().map(String::as_str), "Facet relationship")? == expected.collect(),
        "Facet relationships differ from occurrence inventory",
    )
}
fn location(
    sources: &BTreeMap<&str, &str>,
    path: Option<&str>,
    range: Option<&Range>,
    implementation: Option<&ImplementationRange>,
) -> Result<(), String> {
    ensure(
        range.is_none() || implementation.is_none(),
        "diagnostic mixes coordinate conventions",
    )?;
    if let Some(p) = path {
        normalized_path(p)?;
    }
    if let Some(r) = range {
        ensure(r.start <= r.end, "invalid diagnostic range")?;
        if let Some(text) = path.and_then(|p| sources.get(p)) {
            checked_range(text, r)?;
        }
    }
    if let Some(r) = implementation {
        ensure(
            r.start.line > 0 && r.start.column > 0 && r.end.column > 0 && r.start <= r.end,
            "invalid implementation range",
        )?;
    }
    Ok(())
}

fn overlaps(a: &Range, b: &Range) -> bool {
    a.start < b.end && b.start < a.end
}
