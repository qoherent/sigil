//! The structural parse of one `.sigil` source: components, sections, Facets as
//! prose runs, grouping Tags, fenced payloads, and Tag imports.
//! A port of `packages/core/src/parser.ts`.
//!
//! Offsets are UTF-8 byte offsets throughout. The model carries no ids: a node
//! is identified by its position, and `Facet::prose_range.start` and
//! `Group::header_range.start` are unique within a source.
use super::{
    diagnostics::{Location, diagnostic, order_diagnostics},
    inline::{InlineLink, InlineTagDefinition, scan_inline_content, scan_links, valid_tag_name},
    text::{Capture, PhysicalLine, SourceText},
    width::prose_width_diagnostics,
};
use crate::structure::{Diagnostic, Range, RelatedLocation, Severity};
use regex::Regex;
use std::sync::LazyLock;

/// A half-open byte range. Unlike `structure::Range` it is `Copy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }

    pub fn range(self) -> Range {
        Range {
            start: self.start,
            end: self.end,
        }
    }
}

pub const SECTION_ORDER: [&str; 7] = [
    "goal",
    "state",
    "logic",
    "constraints",
    "cases",
    "interface",
    "decisions",
];

#[derive(Debug, Clone)]
pub struct Payload {
    pub kind: Option<String>,
    pub indentation: String,
    pub fence_length: usize,
    pub range: Span,
    pub body_range: Span,
    pub opening_range: Span,
    pub closing_range: Option<Span>,
    pub valid: bool,
    pub complete: bool,
}

/// The grouping Tag a Facet sits under.
#[derive(Debug, Clone)]
pub struct GroupRef {
    pub name: String,
    pub header_start: usize,
}

#[derive(Debug, Clone)]
pub struct Facet {
    pub section: String,
    pub group: Option<GroupRef>,
    pub range: Span,
    pub prose_range: Span,
    pub payload: Option<Payload>,
    pub definitions: Vec<InlineTagDefinition>,
    pub links: Vec<InlineLink>,
    pub eligible: Vec<Span>,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone)]
pub struct Group {
    pub name: String,
    pub range: Span,
    pub name_range: Span,
    pub header_range: Span,
    pub body_range: Span,
    /// Indices into the enclosing section's `units`.
    pub units: Vec<usize>,
    /// Only recovered invalid nesting can populate this.
    pub groups: Vec<Group>,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone)]
pub struct Section {
    pub name: String,
    pub known: bool,
    pub range: Span,
    pub name_range: Span,
    pub header_range: Span,
    pub body_range: Span,
    pub units: Vec<Facet>,
    pub groups: Vec<Group>,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone)]
pub struct Component {
    pub name: String,
    pub range: Span,
    pub name_range: Span,
    pub header_range: Span,
    pub sections: Vec<Section>,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone)]
pub struct ImportSelection {
    pub name: String,
    pub range: Span,
    pub valid: bool,
}

#[derive(Debug, Clone)]
pub struct Import {
    pub path: String,
    pub path_range: Span,
    pub provider: String,
    pub provider_range: Span,
    pub selections: Vec<ImportSelection>,
    pub range: Span,
    pub valid: bool,
    pub complete: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidRegionKind {
    Structure,
    DetachedPayload,
}

#[derive(Debug, Clone)]
pub struct InvalidRegion {
    pub kind: InvalidRegionKind,
    pub range: Span,
    pub payload: Option<Payload>,
}

#[derive(Debug, Clone)]
pub struct Document {
    pub file_path: String,
    pub source: Option<SourceText>,
    pub valid: bool,
    pub complete: bool,
    pub imports: Vec<Import>,
    pub components: Vec<Component>,
    pub invalid_regions: Vec<InvalidRegion>,
    pub diagnostics: Vec<Diagnostic>,
}

/// The index of the physical line holding `offset`, as `locationAtByte` finds it.
pub fn line_index_at(source: &SourceText, offset: usize) -> Option<usize> {
    if offset > source.text.len() || !source.text.is_char_boundary(offset) {
        return None;
    }
    let index = source
        .lines
        .partition_point(|l| l.start <= offset)
        .saturating_sub(1);
    (offset <= source.lines[index].content_end).then_some(index)
}

fn trim(text: &str) -> &str {
    text.trim_matches([' ', '\t'])
}

const BOM: &str = "\u{feff}";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Component,
    Section,
    Group,
}

#[derive(Clone, Copy, Debug)]
struct Frame {
    kind: Kind,
    idx: usize,
    suppress_unclosed: bool,
}

struct ComponentDraft {
    name: String,
    range: Span,
    name_range: Span,
    header_range: Span,
    sections: Vec<usize>,
    valid: bool,
    complete: bool,
}

struct SectionDraft {
    name: String,
    known: bool,
    range: Span,
    name_range: Span,
    header_range: Span,
    body_range: Span,
    units: Vec<usize>,
    groups: Vec<usize>,
    valid: bool,
    complete: bool,
}

struct GroupDraft {
    name: String,
    range: Span,
    name_range: Span,
    header_range: Span,
    body_range: Span,
    units: Vec<usize>,
    groups: Vec<usize>,
    valid: bool,
    complete: bool,
}

static COMPONENT_OPEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^component[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*\{[ \t]*$").unwrap()
});
static IMPORT_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^@([^\n\r\u{2028}\u{2029}]+?)[ \t]+from[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]+import[ \t]*\{",
    )
    .unwrap()
});
static BOUNDARY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:component[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]*\{[ \t]*$|@[^\n\r\u{2028}\u{2029}]+[ \t]+from[ \t]+[A-Za-z][A-Za-z0-9_]*[ \t]+import[ \t]*\{)",
    )
    .unwrap()
});
static FENCE_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^([ \t]*)(`{3,})(.*)$").unwrap());
static FENCE_CLOSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[ \t]*(`{3,})[ \t]*$").unwrap());
static NOTATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9_+.-]*$").unwrap());

/// Parse one captured source. A source without valid text yields an empty,
/// incomplete document that carries the capture diagnostics.
pub fn parse_document(file_path: &str, capture: &Capture) -> Document {
    let mut parser = Parser {
        file: file_path,
        diagnostics: capture.diagnostics.clone(),
        imports: Vec::new(),
        comps: Vec::new(),
        secs: Vec::new(),
        groups: Vec::new(),
        facets: Vec::new(),
        invalid: Vec::new(),
        complete: capture.source.is_some(),
        stack: Vec::new(),
        paragraph: Vec::new(),
        last_facet: None,
        after_blank: false,
        index: 0,
    };
    if let Some(source) = &capture.source {
        parser.run(source);
    }
    parser.finish(capture.source.as_ref())
}

struct Parser<'a> {
    file: &'a str,
    diagnostics: Vec<Diagnostic>,
    imports: Vec<Import>,
    comps: Vec<ComponentDraft>,
    secs: Vec<SectionDraft>,
    groups: Vec<GroupDraft>,
    facets: Vec<Option<Facet>>,
    invalid: Vec<InvalidRegion>,
    complete: bool,
    stack: Vec<Frame>,
    /// Physical line indices of the open prose run.
    paragraph: Vec<usize>,
    /// The latest Facet, its parent frame, and whether a payload is attached.
    last_facet: Option<(Kind, usize, bool, Span)>,
    after_blank: bool,
    index: usize,
}

impl Parser<'_> {
    fn error(&mut self, code: &str, message: &str, range: Span, related: &[Span]) {
        self.diagnostics.push(diagnostic(
            code,
            message,
            Location {
                file_path: Some(self.file.to_owned()),
                range: Some(range.range()),
                related: related
                    .iter()
                    .map(|r| RelatedLocation {
                        file_path: Some(self.file.to_owned()),
                        range: Some(r.range()),
                        implementation_range: None,
                        source_digest: None,
                        message: None,
                    })
                    .collect(),
            },
        ));
    }

    fn node_flags(&mut self, frame: Frame) -> (&mut bool, &mut bool) {
        match frame.kind {
            Kind::Component => {
                let n = &mut self.comps[frame.idx];
                (&mut n.valid, &mut n.complete)
            }
            Kind::Section => {
                let n = &mut self.secs[frame.idx];
                (&mut n.valid, &mut n.complete)
            }
            Kind::Group => {
                let n = &mut self.groups[frame.idx];
                (&mut n.valid, &mut n.complete)
            }
        }
    }

    fn mark_incomplete(&mut self, suppress: bool) {
        self.complete = false;
        for i in 0..self.stack.len() {
            let frame = self.stack[i];
            let (valid, complete) = self.node_flags(frame);
            *complete = false;
            *valid = false;
            self.stack[i].suppress_unclosed |= suppress;
        }
    }

    fn name_range(source: &SourceText, line: &PhysicalLine, name: &str, from: usize) -> Span {
        let content = &source.text[line.start..line.content_end];
        let at = content[from..].find(name).map_or(0, |i| i + from);
        Span::new(line.start + at, line.start + at + name.len())
    }

    fn raw_line<'s>(source: &'s SourceText, line: &PhysicalLine) -> &'s str {
        let content = &source.text[line.start..line.content_end];
        if line.number == 1 {
            content.strip_prefix(BOM).unwrap_or(content)
        } else {
            content
        }
    }

    fn flush(&mut self, source: &SourceText, payload: Option<Payload>) {
        if self.paragraph.is_empty() {
            return;
        }
        let parent = *self.stack.last().expect("prose has a container");
        let sec = self
            .stack
            .iter()
            .find(|f| f.kind == Kind::Section)
            .expect("prose has a contract")
            .idx;
        let first = &source.lines[self.paragraph[0]];
        let last = &source.lines[*self.paragraph.last().unwrap()];
        let prose_range = Span::new(first.start, last.end);
        let inline = scan_inline_content(self.file, source, prose_range);
        let inline_clean = inline.diagnostics.is_empty();
        self.diagnostics.extend(inline.diagnostics);
        let group = (parent.kind == Kind::Group).then_some(parent.idx);
        let group_valid = group.is_none_or(|g| self.groups[g].valid);
        let facet = Facet {
            section: self.secs[sec].name.clone(),
            group: group.map(|g| GroupRef {
                name: self.groups[g].name.clone(),
                header_start: self.groups[g].header_range.start,
            }),
            range: Span::new(
                prose_range.start,
                payload.as_ref().map_or(prose_range.end, |p| p.range.end),
            ),
            prose_range,
            definitions: inline.definitions,
            links: inline.links,
            eligible: inline.eligible,
            valid: inline_clean && payload.as_ref().is_none_or(|p| p.valid) && group_valid,
            complete: payload.as_ref().is_none_or(|p| p.complete),
            payload,
        };
        let has_payload = facet.payload.is_some();
        self.facets.push(Some(facet));
        let global = self.facets.len() - 1;
        let local = self.secs[sec].units.len();
        self.secs[sec].units.push(global);
        for frame in &self.stack {
            if frame.kind == Kind::Group {
                self.groups[frame.idx].units.push(local);
            }
        }
        self.last_facet = Some((parent.kind, parent.idx, has_payload, prose_range));
        self.paragraph.clear();
    }

    fn close(&mut self, end: usize, body_end: usize, closed: bool, suppress: bool, len: usize) {
        let frame = self.stack.pop().expect("a frame to close");
        let point = Span::new(len, len);
        let header_range = match frame.kind {
            Kind::Component => {
                let n = &mut self.comps[frame.idx];
                n.range.end = end;
                n.header_range
            }
            Kind::Section => {
                let n = &mut self.secs[frame.idx];
                n.range.end = end;
                n.body_range.end = body_end;
                n.header_range
            }
            Kind::Group => {
                let n = &mut self.groups[frame.idx];
                n.range.end = end;
                n.body_range.end = body_end;
                n.header_range
            }
        };
        if !closed {
            let (valid, complete) = self.node_flags(frame);
            *complete = false;
            *valid = false;
            self.complete = false;
            if !suppress {
                let what = match frame.kind {
                    Kind::Component => "component",
                    Kind::Section => "section",
                    Kind::Group => "group",
                };
                self.error(
                    "SIGIL_UNCLOSED_BLOCK",
                    &format!("Unclosed {what} block."),
                    header_range,
                    &[point],
                );
            }
        }
        if frame.kind == Kind::Group {
            let n = &mut self.groups[frame.idx];
            if n.complete && n.units.is_empty() {
                n.valid = false;
                self.error(
                    "SIGIL_EMPTY_TAG_GROUP",
                    "A grouping Tag must contain a Facet.",
                    header_range,
                    &[],
                );
            }
        }
        if frame.kind == Kind::Component {
            self.close_component(frame.idx, end);
        }
        self.after_blank = false;
    }

    fn close_component(&mut self, comp: usize, end: usize) {
        let sections = self.comps[comp].sections.clone();
        if self.comps[comp].complete {
            for required in ["goal", "interface"] {
                let named: Vec<usize> = sections
                    .iter()
                    .copied()
                    .filter(|s| self.secs[*s].name == required && self.secs[*s].known)
                    .collect();
                if named.is_empty()
                    || named
                        .iter()
                        .all(|s| self.secs[*s].complete && self.secs[*s].units.is_empty())
                {
                    let at = named
                        .first()
                        .map_or(self.comps[comp].name_range, |s| self.secs[*s].header_range);
                    self.error(
                        if required == "goal" {
                            "SIGIL_MISSING_GOAL"
                        } else {
                            "SIGIL_MISSING_INTERFACE"
                        },
                        &format!("A nonempty {required} section is required."),
                        at,
                        &[],
                    );
                }
            }
        }
        for name in SECTION_ORDER {
            let repeated: Vec<usize> = sections
                .iter()
                .copied()
                .filter(|s| self.secs[*s].name == name && self.secs[*s].known)
                .collect();
            if repeated.len() > 1 {
                let others: Vec<Span> = repeated[1..]
                    .iter()
                    .map(|s| self.secs[*s].name_range)
                    .collect();
                self.error(
                    "SIGIL_DUPLICATE_SECTION",
                    &format!("Section {name} occurs more than once."),
                    self.secs[repeated[0]].name_range,
                    &others,
                );
                for s in repeated {
                    self.secs[s].valid = false;
                }
            }
        }
        let mut previous_order = None;
        let mut previous_section: Option<usize> = None;
        let mut violation = None;
        for &s in &sections {
            if !self.secs[s].known {
                continue;
            }
            let current = SECTION_ORDER
                .iter()
                .position(|n| *n == self.secs[s].name)
                .expect("known section");
            if previous_order.is_some_and(|p| current < p) {
                violation = Some(s);
                break;
            }
            previous_order = Some(current);
            previous_section = Some(s);
        }
        if let Some(s) = violation {
            let related: Vec<Span> = previous_section
                .map(|p| self.secs[p].name_range)
                .into_iter()
                .collect();
            self.error(
                "SIGIL_SECTION_ORDER",
                &format!(
                    "Sections must appear in the order {}.",
                    SECTION_ORDER.join(", ")
                ),
                self.secs[s].name_range,
                &related,
            );
        }
        let start = self.comps[comp].range.start;
        if self.diagnostics.iter().any(|d| {
            d.range
                .as_ref()
                .is_some_and(|r| r.start >= start && r.start < end)
                && matches!(d.severity, Severity::Error)
        }) {
            self.comps[comp].valid = false;
        }
    }

    fn read_payload(&mut self, source: &SourceText) -> Payload {
        let lines = &source.lines;
        let opening = &lines[self.index];
        let opening_content = &source.text[opening.start..opening.content_end];
        let caps = FENCE_OPEN.captures(opening_content).expect("a fence line");
        let indentation = caps[1].to_owned();
        let fence_length = caps[2].len();
        let kind = Some(trim(&caps[3]).to_owned()).filter(|t| !t.is_empty());
        let mut valid = kind.as_deref().is_none_or(|t| NOTATION.is_match(t));
        if !valid {
            let t = kind.as_deref().unwrap();
            let range = Self::name_range(source, opening, t, 0);
            self.error(
                "SIGIL_INVALID_LITERAL_TYPE",
                "Fence type must be one valid notation label.",
                range,
                &[],
            );
        }
        let mut last = self.index + 1;
        while last < lines.len() {
            let content = &source.text[lines[last].start..lines[last].content_end];
            if let Some(closer) = FENCE_CLOSE.captures(content)
                && closer[1].len() >= fence_length
            {
                break;
            }
            last += 1;
        }
        let closing = lines.get(last);
        let body_range = Span::new(opening.end, closing.map_or(source.text.len(), |c| c.start));
        let opening_range = Span::new(opening.start, opening.end);
        let opening_has_ending = opening.end != opening.content_end;
        if closing.is_none() || !opening_has_ending {
            valid = false;
            let point = Span::new(source.text.len(), source.text.len());
            self.error(
                "SIGIL_UNCLOSED_LITERAL_BLOCK",
                "Fenced payload has no qualifying closer.",
                opening_range,
                &[point],
            );
            self.mark_incomplete(true);
        }
        self.index = if closing.is_some() {
            last + 1
        } else {
            lines.len()
        };
        Payload {
            kind,
            indentation,
            fence_length,
            range: Span::new(opening.start, closing.map_or(source.text.len(), |c| c.end)),
            body_range,
            opening_range,
            closing_range: closing.map(|c| Span::new(c.start, c.end)),
            valid,
            complete: closing.is_some(),
        }
    }

    fn link_protects_header(&self, source: &SourceText, line_index: usize) -> bool {
        let line = &source.lines[line_index];
        let content = &source.text[line.start..line.content_end];
        if !content.contains('[') {
            return false;
        }
        // The candidate line can contain a link opener, but later structural lines
        // delimit prose before inline recognition (lexical.region). Do not complete
        // an earlier paragraph's unfinished link across this attempted header.
        let mut end = line_index + 1;
        while end < source.lines.len() {
            let content = trim(Self::raw_line(source, &source.lines[end]));
            if content.is_empty()
                || content == "}"
                || content.starts_with("```")
                || content.ends_with('{')
            {
                break;
            }
            end += 1;
        }
        let brace = line.start + content.rfind('{').unwrap_or(0);
        scan_links(source, Span::new(line.start, source.lines[end - 1].end))
            .iter()
            .any(|link| link.range.start <= brace && brace < link.range.end)
    }

    fn run(&mut self, source: &SourceText) {
        let lines = &source.lines;
        let len = source.text.len();
        while self.index < lines.len() {
            let line = &lines[self.index];
            let content = trim(Self::raw_line(source, line));
            let frame = self.stack.last().copied();
            if content.is_empty() {
                self.flush(source, None);
                self.after_blank = true;
                self.index += 1;
                continue;
            }
            if frame.is_some_and(|f| f.kind != Kind::Component) && content.starts_with("```") {
                let frame = frame.unwrap();
                let attached = !self.paragraph.is_empty();
                let detached_from = (!attached && self.after_blank)
                    .then_some(self.last_facet)
                    .flatten()
                    .filter(|(kind, idx, has_payload, _)| {
                        *kind == frame.kind && *idx == frame.idx && !has_payload
                    });
                let line_span = Span::new(line.start, line.end);
                if !attached {
                    let related: Vec<Span> = detached_from.map(|f| f.3).into_iter().collect();
                    self.error(
                        if detached_from.is_some() {
                            "SIGIL_DETACHED_LITERAL_BLOCK"
                        } else {
                            "SIGIL_LITERAL_WITHOUT_INTRODUCTION"
                        },
                        "A payload needs immediately preceding prose in the same container.",
                        line_span,
                        &related,
                    );
                }
                let payload = self.read_payload(source);
                if attached {
                    self.flush(source, Some(payload));
                } else {
                    self.invalid.push(InvalidRegion {
                        kind: InvalidRegionKind::DetachedPayload,
                        range: payload.range,
                        payload: Some(payload),
                    });
                }
                self.after_blank = false;
                continue;
            }
            if content == "}" {
                self.flush(source, None);
                if frame.is_some() {
                    self.close(line.end, line.start, true, false, len);
                } else {
                    let range = Span::new(line.start, line.end);
                    self.error(
                        "SIGIL_PARSE_STRUCTURE",
                        "Unmatched closing brace.",
                        range,
                        &[],
                    );
                    self.invalid.push(InvalidRegion {
                        kind: InvalidRegionKind::Structure,
                        range,
                        payload: None,
                    });
                }
                self.index += 1;
                continue;
            }
            if frame.is_some_and(|f| f.kind != Kind::Component)
                && content.ends_with('{')
                && self.link_protects_header(source, self.index)
            {
                self.paragraph.push(self.index);
                self.after_blank = false;
                self.index += 1;
                continue;
            }
            if frame.is_none()
                && let Some(open) = COMPONENT_OPEN.captures(content)
            {
                self.flush(source, None);
                let range = Span::new(line.start, line.end);
                let name = open[1].to_owned();
                let from = source.text[line.start..line.content_end]
                    .find("component")
                    .unwrap_or(0)
                    + 9;
                let draft = ComponentDraft {
                    name_range: Self::name_range(source, line, &name, from),
                    name,
                    range,
                    header_range: range,
                    sections: Vec::new(),
                    valid: true,
                    complete: true,
                };
                self.comps.push(draft);
                self.stack.push(Frame {
                    kind: Kind::Component,
                    idx: self.comps.len() - 1,
                    suppress_unclosed: false,
                });
                self.index += 1;
                self.after_blank = false;
                continue;
            }
            if frame.is_none() && content.starts_with('@') && self.try_import(source) {
                continue;
            }
            let header = content
                .strip_suffix('{')
                .map(trim)
                .filter(|h| !h.is_empty());
            if let (Some(frame), Some(header)) = (frame, header) {
                self.flush(source, None);
                self.header(source, frame, header);
                self.after_blank = false;
                continue;
            }
            if frame.is_some_and(|f| f.kind != Kind::Component) && content != "{" {
                self.paragraph.push(self.index);
                self.after_blank = false;
                self.index += 1;
                continue;
            }
            self.flush(source, None);
            let range = Span::new(line.start, line.end);
            self.error(
                "SIGIL_PARSE_STRUCTURE",
                "Text does not fit this structural context.",
                range,
                &[],
            );
            self.invalid.push(InvalidRegion {
                kind: InvalidRegionKind::Structure,
                range,
                payload: None,
            });
            self.index += 1;
        }
        self.flush(source, None);
        while let Some(frame) = self.stack.last().copied() {
            self.close(len, len, false, frame.suppress_unclosed, len);
        }
    }

    /// A section opens inside a component and a grouping Tag inside a section.
    fn header(&mut self, source: &SourceText, frame: Frame, name: &str) {
        let line = &source.lines[self.index];
        let range = Span::new(line.start, line.end);
        let name_range = Self::name_range(source, line, name, 0);
        if frame.kind == Kind::Component {
            let known = SECTION_ORDER.contains(&name);
            self.secs.push(SectionDraft {
                name: name.to_owned(),
                known,
                range,
                name_range,
                header_range: range,
                body_range: Span::new(line.end, line.end),
                units: Vec::new(),
                groups: Vec::new(),
                valid: known,
                complete: true,
            });
            let sec = self.secs.len() - 1;
            self.comps[frame.idx].sections.push(sec);
            if known {
                self.stack.push(Frame {
                    kind: Kind::Section,
                    idx: sec,
                    suppress_unclosed: false,
                });
                self.index += 1;
            } else {
                self.error(
                    "SIGIL_UNKNOWN_SECTION",
                    &format!("Unknown contract \"{name}\"."),
                    name_range,
                    &[],
                );
                self.skip_unknown(source, sec, line);
            }
        } else {
            let valid = valid_tag_name(name) && frame.kind != Kind::Group;
            self.groups.push(GroupDraft {
                name: name.to_owned(),
                range,
                name_range,
                header_range: range,
                body_range: Span::new(line.end, line.end),
                units: Vec::new(),
                groups: Vec::new(),
                valid,
                complete: true,
            });
            let group = self.groups.len() - 1;
            match frame.kind {
                Kind::Section => self.secs[frame.idx].groups.push(group),
                _ => self.groups[frame.idx].groups.push(group),
            }
            if !valid_tag_name(name) {
                self.error(
                    "SIGIL_INVALID_TAG_NAME",
                    "Invalid grouping Tag name.",
                    name_range,
                    &[],
                );
            } else if frame.kind == Kind::Group {
                let parent = self.groups[frame.idx].header_range;
                self.error(
                    "SIGIL_NESTED_TAG_GROUP",
                    "Grouping Tags cannot nest.",
                    range,
                    &[parent],
                );
            }
            self.stack.push(Frame {
                kind: Kind::Group,
                idx: group,
                suppress_unclosed: false,
            });
            self.index += 1;
        }
    }

    /// An unknown section's balanced body is skipped, fenced payloads included.
    fn skip_unknown(&mut self, source: &SourceText, sec: usize, header: &PhysicalLine) {
        let lines = &source.lines;
        let len = source.text.len();
        let mut depth = 1;
        self.index += 1;
        while self.index < lines.len() && depth > 0 {
            let l = &lines[self.index];
            let skipped = trim(&source.text[l.start..l.content_end]);
            if skipped.starts_with("```") {
                let payload = self.read_payload(source);
                if !payload.complete {
                    self.secs[sec].complete = false;
                }
                continue;
            }
            if skipped == "}" {
                depth -= 1;
            } else if skipped.ends_with('{') {
                depth += 1;
            }
            if depth == 0 {
                self.secs[sec].body_range = Span::new(header.end, l.start);
                self.secs[sec].range = Span::new(header.start, l.end);
            }
            self.index += 1;
        }
        if depth > 0 {
            if self.secs[sec].complete {
                let at = self.secs[sec].header_range;
                self.error(
                    "SIGIL_UNCLOSED_BLOCK",
                    "Unclosed unknown contract.",
                    at,
                    &[Span::new(len, len)],
                );
            }
            self.secs[sec].complete = false;
            self.secs[sec].body_range = Span::new(header.end, len);
            self.secs[sec].range = Span::new(header.start, len);
            self.mark_incomplete(false);
        }
    }

    /// Parse a Tag import starting at the current line. Returns false when the
    /// line is not an import prefix, so the caller falls through.
    fn try_import(&mut self, source: &SourceText) -> bool {
        let lines = &source.lines;
        let line = &lines[self.index];
        let content = trim(Self::raw_line(source, line));
        let Some(prefix) = IMPORT_PREFIX.captures(content) else {
            return false;
        };
        let (path, provider) = (prefix[1].to_owned(), prefix[2].to_owned());
        if path.chars().any(super::inline::is_source_whitespace)
            || path.contains(['*', ',', '{', '}'])
        {
            return false;
        }
        let whole = prefix.get(0).unwrap().as_str();
        let line_text = &source.text[line.start..line.content_end];
        let bom = if line.number == 1 && line_text.starts_with(BOM) {
            BOM.len()
        } else {
            0
        };
        let prefix_at = line.start + bom + Self::raw_line(source, line).find('@').unwrap_or(0);
        let body_start = prefix_at + whole.len();
        let mut last = self.index;
        let mut close_at: Option<usize> = None;
        while last < lines.len() {
            let l = &lines[last];
            let l_text = &source.text[l.start..l.content_end];
            if last > self.index && BOUNDARY.is_match(trim(l_text)) {
                break;
            }
            let from = if last == self.index {
                body_start - l.start
            } else {
                0
            };
            if let Some(i) = l_text[from..].find('}') {
                close_at = Some(l.start + from + i);
                break;
            }
            last += 1;
        }
        let end = match close_at {
            None => lines.get(last).map_or(source.text.len(), |l| l.start),
            Some(_) => lines[last].end,
        };
        let body_end = close_at.unwrap_or(end);
        let body = &source.text[body_start..body_end];
        let parts: Vec<&str> = body.split(',').collect();
        let mut cursor = body_start;
        let mut valid = close_at.is_some();
        let mut selections = Vec::new();
        for (i, part) in parts.iter().enumerate() {
            let is_ws = |c: char| matches!(c, ' ' | '\t' | '\r' | '\n');
            let leading = part.len() - part.trim_start_matches(is_ws).len();
            let name = part.trim_matches(is_ws);
            if name.is_empty() && i == parts.len() - 1 && i > 0 {
                break;
            }
            let selection_valid = valid_tag_name(name);
            valid &= selection_valid;
            selections.push(ImportSelection {
                name: name.to_owned(),
                range: Span::new(cursor + leading, cursor + leading + name.len()),
                valid: selection_valid,
            });
            cursor += part.len() + 1;
        }
        if let Some(close) = close_at
            && !trim(&source.text[close + 1..lines[last].content_end]).is_empty()
        {
            valid = false;
        }
        let range = Span::new(line.start, end);
        if !valid {
            self.error(
                "SIGIL_PARSE_STRUCTURE",
                "Malformed or incomplete Tag import selection list.",
                range,
                &[],
            );
        }
        let keyword = whole.rfind("import").expect("an import keyword");
        let before = &whole[..keyword];
        let provider_end = prefix_at + before.trim_end_matches([' ', '\t']).len();
        self.imports.push(Import {
            path_range: Self::name_range(source, line, &path, 0),
            path,
            provider_range: Span::new(provider_end - provider.len(), provider_end),
            provider,
            selections,
            range,
            valid,
            complete: close_at.is_some(),
        });
        if close_at.is_none() {
            self.complete = false;
        }
        self.index = if close_at.is_none() { last } else { last + 1 };
        true
    }

    fn finish(mut self, source: Option<&SourceText>) -> Document {
        if let Some(source) = source {
            let facets: Vec<&Facet> = self
                .comps
                .iter()
                .flat_map(|c| &c.sections)
                .flat_map(|s| &self.secs[*s].units)
                .map(|f| self.facets[*f].as_ref().expect("unassembled facet"))
                .collect();
            let width = prose_width_diagnostics(self.file, source, &facets, &[]);
            self.diagnostics.extend(width);
        }
        let diagnostics = order_diagnostics(std::mem::take(&mut self.diagnostics));
        let valid = !diagnostics
            .iter()
            .any(|d| matches!(d.severity, Severity::Error));
        let components = self.assemble();
        Document {
            file_path: self.file.to_owned(),
            source: source.cloned(),
            valid,
            complete: self.complete,
            imports: self.imports,
            components,
            invalid_regions: self.invalid,
            diagnostics,
        }
    }

    fn assemble(&mut self) -> Vec<Component> {
        let comps = std::mem::take(&mut self.comps);
        comps
            .into_iter()
            .map(|c| Component {
                sections: c
                    .sections
                    .iter()
                    .map(|s| self.assemble_section(*s))
                    .collect(),
                name: c.name,
                range: c.range,
                name_range: c.name_range,
                header_range: c.header_range,
                valid: c.valid,
                complete: c.complete,
            })
            .collect()
    }

    fn assemble_section(&mut self, idx: usize) -> Section {
        let s = &self.secs[idx];
        let (units, groups) = (s.units.clone(), s.groups.clone());
        Section {
            name: s.name.clone(),
            known: s.known,
            range: s.range,
            name_range: s.name_range,
            header_range: s.header_range,
            body_range: s.body_range,
            valid: s.valid,
            complete: s.complete,
            units: units
                .into_iter()
                .map(|f| self.facets[f].take().expect("facet assembled once"))
                .collect(),
            groups: groups.into_iter().map(|g| self.assemble_group(g)).collect(),
        }
    }

    fn assemble_group(&self, idx: usize) -> Group {
        let g = &self.groups[idx];
        Group {
            name: g.name.clone(),
            range: g.range,
            name_range: g.name_range,
            header_range: g.header_range,
            body_range: g.body_range,
            units: g.units.clone(),
            groups: g.groups.iter().map(|c| self.assemble_group(*c)).collect(),
            valid: g.valid,
            complete: g.complete,
        }
    }
}
