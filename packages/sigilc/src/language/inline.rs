//! Inline content of one prose paragraph: CommonMark-subset links and images,
//! `*Tag*` definitions, and the regions left eligible for bare references.
//! A port of `packages/core/src/inline-content.ts`.
use super::{
    data::html_entities::HTML_ENTITIES,
    diagnostics::{Location, diagnostic},
    parse::{Span, line_index_at},
    text::SourceText,
};
use crate::structure::Diagnostic;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineLink {
    pub label: String,
    pub destination: String,
    pub title: Option<String>,
    pub image: bool,
    pub range: Span,
    /// Includes angle brackets when present; exempt from physical width.
    pub destination_range: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineTagDefinition {
    pub name: String,
    pub range: Span,
    pub name_range: Span,
    pub valid: bool,
}

#[derive(Debug, Clone, Default)]
pub struct InlineContent {
    pub links: Vec<InlineLink>,
    pub definitions: Vec<InlineTagDefinition>,
    /// Original physical prose regions eligible for later bare-reference scanning.
    pub eligible: Vec<Span>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn is_source_whitespace(c: char) -> bool {
    let cp = c as u32;
    (0x09..=0x0d).contains(&cp)
        || (0x2000..=0x200a).contains(&cp)
        || matches!(
            cp,
            0x20 | 0x85 | 0xa0 | 0x1680 | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000
        )
}

pub fn valid_tag_name(name: &str) -> bool {
    let (Some(first), Some(last)) = (name.chars().next(), name.chars().next_back()) else {
        return false;
    };
    !is_source_whitespace(first)
        && !is_source_whitespace(last)
        && !name.contains(['*', ',', '{', '}', '\r', '\n', '\0'])
}

const PUNCTUATION: &[u8] = b"!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

fn escaped(b: &[u8], at: usize) -> bool {
    b.get(at) == Some(&b'\\') && b.get(at + 1).is_some_and(|c| PUNCTUATION.contains(c))
}

/// The WHATWG replacement for a numeric reference, as `entities` applies it.
fn replace_code_point(cp: u32) -> char {
    if (0xd800..=0xdfff).contains(&cp) || cp > 0x10ffff {
        return '\u{fffd}';
    }
    let mapped = match cp {
        0 => 0xfffd,
        128 => 8364,
        130 => 8218,
        131 => 402,
        132 => 8222,
        133 => 8230,
        134 => 8224,
        135 => 8225,
        136 => 710,
        137 => 8240,
        138 => 352,
        139 => 8249,
        140 => 338,
        142 => 381,
        145 => 8216,
        146 => 8217,
        147 => 8220,
        148 => 8221,
        149 => 8226,
        150 => 8211,
        151 => 8212,
        152 => 732,
        153 => 8482,
        154 => 353,
        155 => 8250,
        156 => 339,
        158 => 382,
        159 => 376,
        other => other,
    };
    char::from_u32(mapped).unwrap_or('\u{fffd}')
}

/// The extent of a character reference that starts at `at` (an `&`), with its text.
fn entity_at(text: &str, at: usize) -> Option<(usize, String)> {
    let b = text.as_bytes();
    let run = |from: usize, ok: fn(u8) -> bool| {
        let mut end = from;
        while b.get(end).is_some_and(|c| ok(*c)) {
            end += 1;
        }
        end
    };
    let (end, decoded) = if b.get(at + 1) == Some(&b'#') {
        let hex = matches!(b.get(at + 2), Some(b'x' | b'X'));
        let from = at + if hex { 3 } else { 2 };
        let end = run(
            from,
            if hex {
                |c| c.is_ascii_hexdigit()
            } else {
                |c| c.is_ascii_digit()
            },
        );
        let digits = end - from;
        if digits == 0 || digits > if hex { 6 } else { 7 } || b.get(end) != Some(&b';') {
            return None;
        }
        let value = u32::from_str_radix(&text[from..end], if hex { 16 } else { 10 }).ok()?;
        (end + 1, replace_code_point(value).to_string())
    } else {
        if !b.get(at + 1).is_some_and(|c| c.is_ascii_alphabetic()) {
            return None;
        }
        let end = run(at + 1, |c| c.is_ascii_alphanumeric());
        let length = end - (at + 1);
        if !(2..=32).contains(&length) || b.get(end) != Some(&b';') {
            return None;
        }
        // Strict decoding: only the semicolon-terminated names decode.
        let key = &text[at + 1..=end];
        let index = HTML_ENTITIES
            .binary_search_by(|(name, _)| (*name).cmp(key))
            .ok()?;
        (end + 1, HTML_ENTITIES[index].1.to_owned())
    };
    Some((end, decoded))
}

/// Backslash escapes and character references, decoded as CommonMark does for
/// link destinations and titles.
pub fn decode(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        if escaped(b, at) {
            out.push(b[at + 1] as char);
            at += 2;
        } else if b[at] == b'&'
            && let Some((end, decoded)) = entity_at(text, at)
        {
            out.push_str(&decoded);
            at = end;
        } else {
            let c = text[at..].chars().next().expect("on a character boundary");
            out.push(c);
            at += c.len_utf8();
        }
    }
    out
}

struct LinkTail {
    end: usize,
    destination_start: usize,
    destination_end: usize,
    destination: String,
    title: Option<String>,
}

fn is_blank(c: Option<&u8>) -> bool {
    matches!(c, Some(b' ' | b'\t'))
}

/// CommonMark link separators allow at most one physical ending.
fn separator(b: &[u8], mut at: usize) -> usize {
    while is_blank(b.get(at)) {
        at += 1;
    }
    if matches!(b.get(at), Some(b'\r' | b'\n')) {
        at += if b[at] == b'\r' && b.get(at + 1) == Some(&b'\n') {
            2
        } else {
            1
        };
        while is_blank(b.get(at)) {
            at += 1;
        }
    }
    at
}

/// A physical ending, then optional blanks, then a second ending: a blank line.
fn blank_line_at(b: &[u8], at: usize) -> bool {
    let first = match b.get(at) {
        Some(b'\r') if b.get(at + 1) == Some(&b'\n') => 2,
        Some(b'\r') | Some(b'\n') => 1,
        _ => return false,
    };
    let mut next = at + first;
    while is_blank(b.get(next)) {
        next += 1;
    }
    matches!(b.get(next), Some(b'\r' | b'\n'))
}

fn link_tail(text: &str, open: usize) -> Option<LinkTail> {
    let b = text.as_bytes();
    if b.get(open) != Some(&b'(') {
        return None;
    }
    let mut at = separator(b, open + 1);
    let destination_start = at;
    let raw_destination;
    if b.get(at) == Some(&b'<') {
        at += 1;
        let content = at;
        while at < b.len() && b[at] != b'>' {
            if matches!(b[at], b'<' | b'\r' | b'\n' | 0) {
                return None;
            }
            at += if escaped(b, at) { 2 } else { 1 };
        }
        if b.get(at) != Some(&b'>') {
            return None;
        }
        raw_destination = &text[content..at];
        at += 1;
    } else {
        let mut depth = 0usize;
        while at < b.len() {
            if escaped(b, at) {
                at += 2;
                continue;
            }
            let c = b[at];
            if c <= 0x20 || c == 0x7f {
                break;
            }
            if c == b'(' {
                depth += 1;
            }
            if c == b')' {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            at += 1;
        }
        if depth != 0 {
            return None;
        }
        raw_destination = &text[destination_start..at];
    }
    let destination_end = at;
    let after_space = separator(b, at);
    let mut title = None;
    if after_space > at && matches!(b.get(after_space), Some(b'"' | b'\'' | b'(')) {
        let opener = b[after_space];
        let closer = if opener == b'(' { b')' } else { opener };
        at = after_space + 1;
        let title_start = at;
        while at < b.len() && b[at] != closer {
            if b[at] == 0 || (opener == b'(' && b[at] == b'(') || blank_line_at(b, at) {
                return None;
            }
            at += if escaped(b, at) { 2 } else { 1 };
        }
        if b.get(at) != Some(&closer) {
            return None;
        }
        title = Some(decode(&text[title_start..at]));
        at = separator(b, at + 1);
    } else {
        at = after_space;
    }
    if b.get(at) != Some(&b')') {
        return None;
    }
    Some(LinkTail {
        end: at + 1,
        destination_start,
        destination_end,
        destination: decode(raw_destination),
        title,
    })
}

struct Bracket {
    start: usize,
    label_start: usize,
    image: bool,
    active: bool,
}

/// Links and images in one prose paragraph, ordered by start then longest first.
pub fn scan_links(source: &SourceText, range: Span) -> Vec<InlineLink> {
    let text = &source.text[range.start..range.end];
    let b = text.as_bytes();
    let base = range.start;
    let mut links = Vec::new();
    let mut brackets: Vec<Bracket> = Vec::new();
    let mut at = 0;
    while at < b.len() {
        if escaped(b, at) {
            at += 2;
            continue;
        }
        if b[at] == b'[' {
            brackets.push(Bracket {
                start: at,
                label_start: at + 1,
                image: false,
                active: true,
            });
        } else if b[at] == b'!' && b.get(at + 1) == Some(&b'[') {
            brackets.push(Bracket {
                start: at,
                label_start: at + 2,
                image: true,
                active: true,
            });
            at += 1;
        } else if b[at] == b']' {
            let Some(opener) = brackets.pop().filter(|o| o.active) else {
                at += 1;
                continue;
            };
            let Some(tail) = link_tail(text, at + 1) else {
                at += 1;
                continue;
            };
            links.push(InlineLink {
                label: text[opener.label_start..at].to_owned(),
                destination: tail.destination,
                title: tail.title,
                image: opener.image,
                range: Span::new(base + opener.start, base + tail.end),
                destination_range: Span::new(
                    base + tail.destination_start,
                    base + tail.destination_end,
                ),
            });
            if !opener.image {
                for bracket in brackets.iter_mut().filter(|b| !b.image) {
                    bracket.active = false;
                }
            }
            at = tail.end - 1;
        }
        at += 1;
    }
    links.sort_by(|a, b| {
        a.range
            .start
            .cmp(&b.range.start)
            .then(b.range.end.cmp(&a.range.end))
    });
    links
}

/// Scan one maximal prose paragraph. Block boundaries are supplied by the parser.
pub fn scan_inline_content(file_path: &str, source: &SourceText, range: Span) -> InlineContent {
    let links = scan_links(source, range);
    let text = source.text.as_str();
    let mut definitions = Vec::new();
    let mut diagnostics = Vec::new();
    let mut eligible = Vec::new();
    let outer = |c: Option<char>| c.is_none_or(|c| c == ',' || c == '.' || is_source_whitespace(c));
    let first_line = line_index_at(source, range.start).unwrap_or(0);
    let last_line = line_index_at(source, range.end).map_or(source.lines.len(), |i| i + 1);
    let lines = if first_line < last_line {
        &source.lines[first_line..last_line.min(source.lines.len())]
    } else {
        &source.lines[0..0]
    };
    for line in lines {
        if line.content_end <= range.start || line.start >= range.end {
            continue;
        }
        let mut chunks = vec![Span::new(
            line.start.max(range.start),
            line.content_end.min(range.end),
        )];
        for link in &links {
            chunks = chunks
                .into_iter()
                .flat_map(|chunk| {
                    if link.range.end <= chunk.start || link.range.start >= chunk.end {
                        return vec![chunk];
                    }
                    let mut out = Vec::new();
                    if link.range.start > chunk.start {
                        out.push(Span::new(chunk.start, link.range.start));
                    }
                    if link.range.end < chunk.end {
                        out.push(Span::new(link.range.end, chunk.end));
                    }
                    out
                })
                .collect();
        }
        for chunk in chunks {
            let (start, end) = (chunk.start, chunk.end);
            let mut unprotected = start;
            let mut at = start;
            while at < end {
                if text.as_bytes()[at] != b'*' {
                    at += 1;
                    continue;
                }
                let before = if at == line.start {
                    None
                } else {
                    text[..at].chars().next_back()
                };
                let first = text[at + 1..].chars().next();
                if !outer(before) || first.is_none_or(is_source_whitespace) {
                    at += 1;
                    continue;
                }
                let close = text[at + 1..].find('*').map(|i| at + 1 + i);
                let Some(close) = close.filter(|c| *c < end) else {
                    diagnostics.push(diagnostic(
                        "SIGIL_INCOMPLETE_TAG",
                        "Inline Tag has no closing asterisk on this eligible physical region.",
                        Location::at(file_path, Some(Span::new(at, chunk.end).range())),
                    ));
                    break;
                };
                let after = if close + 1 == line.content_end {
                    None
                } else {
                    text[close + 1..].chars().next()
                };
                let before_close = text[..close].chars().next_back();
                if before_close.is_some_and(is_source_whitespace) || !outer(after) {
                    at += 1;
                    continue;
                }
                let name = &text[at + 1..close];
                let candidate = InlineTagDefinition {
                    name: name.to_owned(),
                    range: Span::new(at, close + 1),
                    name_range: Span::new(at + 1, close),
                    valid: valid_tag_name(name),
                };
                if !candidate.valid {
                    diagnostics.push(diagnostic(
                        "SIGIL_INVALID_TAG_NAME",
                        "Tag name contains forbidden content.",
                        Location::at(file_path, Some(candidate.name_range.range())),
                    ));
                }
                if unprotected < at {
                    eligible.push(Span::new(unprotected, candidate.range.start));
                }
                unprotected = close + 1;
                definitions.push(candidate);
                at = close + 1;
            }
            if unprotected < end {
                eligible.push(Span::new(unprotected, chunk.end));
            }
        }
    }
    InlineContent {
        links,
        definitions,
        eligible,
        diagnostics,
    }
}
