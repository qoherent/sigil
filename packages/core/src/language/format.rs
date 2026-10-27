//! The formatter: wrap prose to the formatting width without changing any
//! facet, tag identity or embedded content. A faithful port of
//! the TypeScript formatter it replaced.
//!
//! A rewrap is accepted only when the formatted source parses and resolves to
//! the same meaning as the original, and formatting the output again returns
//! the same bytes.
use super::{
    conventions::CONVENTION_PARSE,
    diagnostics::{Location, diagnostic, order_diagnostics},
    fs::MemoryFs,
    parse::{Facet, Span, line_index_at},
    resolve::{FacetPos, ResolvedWorkspace},
    text::{PhysicalLine, SourceText, capture_source},
    width::{PROSE_WIDTH, prose_content_width},
    workspace::{CONFIG_PATH, Workspace},
};
use crate::types::{Diagnostic, Severity};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub const LINE_TOO_LONG: &str = "SIGIL_LINE_TOO_LONG";

/// A malformed conventions file is `sigil check`'s to report. Formatting reads
/// only sources, so it must not fail because of that file.
pub fn is_conventions_error(d: &Diagnostic) -> bool {
    d.code == CONVENTION_PARSE
}

/// A facet by component, section and unit index.
type FacetKey = (usize, usize, usize);

/// The spans that wrapping must not break, and the link destinations that the
/// width count ignores.
type Protected = (Vec<Span>, Vec<Span>);

/// What formatting one source document produced.
#[derive(Debug)]
pub struct FormatResult {
    /// The formatted source, absent when the source cannot be formatted.
    pub formatted_source: Option<String>,
    pub changed: bool,
    pub diagnostics: Vec<Diagnostic>,
}

fn reject(diagnostics: Vec<Diagnostic>) -> FormatResult {
    FormatResult {
        formatted_source: None,
        changed: false,
        diagnostics: order_diagnostics(without_conventions_error(&diagnostics)),
    }
}

/// A result never carries the conventions error, so no caller has to filter it.
fn without_conventions_error(diagnostics: &[Diagnostic]) -> Vec<Diagnostic> {
    diagnostics
        .iter()
        .filter(|d| !is_conventions_error(d))
        .cloned()
        .collect()
}

fn without_width(diagnostics: &[Diagnostic]) -> Vec<Diagnostic> {
    diagnostics
        .iter()
        .filter(|d| d.code != LINE_TOO_LONG)
        .cloned()
        .collect()
}

/// Format `text` as one source document with no workspace around it. A source
/// that imports needs its providers, so it is refused here; use
/// [`format_document`] with the workspace instead.
pub fn format_text(file_path: &str, text: &str) -> FormatResult {
    let mut files = MemoryFs::new();
    files.insert(
        CONFIG_PATH,
        r#"{"sigilVersion":"0.9.0","workspace":{"name":"format"},"files":{"include":["**/*.sigil"]}}"#,
    );
    files.insert(file_path, text);
    let Ok(workspace) = Workspace::load_with(&files) else {
        return reject(Vec::new());
    };
    let resolved = ResolvedWorkspace::from(&workspace);
    let Some(index) = resolved.paths.iter().position(|p| p == file_path) else {
        return reject(resolved.diagnostics);
    };
    if !resolved.documents[index].imports.is_empty() {
        let mut diagnostics = resolved.documents[index].diagnostics.clone();
        diagnostics.push(diagnostic(
            "SIGIL_FORMAT_CONTEXT_UNAVAILABLE",
            "Formatting imports requires the captured workspace and provider vocabulary.",
            Location::at(file_path, None),
        ));
        return reject(diagnostics);
    }
    format_resolved(&workspace, &resolved, index)
}

/// Format one source document of a loaded workspace, resolving its imports
/// against the workspace's providers.
pub fn format_document(workspace: &Workspace, path: &str) -> FormatResult {
    format_document_resolved(workspace, &ResolvedWorkspace::from(workspace), path)
}

/// [`format_document`] for a caller that already resolved `workspace`, so a
/// batch resolves it once instead of once per file.
pub fn format_document_resolved(
    workspace: &Workspace,
    resolved: &ResolvedWorkspace,
    path: &str,
) -> FormatResult {
    match resolved.paths.iter().position(|p| p == path) {
        Some(index) => format_resolved(workspace, resolved, index),
        None => reject(resolved.diagnostics.clone()),
    }
}

fn format_resolved(
    workspace: &Workspace,
    before: &ResolvedWorkspace,
    index: usize,
) -> FormatResult {
    let path = before.paths[index].clone();
    let document = &before.documents[index];
    let Some(source) = document.source.as_ref() else {
        let mut diagnostics = document.diagnostics.clone();
        diagnostics.push(diagnostic(
            "SIGIL_FORMAT_CONTEXT_UNAVAILABLE",
            "Formatting requires the exact captured source document.",
            Location::at(&path, None),
        ));
        return reject(diagnostics);
    };
    let has_errors = before.diagnostics.iter().any(|d| {
        matches!(d.severity, Severity::Error) && d.code != LINE_TOO_LONG && !is_conventions_error(d)
    });
    if has_errors || !document.complete {
        return reject(before.diagnostics.clone());
    }

    // Resolved reference ranges, by component of this file and facet.
    let mut reference_ranges: HashMap<(usize, FacetPos), Vec<Span>> = HashMap::new();
    for component in before.components.iter().filter(|c| c.file == index) {
        for reference in &component.references {
            reference_ranges
                .entry((component.index, reference.facet))
                .or_default()
                .push(reference.range);
        }
    }
    let mut protected: HashMap<FacetKey, Protected> = HashMap::new();
    let mut prose_lines: HashMap<usize, FacetKey> = HashMap::new();
    let mut payload_lines: HashSet<usize> = HashSet::new();
    for (component_index, component) in document.components.iter().enumerate() {
        for (section_index, section) in component.sections.iter().enumerate() {
            for (unit_index, facet) in section.units.iter().enumerate() {
                let key = (component_index, section_index, unit_index);
                let mut spans: Vec<Span> = facet.definitions.iter().map(|d| d.range).collect();
                spans.extend(facet.links.iter().map(|l| l.range));
                if let Some(found) = reference_ranges.get(&(
                    component_index,
                    FacetPos {
                        section: section_index,
                        unit: unit_index,
                    },
                )) {
                    spans.extend(found);
                }
                let destinations = facet.links.iter().map(|l| l.destination_range).collect();
                protected.insert(key, (spans, destinations));
                mark_lines(source, facet.prose_range, |line| {
                    prose_lines.insert(line, key);
                });
                if let Some(payload) = &facet.payload {
                    mark_lines(source, payload.body_range, |line| {
                        payload_lines.insert(line);
                    });
                }
            }
        }
    }

    let mut rendered = String::new();
    let mut blank = false;
    for (line_index, line) in source.lines.iter().enumerate() {
        let content = &source.text[line.start..line.content_end];
        let ending = &source.text[line.content_end..line.end];
        if payload_lines.contains(&line_index) {
            rendered.push_str(content);
            rendered.push_str(ending);
            blank = false;
            continue;
        }
        if let Some(key) = prose_lines.get(&line_index) {
            let (spans, destinations) = &protected[key];
            let Some(wrapped) = wrap_line(source, line, spans, destinations) else {
                let mut diagnostics = without_width(&before.diagnostics);
                diagnostics.push(diagnostic(
                    "SIGIL_UNFORMATTABLE_LINE",
                    "No safe whitespace wrapping preserves this prose line.",
                    Location::at(&path, Some(Span::new(line.start, line.content_end).range())),
                ));
                return reject(diagnostics);
            };
            rendered.push_str(&wrapped.join(if ending.is_empty() { "\n" } else { ending }));
            rendered.push_str(ending);
            blank = false;
        } else {
            let trimmed = content.trim_end_matches([' ', '\t']);
            if trimmed.is_empty() && blank {
                continue;
            }
            rendered.push_str(trimmed);
            rendered.push_str(ending);
            blank = trimmed.is_empty();
        }
    }
    if rendered == source.text {
        return FormatResult {
            formatted_source: Some(rendered),
            changed: false,
            diagnostics: without_conventions_error(&before.diagnostics),
        };
    }

    let mut reformatted = workspace.clone();
    if let Some(file) = reformatted.sources.iter_mut().find(|f| f.path == path) {
        file.capture = capture_source(&path, rendered.as_bytes());
    }
    let after = ResolvedWorkspace::from(&reformatted);
    let invalid = after.diagnostics.iter().any(|d| {
        matches!(d.severity, Severity::Error)
            && !is_conventions_error(d)
            && (d.file_path.as_deref() == Some(path.as_str()) || d.code != LINE_TOO_LONG)
    });
    let unchanged_meaning =
        after
            .paths
            .iter()
            .position(|p| *p == path)
            .is_some_and(|after_index| {
                meaning_signature(before, index) == meaning_signature(&after, after_index)
            });
    if invalid || !unchanged_meaning {
        let mut diagnostics = without_width(&before.diagnostics);
        diagnostics.push(diagnostic(
            "SIGIL_UNFORMATTABLE_LINE",
            "Rewrapping would change structure or resolved source meaning.",
            Location::at(&path, None),
        ));
        return reject(diagnostics);
    }
    FormatResult {
        changed: rendered != source.text,
        formatted_source: Some(rendered),
        diagnostics: without_conventions_error(&after.diagnostics),
    }
}

/// Call `mark` with the index of every physical line a span touches.
fn mark_lines(source: &SourceText, span: Span, mut mark: impl FnMut(usize)) {
    let mut line = line_index_at(source, span.start).unwrap_or(0);
    while line < source.lines.len() && source.lines[line].start < span.end {
        mark(line);
        line += 1;
    }
}

fn safe_prose_line(text: &str) -> bool {
    let content = text.trim_matches([' ', '\t']);
    content != "}" && !content.ends_with('{') && !content.starts_with("```")
}

#[derive(Clone, Copy)]
struct Choice {
    end: usize,
    next: Option<usize>,
}

/// Keep authored physical breaks; new breaks cannot join previously separate
/// names. Returns the wrapped physical lines, or none when no whitespace
/// breaking fits.
fn wrap_line(
    source: &SourceText,
    line: &PhysicalLine,
    protected_spans: &[Span],
    destinations: &[Span],
) -> Option<Vec<String>> {
    let text = source.text[line.start..line.content_end].trim_end_matches([' ', '\t']);
    let indent = text.len() - text.trim_start_matches([' ', '\t']).len();
    let absolute = |from: usize, to: usize| Span::new(line.start + from, line.start + to);

    // Whitespace runs after the indentation, outside every protected span.
    let mut breaks: Vec<(usize, usize)> = Vec::new();
    let bytes = text.as_bytes();
    let mut at = indent;
    while at < bytes.len() {
        if bytes[at] == b' ' || bytes[at] == b'\t' {
            let start = at;
            while at < bytes.len() && (bytes[at] == b' ' || bytes[at] == b'\t') {
                at += 1;
            }
            let run = absolute(start, at);
            if !protected_spans
                .iter()
                .any(|p| run.start < p.end && p.start < run.end)
            {
                breaks.push((start, at));
            }
        } else {
            at += 1;
        }
    }

    let mut starts = vec![indent];
    starts.extend(breaks.iter().map(|b| b.1));
    let mut choices: HashMap<usize, Choice> = HashMap::new();
    for &start in starts.iter().rev() {
        let mut options: Vec<Choice> = Vec::new();
        for &(break_start, break_end) in &breaks {
            if break_start <= start {
                continue;
            }
            if prose_content_width(source, absolute(start, break_start), destinations) > PROSE_WIDTH
            {
                break;
            }
            options.push(Choice {
                end: break_start,
                next: Some(break_end),
            });
        }
        if prose_content_width(source, absolute(start, text.len()), destinations) <= PROSE_WIDTH {
            options.push(Choice {
                end: text.len(),
                next: None,
            });
        }
        let chosen = options.into_iter().rev().find(|option| {
            safe_prose_line(&text[start..option.end])
                && option.next.is_none_or(|next| choices.contains_key(&next))
        });
        if let Some(choice) = chosen {
            choices.insert(start, choice);
        }
    }
    if !choices.contains_key(&indent) {
        return None;
    }
    let mut result = Vec::new();
    let mut start = Some(indent);
    while let Some(from) = start {
        let choice = choices[&from];
        result.push(format!("{}{}", &text[..indent], &text[from..choice.end]));
        start = choice.next;
    }
    Some(result)
}

/// Everything formatting must keep, ignoring where it sits in the file.
fn meaning_signature(resolved: &ResolvedWorkspace, file: usize) -> Value {
    let document = &resolved.documents[file];
    let source = document.source.as_ref();
    let slice = |span: Span| -> String {
        source
            .and_then(|s| s.text.get(span.start..span.end))
            .unwrap_or_default()
            .to_owned()
    };
    let imports: Vec<Value> = document
        .imports
        .iter()
        .map(|i| {
            json!({
                "path": i.path,
                "provider": i.provider,
                "names": i.selections.iter().map(|s| s.name.clone()).collect::<Vec<_>>(),
            })
        })
        .collect();
    let components: Vec<Value> = document
        .components
        .iter()
        .enumerate()
        .map(|(component_index, component)| {
            let references = resolved
                .components
                .iter()
                .find(|c| c.file == file && c.index == component_index)
                .map(|c| c.references.as_slice())
                .unwrap_or_default();
            let sections: Vec<Value> = component
                .sections
                .iter()
                .enumerate()
                .map(|(section_index, section)| {
                    let facets: Vec<Value> = section
                        .units
                        .iter()
                        .enumerate()
                        .map(|(unit_index, facet)| {
                            facet_signature(
                                facet,
                                section,
                                source,
                                &slice,
                                references.iter().filter(|r| {
                                    r.facet
                                        == FacetPos {
                                            section: section_index,
                                            unit: unit_index,
                                        }
                                }),
                            )
                        })
                        .collect();
                    json!({
                        "name": section.name,
                        "groups": section.groups.iter().map(|g| g.name.clone()).collect::<Vec<_>>(),
                        "facets": facets,
                    })
                })
                .collect();
            json!({"name": component.name, "sections": sections})
        })
        .collect();
    json!({"imports": imports, "components": components})
}

fn facet_signature<'a>(
    facet: &Facet,
    section: &super::parse::Section,
    source: Option<&SourceText>,
    slice: &dyn Fn(Span) -> String,
    references: impl Iterator<Item = &'a super::resolve::ResolvedReference>,
) -> Value {
    let group = facet.group.as_ref().and_then(|reference| {
        section
            .groups
            .iter()
            .position(|g| g.header_range.start == reference.header_start)
    });
    // The paragraph's physical lines, each trimmed, joined by one space.
    let mut lines: Vec<String> = Vec::new();
    if let Some(source) = source {
        mark_lines(source, facet.prose_range, |index| {
            let line = &source.lines[index];
            lines.push(
                source.text[line.start..line.content_end]
                    .trim_matches([' ', '\t'])
                    .to_owned(),
            );
        });
    }
    let prose = collapse_blanks(&lines.join(" "));
    json!({
        "group": group.map(|g| g as i64).unwrap_or(-1),
        "prose": prose,
        "definitions": facet.definitions.iter().map(|d| json!({
            "name": d.name,
            "raw": slice(d.range),
        })).collect::<Vec<_>>(),
        "references": references.map(|r| json!({
            "name": r.name,
            "status": format!("{:?}", r.status),
            "identity": r.tag.map(|t| format!("{}:{}", t.component, t.tag)),
        })).collect::<Vec<_>>(),
        "links": facet.links.iter().map(|l| json!({
            "raw": slice(l.range),
            "label": l.label,
            "destination": l.destination,
            "title": l.title,
            "image": l.image,
        })).collect::<Vec<_>>(),
        "payloads": facet.payload.iter().map(|p| json!({
            "type": p.kind,
            "rawBody": slice(p.body_range),
            "fenceLength": p.fence_length,
        })).collect::<Vec<_>>(),
    })
}

/// Replace every run of spaces and tabs with one space.
fn collapse_blanks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_blank = false;
    for c in text.chars() {
        if c == ' ' || c == '\t' {
            if !in_blank {
                out.push(' ');
            }
            in_blank = true;
        } else {
            out.push(c);
            in_blank = false;
        }
    }
    out
}
