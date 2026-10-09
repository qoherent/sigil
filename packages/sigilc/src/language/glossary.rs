//! Workspace glossary (`.sigil/glossary.json`): strict validation and the
//! per-source context overlap check. Term recognition stays in TypeScript.
use super::{
    diagnostics::{Location, diagnostic},
    path::{glob_matches, normalize_path},
    text::capture_source,
};
use crate::structure::Diagnostic;
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Context {
    pub id: String,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Glossary {
    pub contexts: Vec<Context>,
}

pub struct GlossaryParse {
    pub glossary: Option<Glossary>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn parse_glossary(bytes: &[u8], file_path: &str) -> GlossaryParse {
    let captured = capture_source(file_path, bytes);
    let Some(source) = captured.source.filter(|_| captured.diagnostics.is_empty()) else {
        return GlossaryParse {
            glossary: None,
            diagnostics: captured
                .diagnostics
                .into_iter()
                .map(|d| {
                    diagnostic(
                        "SIGIL_GLOSSARY_PARSE",
                        d.message,
                        Location::at(file_path, d.range),
                    )
                })
                .collect(),
        };
    };
    let value: Value = match serde_json::from_str(&source.text) {
        Ok(value) => value,
        Err(error) => {
            return GlossaryParse {
                glossary: None,
                diagnostics: vec![diagnostic(
                    "SIGIL_GLOSSARY_PARSE",
                    format!("Unable to parse .sigil/glossary.json JSON: {error}"),
                    Location::at(file_path, None),
                )],
            };
        }
    };
    let mut messages = Vec::new();
    match value.as_object() {
        None => messages.push("Glossary must be a JSON object.".to_owned()),
        Some(object) => {
            reject_unknown(
                object,
                &["schemaVersion", "terms", "contexts"],
                "glossary",
                &mut messages,
            );
            if object.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
                messages.push("schemaVersion must equal 1.".into());
            }
            validate_terms(object.get("terms"), "terms", &mut messages);
            validate_contexts(object.get("contexts"), &mut messages);
        }
    }
    if !messages.is_empty() {
        return GlossaryParse {
            glossary: None,
            diagnostics: messages
                .into_iter()
                .map(|m| {
                    let code = if m.contains(" collides with ") {
                        "SIGIL_GLOSSARY_TERM_COLLISION"
                    } else {
                        "SIGIL_GLOSSARY_INVALID"
                    };
                    diagnostic(code, m, Location::at(file_path, None))
                })
                .collect(),
        };
    }
    let contexts = value["contexts"]
        .as_array()
        .expect("validated contexts")
        .iter()
        .map(|c| {
            let strings = |key: &str| -> Vec<String> {
                c[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            };
            Context {
                id: c["id"].as_str().unwrap_or_default().to_owned(),
                include: strings("include"),
                exclude: strings("exclude"),
            }
        })
        .collect();
    GlossaryParse {
        glossary: Some(Glossary { contexts }),
        diagnostics: Vec::new(),
    }
}

/// A source matching more than one bounded context is invalid.
pub fn context_overlap(glossary: &Glossary, file_path: &str) -> Option<Diagnostic> {
    let normalized = normalize_path(file_path);
    let normalized = normalized.strip_prefix("./").unwrap_or(&normalized);
    let matches: Vec<&str> = glossary
        .contexts
        .iter()
        .filter(|c| {
            c.include.iter().any(|p| glob_matches(p, normalized))
                && !c.exclude.iter().any(|p| glob_matches(p, normalized))
        })
        .map(|c| c.id.as_str())
        .collect();
    (matches.len() > 1).then(|| {
        diagnostic(
            "SIGIL_GLOSSARY_CONTEXT_OVERLAP",
            format!(
                "Sigil source {normalized} matches multiple glossary contexts: {}.",
                matches.join(", ")
            ),
            Location::at(file_path, None),
        )
    })
}

/// JavaScript's `String.prototype.trim` whitespace set, which differs from Rust's.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn is_trimmed(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && !s.starts_with(is_js_space) && !s.ends_with(is_js_space))
}

fn reject_unknown(
    object: &Map<String, Value>,
    allowed: &[&str],
    owner: &str,
    messages: &mut Vec<String>,
) {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            messages.push(format!("{owner} contains unknown key {key:?}."));
        }
    }
}

fn validate_terms(value: Option<&Value>, owner: &str, messages: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        messages.push(format!("{owner} must be an array."));
        return;
    };
    let mut spellings: HashMap<String, String> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let entry = format!("{owner}[{index}]");
        let Some(object) = item.as_object() else {
            messages.push(format!("{entry} must be an object."));
            continue;
        };
        reject_unknown(
            object,
            &["term", "definition", "aliases", "agentContext"],
            &entry,
            messages,
        );
        for field in ["term", "definition"] {
            if !object.get(field).is_some_and(is_trimmed) {
                messages.push(format!(
                    "{entry}.{field} must be a trimmed non-empty string."
                ));
            }
        }
        if let Some(aliases) = object.get("aliases")
            && !aliases.as_array().is_some_and(|a| a.iter().all(is_trimmed))
        {
            messages.push(format!(
                "{entry}.aliases must be an array of trimmed non-empty strings."
            ));
        }
        if object.get("agentContext").is_some_and(|v| !v.is_boolean()) {
            messages.push(format!("{entry}.agentContext must be a boolean."));
        }
        let mut entry_spellings: Vec<&str> = object
            .get("term")
            .and_then(Value::as_str)
            .into_iter()
            .collect();
        if object.get("term").is_some_and(Value::is_string) {
            entry_spellings.extend(
                object
                    .get("aliases")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str),
            );
        } else {
            entry_spellings.clear();
        }
        for spelling in entry_spellings {
            if !is_trimmed(&Value::String(spelling.to_owned())) {
                continue;
            }
            let normalized = spelling.to_lowercase();
            if let Some(previous) = spellings.get(&normalized) {
                messages.push(format!(
                    "{entry} spelling {spelling:?} collides with {previous:?} in the same scope."
                ));
            } else {
                spellings.insert(normalized, spelling.to_owned());
            }
        }
    }
}

fn validate_contexts(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(items) = value.and_then(Value::as_array) else {
        messages.push("contexts must be an array.".into());
        return;
    };
    let mut ids = std::collections::HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let owner = format!("contexts[{index}]");
        let Some(object) = item.as_object() else {
            messages.push(format!("{owner} must be an object."));
            continue;
        };
        reject_unknown(
            object,
            &["id", "include", "exclude", "terms"],
            &owner,
            messages,
        );
        let id_ok = |s: &str| {
            let mut chars = s.chars();
            chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        };
        match object.get("id").and_then(Value::as_str) {
            Some(id) if id_ok(id) => {
                if !ids.insert(id.to_lowercase()) {
                    messages
                        .push("Glossary context ids must be unique without regard to case.".into());
                }
            }
            _ => messages.push(format!("{owner}.id must match [A-Za-z][A-Za-z0-9_-]*.")),
        }
        validate_globs(
            object.get("include"),
            &format!("{owner}.include"),
            true,
            messages,
        );
        validate_globs(
            object.get("exclude"),
            &format!("{owner}.exclude"),
            false,
            messages,
        );
        validate_terms(object.get("terms"), &format!("{owner}.terms"), messages);
    }
}

fn validate_globs(value: Option<&Value>, owner: &str, non_empty: bool, messages: &mut Vec<String>) {
    let items = value.and_then(Value::as_array);
    if !items.is_some_and(|i| (!non_empty || !i.is_empty()) && i.iter().all(is_trimmed)) {
        messages.push(format!(
            "{owner} must be {} array of trimmed non-empty strings.",
            if non_empty { "a non-empty" } else { "an" }
        ));
        return;
    }
    let patterns: Vec<&str> = items
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let relative = |p: &str| {
        let b = p.as_bytes();
        !p.starts_with('/')
            && !(b.len() >= 3
                && b[0].is_ascii_alphabetic()
                && b[1] == b':'
                && (b[2] == b'/' || b[2] == b'\\'))
            && !p.contains('\\')
            && !p.split('/').any(|s| s == "..")
    };
    if !patterns.iter().all(|p| relative(p)) {
        messages.push(format!(
            "{owner} patterns must be workspace-relative POSIX globs."
        ));
    }
    let unique: std::collections::HashSet<&&str> = patterns.iter().collect();
    if unique.len() != patterns.len() {
        messages.push(format!("{owner} patterns must be unique."));
    }
}
