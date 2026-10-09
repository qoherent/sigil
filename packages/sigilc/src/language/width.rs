//! The 79-column prose width rule. A port of `packages/core/src/prose-width.ts`.
use super::{
    diagnostics::{Location, diagnostic},
    parse::{Facet, Span, line_index_at},
    text::SourceText,
};
use crate::structure::Diagnostic;

pub const PROSE_WIDTH: usize = 79;

/// Count original scalars, subtracting the union of raw link destination spans.
pub fn prose_content_width(source: &SourceText, range: Span, destinations: &[Span]) -> usize {
    let count = |s: Span| source.text[s.start..s.end].chars().count();
    let mut width = count(range);
    let mut covered_end = range.start;
    let mut sorted = destinations.to_vec();
    sorted.sort_by_key(|d| d.start);
    for destination in sorted {
        let start = range.start.max(destination.start).max(covered_end);
        let end = range.end.min(destination.end);
        if end > start {
            width -= count(Span::new(start, end));
            covered_end = end;
        }
    }
    width
}

pub fn prose_width_diagnostics(
    file_path: &str,
    source: &SourceText,
    facets: &[&Facet],
    references: &[Span],
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for facet in facets {
        let destinations: Vec<Span> = facet.links.iter().map(|l| l.destination_range).collect();
        let mut protected: Vec<Span> = facet.definitions.iter().map(|d| d.range).collect();
        protected.extend(facet.links.iter().map(|l| l.range));
        protected.extend(
            references
                .iter()
                .filter(|r| r.start >= facet.prose_range.start && r.end <= facet.prose_range.end),
        );
        let first = line_index_at(source, facet.prose_range.start).unwrap_or(0);
        let mut i = first;
        while i < source.lines.len() && source.lines[i].start < facet.prose_range.end {
            let line = &source.lines[i];
            i += 1;
            let content = &source.text[line.start..line.content_end];
            let indent = content.len() - content.trim_start_matches([' ', '\t']).len();
            let range = Span::new(line.start + indent, line.content_end);
            if prose_content_width(source, range, &destinations) <= PROSE_WIDTH {
                continue;
            }
            let mut tokens = Vec::new();
            let mut token_start = None;
            for (offset, c) in content.char_indices().chain([(content.len(), ' ')]) {
                if c == ' ' || c == '\t' {
                    if let Some(s) = token_start.take() {
                        tokens.push(Span::new(line.start + s, line.start + offset));
                    }
                } else if token_start.is_none() {
                    token_start = Some(offset);
                }
            }
            let indivisible = tokens.iter().chain(&protected).any(|span| {
                let start = span.start.max(range.start);
                let end = span.end.min(range.end);
                end > start
                    && prose_content_width(source, Span::new(start, end), &destinations)
                        > PROSE_WIDTH
            });
            diagnostics.push(diagnostic(
                if indivisible {
                    "SIGIL_UNFORMATTABLE_LINE"
                } else {
                    "SIGIL_LINE_TOO_LONG"
                },
                if indivisible {
                    "An indivisible prose span exceeds 79 content characters."
                } else {
                    "Prose exceeds 79 content characters on a physical line."
                },
                Location::at(
                    file_path,
                    Some(Span::new(line.start, line.content_end).range()),
                ),
            ));
        }
    }
    diagnostics
}
