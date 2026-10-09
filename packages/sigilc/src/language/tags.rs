//! Longest-match, word-boundary Tag references.
//! A port of `packages/core/src/tag-matching.ts`.
use super::{data::word_characters::WORD_CHARACTER_RANGES, parse::Span, text::SourceText};

pub fn is_tag_word_character(c: Option<char>) -> bool {
    let Some(c) = c else { return false };
    let code = c as u32;
    WORD_CHARACTER_RANGES
        .binary_search_by(|&(start, end)| {
            if code < start {
                std::cmp::Ordering::Greater
            } else if code > end {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagMatch {
    pub name: String,
    pub range: Span,
}

/// Eligible regions already exclude physical endings, definitions, and links.
pub fn match_tag_references<S: AsRef<str>>(
    source: &SourceText,
    regions: &[Span],
    names: &[S],
) -> Vec<TagMatch> {
    struct Candidate {
        name: String,
        length: usize,
        range: Span,
    }
    let mut matches: Vec<Candidate> = Vec::new();
    let vocabulary: Vec<(&str, usize)> = names
        .iter()
        .map(|n| n.as_ref())
        .filter(|n| !n.is_empty())
        .map(|n| (n, n.chars().count()))
        .collect();
    for region in regions {
        let text = &source.text[region.start..region.end];
        let scalars: Vec<(usize, char)> = text.char_indices().collect();
        // Scalar index of each byte offset that starts a scalar, plus the end.
        let index_of = |offset: usize| -> Option<usize> {
            if offset == text.len() {
                Some(scalars.len())
            } else {
                scalars.binary_search_by_key(&offset, |(o, _)| *o).ok()
            }
        };
        let scalar = |i: isize| -> Option<char> {
            usize::try_from(i)
                .ok()
                .and_then(|i| scalars.get(i))
                .map(|(_, c)| *c)
        };
        for &(name, length) in &vocabulary {
            let mut from = 0;
            while from < text.len() {
                let Some(found) = text[from..].find(name) else {
                    break;
                };
                let start = from + found;
                let end = start + name.len();
                from = start + text[start..].chars().next().map_or(1, char::len_utf8);
                let (Some(a), Some(b)) = (index_of(start), index_of(end)) else {
                    continue;
                };
                let (a, b) = (a as isize, b as isize);
                if is_tag_word_character(scalar(a - 1)) || is_tag_word_character(scalar(b)) {
                    continue;
                }
                let (mut before, mut after) = (a - 1, b);
                while matches!(scalar(before), Some('-' | '.')) {
                    before -= 1;
                }
                while matches!(scalar(after), Some('-' | '.')) {
                    after += 1;
                }
                if (before < a - 1 && is_tag_word_character(scalar(before)))
                    || (after > b && is_tag_word_character(scalar(after)))
                {
                    continue;
                }
                matches.push(Candidate {
                    name: name.to_owned(),
                    length,
                    range: Span::new(region.start + start, region.start + end),
                });
            }
        }
    }
    matches.sort_by(|a, b| {
        b.length
            .cmp(&a.length)
            .then(a.range.start.cmp(&b.range.start))
    });
    let mut chosen: Vec<Candidate> = Vec::new();
    for m in matches {
        if !chosen
            .iter()
            .any(|o| m.range.start < o.range.end && o.range.start < m.range.end)
        {
            chosen.push(m);
        }
    }
    chosen.sort_by_key(|m| m.range.start);
    chosen
        .into_iter()
        .map(|m| TagMatch {
            name: m.name,
            range: m.range,
        })
        .collect()
}
