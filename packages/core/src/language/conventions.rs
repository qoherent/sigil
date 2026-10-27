//! Workspace conventions (`.sigil/conventions/`): the declarative check rules.
//!
//! A conventions folder holds up to three optional parts. Only `check.json` is
//! read here; the write and judge parts belong to the skills. A rule names a
//! contract section, may narrow to named groups in it, and lists the labels
//! each matched group must carry as the start of one of its Facets. Nothing in
//! the file is executed.
use super::{
    diagnostics::{Location, diagnostic, order_diagnostics},
    parse::{Group, Section},
    resolve::ResolvedWorkspace,
    text::capture_source,
    untagged::untagged_facet_diagnostics,
    workspace::Workspace,
};
use crate::types::{Diagnostic, Severity};
use serde_json::{Map, Value};

pub const CONVENTIONS_CHECK_PATH: &str = ".sigil/conventions/check.json";

/// One required-label rule. Without `groups` it applies to every named group in
/// the section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckRule {
    pub section: String,
    pub groups: Option<Vec<String>>,
    pub require: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Conventions {
    pub file_path: String,
    pub rules: Vec<CheckRule>,
}

pub struct ConventionsParse {
    pub conventions: Option<Conventions>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Parse `check.json` strictly. A malformed file gives exactly one error
/// diagnostic and no rules.
pub fn parse_check(bytes: &[u8], file_path: &str) -> ConventionsParse {
    let fail = |message: String, range| ConventionsParse {
        conventions: None,
        diagnostics: vec![diagnostic(
            "SIGIL_CONVENTION_PARSE",
            message,
            Location::at(file_path, range),
        )],
    };
    let captured = capture_source(file_path, bytes);
    let Some(source) = captured.source else {
        let range = captured.diagnostics.first().and_then(|d| d.range.clone());
        return fail("Source is not valid UTF-8.".to_owned(), range);
    };
    let value: Value = match serde_json::from_str(&source.text) {
        Ok(value) => value,
        Err(error) => {
            return fail(format!("Unable to parse {file_path} JSON: {error}"), None);
        }
    };
    match rules_of(&value) {
        Ok(rules) => ConventionsParse {
            conventions: Some(Conventions {
                file_path: file_path.to_owned(),
                rules,
            }),
            diagnostics: Vec::new(),
        },
        Err(message) => fail(message, None),
    }
}

fn rules_of(value: &Value) -> Result<Vec<CheckRule>, String> {
    let root = value
        .as_object()
        .ok_or("Check rules must be a JSON object.")?;
    reject_unknown(root, &["rules"], "check rules")?;
    root.get("rules")
        .and_then(Value::as_array)
        .ok_or("rules must be an array.")?
        .iter()
        .enumerate()
        .map(|(i, rule)| rule_of(rule).map_err(|m| format!("rules[{i}]: {m}")))
        .collect()
}

fn rule_of(value: &Value) -> Result<CheckRule, String> {
    let rule = value.as_object().ok_or("must be an object.")?;
    reject_unknown(rule, &["section", "groups", "require"], "rule")?;
    let section = match rule.get("section").and_then(Value::as_str) {
        Some(section) if !section.is_empty() => section.to_owned(),
        _ => return Err("section must be a non-empty string.".to_owned()),
    };
    let groups = match rule.get("groups") {
        None => None,
        Some(groups) => Some(strings_of(groups, "groups", false)?),
    };
    let require = strings_of(
        rule.get("require")
            .ok_or("require must be a list of labels.")?,
        "require",
        true,
    )?;
    Ok(CheckRule {
        section,
        groups,
        require,
    })
}

/// A non-empty list of non-empty strings. A label also cannot start with
/// whitespace, since the prose it is matched against is read after leading
/// whitespace and such a label could never be satisfied.
fn strings_of(value: &Value, key: &str, label: bool) -> Result<Vec<String>, String> {
    let items = value
        .as_array()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| format!("{key} must be a non-empty array of strings."))?;
    items
        .iter()
        .map(|item| match item.as_str() {
            Some(text) if !text.is_empty() => {
                if label && text.starts_with(char::is_whitespace) {
                    Err(format!("{key} must not start with whitespace."))
                } else {
                    Ok(text.to_owned())
                }
            }
            _ => Err(format!("{key} must be a non-empty array of strings.")),
        })
        .collect()
}

fn reject_unknown(object: &Map<String, Value>, allowed: &[&str], what: &str) -> Result<(), String> {
    match object.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(key) => Err(format!("Unknown {what} key {key}.")),
        None => Ok(()),
    }
}

/// Every advisory warning for a resolved workspace: the untagged-Facet warnings
/// and the convention warnings, in canonical diagnostic order. `sigil check`
/// and the language server both ask for it so they cannot drift.
pub fn advisory_diagnostics(
    resolved: &ResolvedWorkspace,
    workspace: &Workspace,
) -> Vec<Diagnostic> {
    let mut diagnostics = untagged_facet_diagnostics(resolved);
    diagnostics.extend(convention_diagnostics(resolved, workspace));
    order_diagnostics(diagnostics)
}

/// Warn on each named group a rule matches that has no Facet starting with one
/// of the rule's required labels, once per missing label, on the group's
/// header. Ungrouped Facets are never matched, and a source whose recovery is
/// incomplete is skipped, as the check is absence-based. The result is in
/// canonical diagnostic order.
pub fn convention_diagnostics(
    resolved: &ResolvedWorkspace,
    workspace: &Workspace,
) -> Vec<Diagnostic> {
    let Some(conventions) = &workspace.conventions else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();
    for component in &resolved.components {
        let document = &resolved.documents[component.file];
        let Some(source) = document.source.as_ref().filter(|_| document.complete) else {
            continue;
        };
        let file_path = &resolved.paths[component.file];
        for rule in &conventions.rules {
            for section in &resolved.declaration(component).sections {
                if section.name != rule.section {
                    continue;
                }
                for group in &section.groups {
                    if rule
                        .groups
                        .as_ref()
                        .is_some_and(|g| !g.contains(&group.name))
                    {
                        continue;
                    }
                    for label in &rule.require {
                        if starts_a_facet(section, group, &source.text, label) {
                            continue;
                        }
                        let mut warning = diagnostic(
                            "SIGIL_CONVENTION_MISSING_LABEL",
                            format!(
                                "Group `{}` in `{}` has no Facet starting with `{label}`.",
                                group.name, section.name
                            ),
                            Location::at(file_path, Some(group.header_range.range())),
                        );
                        warning.severity = Severity::Warning;
                        diagnostics.push(warning);
                    }
                }
            }
        }
    }
    order_diagnostics(diagnostics)
}

/// Whether any Facet of the group has prose starting with `label`, after
/// leading whitespace.
fn starts_a_facet(section: &Section, group: &Group, text: &str, label: &str) -> bool {
    group.units.iter().any(|&unit| {
        let range = section.units[unit].prose_range;
        text.get(range.start..range.end)
            .is_some_and(|prose| prose.trim_start().starts_with(label))
    })
}
