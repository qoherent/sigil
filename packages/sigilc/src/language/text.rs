//! Source capture: strict UTF-8, NUL rejection, and physical lines.
//!
//! Rust strings are UTF-8, so every offset here is already a byte offset and
//! the UTF-16 maps the TypeScript reader keeps are not needed.
use super::diagnostics::{Location, diagnostic};
use crate::structure::{Diagnostic, Range};

/// One physical line. Offsets are byte offsets into the source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhysicalLine {
    pub number: usize,
    pub start: usize,
    pub content_end: usize,
    pub end: usize,
}

#[derive(Debug, Clone)]
pub struct SourceText {
    pub text: String,
    pub lines: Vec<PhysicalLine>,
}

/// A captured source: its text when it is valid, plus any diagnostics.
#[derive(Debug, Clone)]
pub struct Capture {
    pub source: Option<SourceText>,
    pub diagnostics: Vec<Diagnostic>,
}

impl SourceText {
    pub fn new(text: String) -> Self {
        let bytes = text.as_bytes();
        let mut lines = Vec::new();
        let mut start = 0;
        let mut i = 0;
        let mut push = |lines: &mut Vec<PhysicalLine>, end: usize, ending: usize| {
            lines.push(PhysicalLine {
                number: lines.len() + 1,
                start,
                content_end: end,
                end: end + ending,
            });
            start = end + ending;
        };
        while i < bytes.len() {
            match bytes[i] {
                b'\r' => {
                    let ending = if bytes.get(i + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                    push(&mut lines, i, ending);
                    i += ending;
                }
                b'\n' => {
                    push(&mut lines, i, 1);
                    i += 1;
                }
                _ => i += 1,
            }
        }
        push(&mut lines, bytes.len(), 0);
        Self { text, lines }
    }

    pub fn slice(&self, range: &Range) -> Option<&str> {
        self.text.get(range.start..range.end)
    }
}

/// Capture a source from bytes. Invalid UTF-8 has no faithful text, so it yields
/// a diagnostic and no source; NUL characters are reported but the text stays.
pub fn capture_source(file_path: &str, bytes: &[u8]) -> Capture {
    if let Some(range) = invalid_utf8(bytes) {
        return Capture {
            source: None,
            diagnostics: vec![diagnostic(
                "SIGIL_INVALID_ENCODING",
                "Source is not valid UTF-8.",
                Location::at(file_path, Some(range)),
            )],
        };
    }
    let text = String::from_utf8(bytes.to_vec()).expect("validated UTF-8");
    let diagnostics = text
        .bytes()
        .enumerate()
        .filter(|(_, b)| *b == 0)
        .map(|(start, _)| {
            diagnostic(
                "SIGIL_INVALID_CHARACTER",
                "NUL is not a valid source character.",
                Location::at(
                    file_path,
                    Some(Range {
                        start,
                        end: start + 1,
                    }),
                ),
            )
        })
        .collect();
    Capture {
        source: Some(SourceText::new(text)),
        diagnostics,
    }
}

/// The first invalid UTF-8 sequence, with the extent the TypeScript reader
/// reports: it consumes the lead byte and every continuation byte it examines,
/// including the one that fails.
fn invalid_utf8(bytes: &[u8]) -> Option<Range> {
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        let lead = bytes[i];
        i += 1;
        if lead < 0x80 {
            continue;
        }
        let count = match lead {
            0xc2..=0xdf => 1,
            0xe0..=0xef => 2,
            0xf0..=0xf4 => 3,
            _ => return Some(Range { start, end: i }),
        };
        for j in 0..count {
            let Some(&continuation) = bytes.get(i) else {
                return Some(Range { start, end: i });
            };
            i += 1;
            let min = match (j, lead) {
                (0, 0xe0) => 0xa0,
                (0, 0xf0) => 0x90,
                _ => 0x80,
            };
            let max = match (j, lead) {
                (0, 0xed) => 0x9f,
                (0, 0xf4) => 0x8f,
                _ => 0xbf,
            };
            if continuation < min || continuation > max {
                return Some(Range { start, end: i });
            }
        }
    }
    None
}
