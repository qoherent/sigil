//! Workspace configuration (`.sigil/config.json`, `.sigil/local.json`).
//!
//! Validation mirrors `packages/core/src/config.ts` and the JSON schema in
//! `spec/sigil-config.schema.json`. Tool settings are checked for shape only;
//! the compiler never interprets them.
use super::{
    SIGIL_VERSION,
    diagnostics::{Location, diagnostic},
    path::glob_matches,
};
use crate::structure::Diagnostic;
use regex::Regex;
use serde_json::{Map, Value};

pub const DEFAULT_INCLUDES: &[&str] = &["**/*.sigil"];
pub const DEFAULT_EXCLUDES: &[&str] = &[
    ".git/**",
    ".deno/**",
    "node_modules/**",
    "build/**",
    "coverage/**",
];

#[derive(Debug, Clone)]
pub struct Config {
    pub members: Vec<String>,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

pub struct ConfigParse {
    pub config: Option<Config>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn parse_config(source: &str, file_path: &str) -> ConfigParse {
    let value: Value = match serde_json::from_str(source) {
        Ok(value) => value,
        Err(error) => {
            return ConfigParse {
                config: None,
                diagnostics: vec![diagnostic(
                    "SIGIL_CONFIG_PARSE",
                    format!("Unable to parse .sigil/config.json JSON: {error}"),
                    Location::at(file_path, None),
                )],
            };
        }
    };
    let mut messages = Vec::new();
    match value.as_object() {
        None => messages.push("Configuration must be a JSON object.".to_owned()),
        Some(object) => {
            reject_unknown(
                object,
                &["sigilVersion", "workspace", "files", "tools"],
                "configuration",
                &mut messages,
            );
            require_semver(object.get("sigilVersion"), &mut messages);
            validate_workspace(object.get("workspace"), &mut messages);
            validate_files(object.get("files"), &mut messages);
            validate_tools(object.get("tools"), &mut messages);
        }
    }
    if !messages.is_empty() {
        return ConfigParse {
            config: None,
            diagnostics: invalid(&messages, file_path),
        };
    }
    let object = value.as_object().expect("validated object");
    if object["sigilVersion"] != Value::String(SIGIL_VERSION.into()) {
        return ConfigParse {
            config: None,
            diagnostics: vec![diagnostic(
                "SIGIL_UNSUPPORTED_VERSION",
                format!(
                    "Unsupported sigilVersion {}; supported version is {SIGIL_VERSION}.",
                    object["sigilVersion"]
                ),
                Location::at(file_path, None),
            )],
        };
    }
    let strings = |value: Option<&Value>, default: &[&str]| -> Vec<String> {
        value.and_then(Value::as_array).map_or_else(
            || default.iter().map(|s| (*s).to_owned()).collect(),
            |items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            },
        )
    };
    let workspace = object["workspace"]
        .as_object()
        .expect("validated workspace");
    let files = object["files"].as_object().expect("validated files");
    ConfigParse {
        config: Some(Config {
            members: strings(workspace.get("members"), &[]),
            include: strings(files.get("include"), DEFAULT_INCLUDES),
            exclude: strings(files.get("exclude"), DEFAULT_EXCLUDES),
        }),
        diagnostics: Vec::new(),
    }
}

/// Local configuration may only carry tool settings; returns its diagnostics.
pub fn parse_local_config(source: &str, file_path: &str) -> Vec<Diagnostic> {
    let value: Value = match serde_json::from_str(source) {
        Ok(value) => value,
        Err(error) => {
            return vec![diagnostic(
                "SIGIL_CONFIG_PARSE",
                format!("Unable to parse {file_path} JSON: {error}"),
                Location::at(file_path, None),
            )];
        }
    };
    let Some(object) = value.as_object() else {
        return invalid(
            &["Local configuration must be a JSON object.".to_owned()],
            file_path,
        );
    };
    let mut messages = Vec::new();
    reject_unknown(object, &["tools"], "local configuration", &mut messages);
    validate_tools(object.get("tools"), &mut messages);
    invalid(&messages, file_path)
}

pub fn is_excluded(path: &str, config: &Config) -> bool {
    let normalized = normalize(path);
    config.exclude.iter().any(|p| glob_matches(p, &normalized))
}

pub fn matches_source_file(path: &str, config: &Config) -> bool {
    let normalized = normalize(path);
    config.include.iter().any(|p| glob_matches(p, &normalized)) && !is_excluded(&normalized, config)
}

/// Whether a parent workspace's exclusions cover the whole subtree at `path`.
pub fn excludes_subtree(path: &str, config: &Config) -> bool {
    let normalized = normalize(path);
    let normalized = normalized.trim_end_matches('/');
    is_excluded(&format!("{normalized}/__sigil_subtree__"), config)
}

fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    path.strip_prefix("./").unwrap_or(&path).to_owned()
}

fn validate_workspace(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(object) = value.and_then(Value::as_object) else {
        messages.push("workspace must be an object.".into());
        return;
    };
    reject_unknown(object, &["name", "members"], "workspace", messages);
    match object.get("name").and_then(Value::as_str) {
        Some(name) if !name.trim().is_empty() && name == name.trim() => {}
        _ => messages.push("workspace.name must be a trimmed non-empty string.".into()),
    }
    validate_members(object.get("members"), messages);
}

fn validate_members(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(value) = value else { return };
    let Some(items) = value.as_array().filter(|a| a.iter().all(Value::is_string)) else {
        messages.push("workspace.members must be an array of strings.".into());
        return;
    };
    let members: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
    if members.iter().any(|member| {
        member.is_empty()
            || *member != member.trim()
            || *member == "."
            || member.starts_with('/')
            || is_drive_path(member)
            || member.contains('\\')
            || member.starts_with("./")
            || member.ends_with('/')
            || member.contains("//")
            || member.split('/').any(|s| s == "." || s == "..")
    }) {
        messages.push(
            "workspace.members entries must be normalized, non-root, workspace-relative POSIX directory paths.".into(),
        );
    }
    let mut unique: Vec<&str> = members.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != members.len() {
        messages.push("workspace.members entries must be unique.".into());
    }
    for (index, parent) in unique.iter().enumerate() {
        if unique[index + 1..]
            .iter()
            .any(|other| other.starts_with(&format!("{parent}/")))
        {
            messages.push("workspace.members entries must not overlap.".into());
            return;
        }
    }
}

fn validate_files(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(object) = value.and_then(Value::as_object) else {
        messages.push("files must be an object.".into());
        return;
    };
    reject_unknown(object, &["include", "exclude"], "files", messages);
    validate_string_array(object.get("include"), "files.include", messages, true);
    if let Some(exclude) = object.get("exclude") {
        validate_string_array(Some(exclude), "files.exclude", messages, false);
    }
}

fn validate_tools(value: Option<&Value>, messages: &mut Vec<String>) {
    let Some(value) = value else { return };
    let Some(object) = value.as_object() else {
        messages.push("tools must be an object.".into());
        return;
    };
    for (name, settings) in object {
        if name.is_empty() || !settings.is_object() {
            let shown = if name.is_empty() { "<empty>" } else { name };
            messages.push(format!("tools.{shown} must be a JSON object."));
        }
    }
}

fn require_semver(value: Option<&Value>, messages: &mut Vec<String>) {
    let semver = Regex::new(
        r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$",
    )
    .expect("semver pattern");
    if !value
        .and_then(Value::as_str)
        .is_some_and(|s| semver.is_match(s))
    {
        messages.push("sigilVersion must be a semantic version string.".into());
    }
}

fn is_drive_path(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\')
}

fn validate_string_array(
    value: Option<&Value>,
    name: &str,
    messages: &mut Vec<String>,
    non_empty: bool,
) {
    let items = value.and_then(Value::as_array);
    let well_formed = items.is_some_and(|items| {
        (!non_empty || !items.is_empty())
            && items
                .iter()
                .all(|i| i.as_str().is_some_and(|s| !s.is_empty()))
    });
    if !well_formed {
        messages.push(format!(
            "{name} must be {} array of non-empty strings.",
            if non_empty { "a non-empty" } else { "an" }
        ));
    }
    if items.is_some_and(|items| {
        items.iter().filter_map(Value::as_str).any(|s| {
            s.starts_with('/')
                || is_drive_path(s)
                || s.contains('\\')
                || s.split('/').any(|p| p == "..")
        })
    }) {
        messages.push(format!(
            "{name} patterns must be workspace-relative POSIX globs."
        ));
    }
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

fn invalid(messages: &[String], file_path: &str) -> Vec<Diagnostic> {
    messages
        .iter()
        .map(|m| {
            diagnostic(
                "SIGIL_CONFIG_INVALID",
                m.clone(),
                Location::at(file_path, None),
            )
        })
        .collect()
}
