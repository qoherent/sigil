//! Workspace discovery and loading from a root directory.
//!
//! Every path is workspace-relative and `/`-separated. Discovery matches the
//! TypeScript reader's explicit-root behavior: the configuration must sit
//! directly inside the root, and no ancestor is searched.
use super::{
    config::{self, Config, excludes_subtree, matches_source_file},
    diagnostics::{Location, diagnostic, order_diagnostics},
    glossary::{self, Glossary},
    path::normalize_path,
    text::{Capture, capture_source},
};
use crate::structure::Diagnostic;
use std::{
    fs,
    io::{self, ErrorKind},
    path::Path,
};

pub const CONFIG_PATH: &str = ".sigil/config.json";
pub const LOCAL_CONFIG_PATH: &str = ".sigil/local.json";
pub const GLOSSARY_PATH: &str = ".sigil/glossary.json";

/// A workspace input file with the text it carried, absent when not valid UTF-8.
#[derive(Debug, Clone)]
pub struct SourceFile {
    pub path: String,
    pub capture: Capture,
}

/// The three workspace context files, kept as read so absence is explicit.
#[derive(Debug, Clone)]
pub struct ContextFile {
    pub path: &'static str,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct Workspace {
    pub config: Option<Config>,
    pub sources: Vec<SourceFile>,
    pub context: Vec<ContextFile>,
    pub glossary: Option<Glossary>,
    pub diagnostics: Vec<Diagnostic>,
    /// False when any file the loader read was not valid UTF-8, so no faithful
    /// textual snapshot of the workspace exists.
    pub text_complete: bool,
}

impl Workspace {
    pub fn load(root: &Path) -> io::Result<Self> {
        let mut diagnostics = Vec::new();
        let mut text_complete = true;
        let mut context = vec![
            ContextFile {
                path: CONFIG_PATH,
                bytes: None,
            },
            ContextFile {
                path: GLOSSARY_PATH,
                bytes: None,
            },
            ContextFile {
                path: LOCAL_CONFIG_PATH,
                bytes: None,
            },
        ];
        let mut workspace = Self {
            config: None,
            sources: Vec::new(),
            context: Vec::new(),
            glossary: None,
            diagnostics: Vec::new(),
            text_complete: true,
        };
        let finish = |mut workspace: Self, context, diagnostics, text_complete| {
            workspace.context = context;
            workspace.diagnostics = order_diagnostics(diagnostics);
            workspace.text_complete = text_complete;
            workspace
        };

        let Some(config_bytes) = read_optional(root, CONFIG_PATH)? else {
            diagnostics.push(diagnostic(
                "SIGIL_CONFIG_NOT_FOUND",
                format!("Expected {CONFIG_PATH} directly inside workspace root."),
                Location::at(CONFIG_PATH, None),
            ));
            return Ok(finish(workspace, context, diagnostics, text_complete));
        };
        context[0].bytes = Some(config_bytes.clone());
        let config_capture = capture_source(CONFIG_PATH, &config_bytes);
        let Some(config_text) = config_capture
            .source
            .filter(|_| config_capture.diagnostics.is_empty())
        else {
            text_complete &= !config_capture
                .diagnostics
                .iter()
                .any(|d| d.code == "SIGIL_INVALID_ENCODING");
            diagnostics.extend(config_capture.diagnostics.into_iter().map(|d| {
                diagnostic(
                    "SIGIL_CONFIG_PARSE",
                    d.message,
                    Location::at(CONFIG_PATH, d.range),
                )
            }));
            return Ok(finish(workspace, context, diagnostics, text_complete));
        };
        let parsed = config::parse_config(&config_text.text, CONFIG_PATH);
        diagnostics.extend(parsed.diagnostics);
        let mut selected = parsed.config;

        if selected.is_some()
            && let Some(local_bytes) = read_optional(root, LOCAL_CONFIG_PATH)?
        {
            context[2].bytes = Some(local_bytes.clone());
            let capture = capture_source(LOCAL_CONFIG_PATH, &local_bytes);
            match capture.source.filter(|_| capture.diagnostics.is_empty()) {
                None => {
                    text_complete &= !capture
                        .diagnostics
                        .iter()
                        .any(|d| d.code == "SIGIL_INVALID_ENCODING");
                    diagnostics.extend(capture.diagnostics.into_iter().map(|d| {
                        diagnostic(
                            "SIGIL_CONFIG_PARSE",
                            d.message,
                            Location::at(LOCAL_CONFIG_PATH, d.range),
                        )
                    }));
                    selected = None;
                }
                Some(text) => {
                    let local = config::parse_local_config(&text.text, LOCAL_CONFIG_PATH);
                    if !local.is_empty() {
                        selected = None;
                    }
                    diagnostics.extend(local);
                }
            }
        }
        let Some(config) = selected else {
            return Ok(finish(workspace, context, diagnostics, text_complete));
        };

        let all_paths = list_files(root)?;
        let member_roots: Vec<String> = config.members.iter().map(|m| normalize_path(m)).collect();
        let suffix = format!("/{CONFIG_PATH}");
        let mut nested: Vec<String> = all_paths
            .iter()
            .filter(|p| {
                (p.as_str() == CONFIG_PATH || p.ends_with(&suffix)) && p.as_str() != CONFIG_PATH
            })
            .cloned()
            .collect();
        nested.sort();
        let nested_roots: Vec<String> = nested
            .iter()
            .map(|p| p[..p.len() - suffix.len()].to_owned())
            .collect();
        for (path, nested_root) in nested.iter().zip(&nested_roots) {
            if member_roots.contains(nested_root) {
                diagnostics.push(diagnostic(
                    "SIGIL_NESTED_CONFIG",
                    format!(
                        "Workspace member {nested_root} must not contain its own {CONFIG_PATH}."
                    ),
                    Location::at(path, None).with_related(CONFIG_PATH),
                ));
            } else if !excludes_subtree(nested_root, &config) {
                diagnostics.push(diagnostic(
                    "SIGIL_NESTED_CONFIG",
                    format!(
                        "Nested {CONFIG_PATH} must be inside a subtree excluded by the workspace."
                    ),
                    Location::at(path, None).with_related(CONFIG_PATH),
                ));
            }
        }

        let mut paths: Vec<&String> = all_paths
            .iter()
            .filter(|p| {
                !nested_roots
                    .iter()
                    .any(|r| **p == *r || p.starts_with(&format!("{r}/")))
            })
            .filter(|p| matches_source_file(p, &config))
            .collect();
        paths.sort();
        for path in paths {
            let bytes = fs::read(root.join(path))?;
            let capture = capture_source(path, &bytes);
            text_complete &= capture.source.is_some();
            diagnostics.extend(capture.diagnostics.iter().cloned());
            workspace.sources.push(SourceFile {
                path: path.clone(),
                capture,
            });
        }

        if let Some(bytes) = read_optional(root, GLOSSARY_PATH)? {
            context[1].bytes = Some(bytes.clone());
            let parsed = glossary::parse_glossary(&bytes, GLOSSARY_PATH);
            text_complete &= !parsed.diagnostics.iter().any(|d| {
                d.code == "SIGIL_GLOSSARY_PARSE" && d.message == "Source is not valid UTF-8."
            });
            diagnostics.extend(parsed.diagnostics);
            if let Some(found) = &parsed.glossary {
                diagnostics.extend(
                    workspace
                        .sources
                        .iter()
                        .filter_map(|s| glossary::context_overlap(found, &s.path)),
                );
            }
            workspace.glossary = parsed.glossary;
        }
        workspace.config = Some(config);
        Ok(finish(workspace, context, diagnostics, text_complete))
    }
}

fn read_optional(root: &Path, relative: &str) -> io::Result<Option<Vec<u8>>> {
    match fs::read(root.join(relative)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Every regular file under `root`, workspace-relative and sorted. The skip
/// rules match the CLI adapter so both readers see the same candidates: `.git`
/// is skipped, symbolic links are skipped, and inside a `.sigil` directory only
/// `config.json`, `local.json`, and `glossary.json` are listed.
pub fn list_files(root: &Path) -> io::Result<Vec<String>> {
    let mut files = Vec::new();
    collect(
        root,
        "",
        root.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        &mut files,
    )?;
    files.sort();
    Ok(files)
}

fn collect(dir: &Path, relative: &str, dir_name: &str, files: &mut Vec<String>) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type()?;
        if name == ".git"
            || kind.is_symlink()
            || (dir_name == ".sigil"
                && (!kind.is_file()
                    || !["config.json", "local.json", "glossary.json"].contains(&name.as_str())))
        {
            continue;
        }
        let child = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if kind.is_file() {
            files.push(child);
        } else if kind.is_dir() {
            collect(&entry.path(), &child, &name, files)?;
        }
    }
    Ok(())
}
