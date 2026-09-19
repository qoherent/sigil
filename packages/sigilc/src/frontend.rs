//! Structural Sigil-language transport; no AST, domain laws or model fields.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignInput {
    pub schema_version: u32,
    pub frontend_version: String,
    pub sources: Vec<Source>,
    pub context: Vec<Context>,
    pub diagnostics: Vec<Diagnostic>,
    pub imports: Vec<Import>,
    pub entities: Vec<Entity>,
    pub units: Vec<Unit>,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Import {
    pub source: String,
    pub target: Option<String>,
    pub names: Vec<ImportedName>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedName {
    pub name: String,
    pub entity: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entity {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: EntityType,
    pub label: String,
    pub source: String,
    pub owner: Option<String>,
    pub exported: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum EntityType {
    Component,
    Tag,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub id: String,
    pub source: String,
    pub owner: Option<String>,
    pub form: Form,
    pub section: Section,
    pub tag: Option<String>,
    pub range: Range,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Form {
    Component,
    Expand,
}

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
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
        ensure(
            self.schema_version == 1,
            "unsupported frontend schema version",
        )?;
        ensure(
            !self.frontend_version.is_empty(),
            "missing frontend version",
        )?;
        let sources = unique(self.sources.iter().map(|s| s.path.as_str()), "source path")?;
        for source in &self.sources {
            normalized_path(&source.path)?;
            ensure(
                source.path.ends_with(".sigil"),
                "Design source must end in .sigil",
            )?;
            ensure(
                !source.path.starts_with(".sigil/"),
                "generated Design source",
            )?;
        }
        let context = unique(self.context.iter().map(|c| c.path.as_str()), "context path")?;
        ensure(
            context
                == BTreeSet::from([
                    ".sigil/config.json",
                    ".sigil/glossary.json",
                    ".sigil/local.json",
                ]),
            "context must capture config, local config and glossary, including absence",
        )?;
        let entities = unique(
            self.entities.iter().map(|e| e.id.as_str()),
            "entity identity",
        )?;
        let components: BTreeSet<_> = self
            .entities
            .iter()
            .filter(|e| e.kind == EntityType::Component)
            .map(|e| e.id.as_str())
            .collect();
        for entity in &self.entities {
            ensure(
                sources.contains(entity.source.as_str()),
                "entity source is not selected",
            )?;
            ensure(!entity.label.trim().is_empty(), "empty entity label")?;
            ensure(
                entity.id.starts_with("urn:sigil:component:"),
                "noncanonical frontend identity",
            )?;
            match entity.kind {
                EntityType::Component => {
                    ensure(entity.owner.is_none(), "component has an owner")?;
                    ensure(
                        entity.id
                            == format!(
                                "urn:sigil:component:{}:{}",
                                encode_identifier(&entity.source),
                                encode_identifier(&entity.label)
                            ),
                        "component identity does not match its source and name",
                    )?;
                }
                EntityType::Tag => ensure(
                    entity
                        .owner
                        .as_deref()
                        .is_some_and(|o| components.contains(o)),
                    "Tag owner is not a component",
                )?,
            }
        }
        let units = unique(self.units.iter().map(|u| u.id.as_str()), "unit identity")?;
        ensure(
            units.is_disjoint(&entities),
            "unit identity collides with domain entity",
        )?;
        for unit in &self.units {
            ensure(
                sources.contains(unit.source.as_str()),
                "unit source is not selected",
            )?;
            ensure(
                unit.id.starts_with("urn:sigil:unit:"),
                "noncanonical unit identity",
            )?;
            ensure(
                unit.owner.as_deref().is_none_or(|o| components.contains(o)),
                "unit owner is not a component",
            )?;
            validate_range(&unit.range)?;
            ensure(
                unit.id
                    == format!(
                        "urn:sigil:unit:{}:{}:{}",
                        encode_identifier(&unit.source),
                        unit.range.start.line,
                        unit.range.start.column
                    ),
                "unit identity does not match its physical source range",
            )?;
        }
        for import in &self.imports {
            ensure(
                sources.contains(import.source.as_str()),
                "import source is not selected",
            )?;
            if let Some(target) = &import.target {
                normalized_path(target)?;
                ensure(
                    sources.contains(target.as_str()),
                    "import target is not selected",
                )?;
            }
            for name in &import.names {
                ensure(
                    name.entity
                        .as_deref()
                        .is_none_or(|id| components.contains(id)),
                    "import names an unknown component",
                )?;
            }
        }
        for diagnostic in &self.diagnostics {
            if let Some(path) = &diagnostic.file_path {
                normalized_path(path)?;
            }
            if let Some(range) = &diagnostic.range {
                validate_range(range)?;
            }
        }
        Ok(())
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

fn validate_range(range: &Range) -> Result<(), String> {
    ensure(
        range.start.line > 0
            && range.start.column > 0
            && range.end.column > 0
            && range.start <= range.end,
        "invalid source range",
    )
}

// Match the frontend's encodeURIComponent for path-qualified structural IDs.
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

fn unique<'a>(
    items: impl Iterator<Item = &'a str>,
    name: &str,
) -> Result<BTreeSet<&'a str>, String> {
    let mut set = BTreeSet::new();
    for item in items {
        ensure(set.insert(item), &format!("duplicate {name}: {item}"))?;
    }
    Ok(set)
}

fn ensure(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.to_owned())
    }
}
