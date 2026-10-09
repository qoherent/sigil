//! Diagnostic construction, staging, and canonical ordering.
use crate::structure::{Diagnostic, Range, RelatedLocation, Severity, Stage};
use std::{cmp::Ordering, collections::BTreeMap};

/// Where a diagnostic points. Related locations are sorted on construction.
#[derive(Debug, Clone, Default)]
pub struct Location {
    pub file_path: Option<String>,
    pub range: Option<Range>,
    pub related: Vec<RelatedLocation>,
}

impl Location {
    pub fn at(file_path: &str, range: Option<Range>) -> Self {
        Self {
            file_path: Some(file_path.to_owned()),
            range,
            related: Vec::new(),
        }
    }

    pub fn with_related(mut self, file_path: &str) -> Self {
        self.related.push(RelatedLocation {
            file_path: Some(file_path.to_owned()),
            range: None,
            implementation_range: None,
            source_digest: None,
            message: None,
        });
        self
    }
}

pub fn diagnostic(code: &str, message: impl Into<String>, location: Location) -> Diagnostic {
    let mut related = location.related;
    related.sort_by(compare_related_location);
    Diagnostic {
        code: code.to_owned(),
        stage: stage_of(code),
        severity: Severity::Error,
        message: message.into(),
        file_path: location.file_path,
        range: location.range,
        implementation_range: None,
        source_digest: None,
        related,
    }
}

pub fn stage_of(code: &str) -> Stage {
    let name = code.strip_prefix("SIGIL_").unwrap_or(code);
    let starts = |prefixes: &[&str]| prefixes.iter().any(|p| name.starts_with(p));
    if starts(&["CONFIG", "NESTED_CONFIG", "UNSUPPORTED_VERSION"]) {
        Stage::Workspace
    } else if starts(&[
        "IMPLEMENTATION",
        "RETRIEVAL",
        "BOUNDARY",
        "GLOSSARY",
        "FORMAT_CONTEXT",
    ]) {
        Stage::Host
    } else if starts(&[
        "LINK_TARGET",
        "INTERPRETATION",
        "SEMANTIC",
        "LAYOUT_DEPENDENT",
    ]) {
        Stage::Interpretation
    } else if starts(&[
        "UNRESOLVED",
        "DUPLICATE_COMPONENT",
        "DUPLICATE_TAG",
        "TAG_NAME_COLLISION",
        "UNUSED_TAG",
        "UNTAGGED_FACET",
    ]) {
        Stage::Resolution
    } else if starts(&[
        "MISSING",
        "DUPLICATE_SECTION",
        "SECTION_ORDER",
        "EMPTY_TAG",
        "NESTED_TAG",
    ]) {
        Stage::Structure
    } else {
        Stage::Parsing
    }
}

type LocationKey<'a> = (&'a Option<String>, &'a Option<Range>, String);

fn key<'a>(
    file_path: &'a Option<String>,
    range: &'a Option<Range>,
    implementation: String,
) -> LocationKey<'a> {
    (file_path, range, implementation)
}

fn compare_locations(a: LocationKey, b: LocationKey) -> Ordering {
    // Missing paths sort first; byte order of UTF-8 equals code-point order.
    a.0.cmp(b.0)
        .then_with(|| {
            let start = |r: &Option<Range>| r.as_ref().map_or(-1, |r| r.start as i64);
            let end = |r: &Option<Range>| r.as_ref().map_or(-1, |r| r.end as i64);
            start(a.1)
                .cmp(&start(b.1))
                .then_with(|| end(a.1).cmp(&end(b.1)))
        })
        .then_with(|| a.2.cmp(&b.2))
}

fn compare_related_location(a: &RelatedLocation, b: &RelatedLocation) -> Ordering {
    let implementation = |l: &RelatedLocation| {
        serde_json::to_string(&l.implementation_range).expect("implementation range serializes")
    };
    compare_locations(
        key(&a.file_path, &a.range, implementation(a)),
        key(&b.file_path, &b.range, implementation(b)),
    )
}

fn compare_diagnostic_locations(a: &Diagnostic, b: &Diagnostic) -> Ordering {
    let implementation = |d: &Diagnostic| {
        serde_json::to_string(&d.implementation_range).expect("implementation range serializes")
    };
    compare_locations(
        key(&a.file_path, &a.range, implementation(a)),
        key(&b.file_path, &b.range, implementation(b)),
    )
}

fn canonical(d: &Diagnostic) -> String {
    serde_json::to_string(d).expect("diagnostic serializes")
}

/// Canonical order, with complete-record coalescing; distinct evidence survives.
pub fn order_diagnostics(input: Vec<Diagnostic>) -> Vec<Diagnostic> {
    let mut distinct = BTreeMap::new();
    for mut d in input {
        d.related.sort_by(compare_related_location);
        distinct.insert(canonical(&d), d);
    }
    let mut ordered: Vec<Diagnostic> = distinct.into_values().collect();
    ordered.sort_by(|a, b| {
        compare_diagnostic_locations(a, b)
            .then_with(|| a.code.cmp(&b.code))
            .then_with(|| {
                for (x, y) in a.related.iter().zip(&b.related) {
                    let order = compare_related_location(x, y);
                    if order != Ordering::Equal {
                        return order;
                    }
                }
                a.related.len().cmp(&b.related.len())
            })
            .then_with(|| canonical(a).cmp(&canonical(b)))
    });
    ordered
}
