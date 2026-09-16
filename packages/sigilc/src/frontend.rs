//! Source-faithful Sigil 0.8 structural transport. Semantic interpretation is separate.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignInput {
    pub schema_version: u32,
    pub language_version: String,
    pub frontend_version: String,
    pub sources: Vec<Source>,
    pub context: Vec<Context>,
    pub diagnostics: Vec<Diagnostic>,
    pub imports: Vec<Import>,
    pub entities: Vec<Entity>,
    pub units: Vec<Unit>,
    pub groups: Vec<Group>,
    pub introductions: Vec<Introduction>,
    pub references: Vec<Reference>,
    pub links: Vec<Link>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub path: String,
    pub text: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub path: String,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    pub stage: Stage,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_range: Option<ImplementationRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_digest: Option<String>,
    pub related: Vec<RelatedLocation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelatedLocation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_range: Option<ImplementationRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Parsing,
    Structure,
    Workspace,
    Resolution,
    Interpretation,
    Host,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Import {
    pub id: String,
    pub source: String,
    pub target: Option<String>,
    pub path: String,
    pub provider: String,
    pub provider_id: Option<String>,
    pub range: Range,
    pub path_range: Range,
    pub provider_range: Range,
    pub status: ImportStatus,
    pub valid: bool,
    pub complete: bool,
    pub names: Vec<ImportedName>,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ImportStatus {
    Resolved,
    UnresolvedPath,
    UnresolvedProvider,
    Invalid,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedName {
    pub id: String,
    pub name: String,
    pub entity: Option<String>,
    pub range: Range,
    pub status: SelectionStatus,
    pub uses: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionStatus {
    Resolved,
    Unresolved,
    Duplicate,
    Ambiguous,
    Invalid,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entity {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: EntityType,
    pub label: String,
    pub source: String,
    pub owner: Option<String>,
    pub range: Range,
    pub name_range: Range,
    pub identity_resolved: bool,
    pub valid: bool,
    pub complete: bool,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum EntityType {
    Component,
    Tag,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Unit {
    pub id: String,
    pub source: String,
    pub owner: Option<String>,
    pub section: Section,
    pub range: Range,
    pub prose_range: Range,
    pub grouping: Option<String>,
    pub introductions: Vec<String>,
    pub references: Vec<String>,
    pub links: Vec<String>,
    pub payload: Option<Payload>,
    pub valid: bool,
    pub complete: bool,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Goal,
    Interface,
    State,
    Logic,
    Constraints,
    Decisions,
    Cases,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Payload {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub body: String,
    pub raw_body: String,
    pub source_lines: Vec<String>,
    pub range: Range,
    pub body_range: Range,
    pub opening_range: Range,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closing_range: Option<Range>,
    pub fence_length: usize,
    pub indentation: String,
    pub valid: bool,
    pub complete: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub source: String,
    pub owner: String,
    pub name: String,
    pub tag: Option<String>,
    pub section: Section,
    pub range: Range,
    pub name_range: Range,
    pub header_range: Range,
    pub body_range: Range,
    pub valid: bool,
    pub complete: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Introduction {
    pub id: String,
    pub kind: IntroductionKind,
    pub name: String,
    pub source: String,
    pub owner: String,
    pub tag: Option<String>,
    pub section: Section,
    pub facet: Option<String>,
    pub group: Option<String>,
    pub range: Range,
    pub name_range: Range,
    pub valid: bool,
    pub complete: bool,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IntroductionKind {
    Group,
    Inline,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub id: String,
    pub source: String,
    pub owner: String,
    pub facet: String,
    pub name: String,
    pub tag: Option<String>,
    pub status: ReferenceStatus,
    pub range: Range,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceStatus {
    Resolved,
    Ambiguous,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Link {
    pub id: String,
    pub source: String,
    pub owner: String,
    pub facet: String,
    pub raw: String,
    pub label: String,
    pub destination: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub image: bool,
    pub range: Range,
    pub destination_range: Range,
}
/// Half-open offsets into the original UTF-8 source bytes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub start: usize,
    pub end: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImplementationRange {
    pub start: Position,
    pub end: Position,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

impl DesignInput {
    // @sigil implements packages/sigilc/_module.sigil::SigilSemanticCompiler::FrontendBoundary interface
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let input: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        input.validate()?;
        Ok(input)
    }
    pub fn validate(&self) -> Result<(), String> {
        super::frontend_validation::validate(self)
    }
    /// Every structural relation is carried together through preparation and saturation.
    pub fn structural_records(&self, paths: &BTreeSet<String>) -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": self.schema_version, "languageVersion": self.language_version,
            "entities": self.entities.iter().filter(|e| paths.contains(&e.source)).collect::<Vec<_>>(),
            "units": self.units.iter().filter(|u| paths.contains(&u.source)).collect::<Vec<_>>(),
            "imports": self.imports.iter().filter(|i| paths.contains(&i.source)).collect::<Vec<_>>(),
            "groups": self.groups.iter().filter(|g| paths.contains(&g.source)).collect::<Vec<_>>(),
            "introductions": self.introductions.iter().filter(|i| paths.contains(&i.source)).collect::<Vec<_>>(),
            "references": self.references.iter().filter(|r| paths.contains(&r.source)).collect::<Vec<_>>(),
            "links": self.links.iter().filter(|l| paths.contains(&l.source)).collect::<Vec<_>>(),
        })
    }
}

pub fn normalized_path(path: &str) -> Result<(), String> {
    ensure(
        !path.is_empty()
            && !path.contains(['\\', ':', '\0'])
            && path.split('/').all(|p| !matches!(p, "" | "." | "..")),
        "expected normalized workspace-relative path",
    )
}
// Match encodeURIComponent for path-qualified structural IDs.
pub(crate) fn encode_identifier(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("writing to String");
        }
    }
    encoded
}
pub(crate) fn unique<'a>(
    items: impl Iterator<Item = &'a str>,
    name: &str,
) -> Result<BTreeSet<&'a str>, String> {
    let mut set = BTreeSet::new();
    for item in items {
        ensure(set.insert(item), &format!("duplicate {name}: {item}"))?;
    }
    Ok(set)
}
pub(crate) fn ensure(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.to_owned())
    }
}
