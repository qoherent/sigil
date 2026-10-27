//! The `init` command: write a workspace config and an empty glossary, and never
//! overwrite an existing config.
use crate::{
    Context,
    args::{Format, InitRequest},
    display::{Display, path_text, resolve_target},
    model::{DiagnosticView, WorkspaceMeta, exit_code, views},
    output::{Markdown, Output, diagnostic_lines, json_string, lines_text, render, runtime_error},
};
use serde::Serialize;
use sigil_core::{
    language::{
        SIGIL_VERSION,
        config::{DEFAULT_EXCLUDES, DEFAULT_INCLUDES},
        diagnostics::{Location, diagnostic},
        glossary::GLOSSARY_SCHEMA_VERSION,
        workspace::{CONFIG_PATH, GLOSSARY_PATH},
    },
    types::Diagnostic,
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

/// The config as `init` writes it, in the key order of the TypeScript output.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigView {
    sigil_version: &'static str,
    workspace: WorkspaceView,
    files: FilesView,
    tools: ToolsView,
}

#[derive(Debug, Serialize)]
struct WorkspaceView {
    name: String,
    members: Vec<String>,
}

#[derive(Debug, Serialize)]
struct FilesView {
    include: Vec<String>,
    exclude: Vec<String>,
}

/// An empty JSON object.
#[derive(Debug, Serialize)]
struct ToolsView {}

/// The JSON `init` prints.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitView {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    config: Option<ConfigView>,
    diagnostics: Vec<DiagnosticView>,
}

/// The glossary as `init` writes it: the schema version and no terms or
/// contexts, so a new workspace carries no vocabulary of its own.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryFile {
    schema_version: u32,
    terms: Vec<()>,
    contexts: Vec<()>,
}

fn empty_glossary() -> GlossaryFile {
    GlossaryFile {
        schema_version: GLOSSARY_SCHEMA_VERSION,
        terms: Vec::new(),
        contexts: Vec::new(),
    }
}

/// The directory's last path segment, or `sigil` for the file system root.
fn base_name(root: &str) -> String {
    let trimmed = root.trim_end_matches('/');
    let name = trimmed.rsplit('/').next().unwrap_or("");
    if name.is_empty() { "sigil" } else { name }.to_owned()
}

/// `root` and a workspace-relative `path` joined with one separator.
fn join(root: &str, path: &str) -> String {
    format!("{}/{path}", root.trim_end_matches('/'))
}

fn pretty_file<T: Serialize>(value: &T) -> Result<String, (u8, String)> {
    json_string(value, true).map_err(runtime_error)
}

/// Create `path` and write `text` to it, failing if anything is already there,
/// a dangling symbolic link included, as the TypeScript command line does. The
/// existence checks in `run` only choose the message; this is what keeps a file
/// or link that appeared since from being written through or replaced.
fn write(path: &Path, text: &str) -> Result<(), (u8, String)> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .and_then(|mut file| file.write_all(text.as_bytes()))
        .map_err(|error| runtime_error(format!("Cannot write {}: {error}", path_text(path))))
}

pub fn run(request: &InitRequest, ctx: &Context) -> Output {
    let target = resolve_target(&ctx.cwd, request.path.as_deref().unwrap_or("."));
    let display = Display::new(&ctx.cwd, &target, None, request.path.as_deref());
    let root = display.absolute_root().to_owned();
    let config_path = target.join(CONFIG_PATH);
    let glossary_path = target.join(GLOSSARY_PATH);
    let shown_config = display.path(CONFIG_PATH);
    let shown_glossary = display.path(GLOSSARY_PATH);
    let mut meta = WorkspaceMeta {
        workspace_root: display.root().to_owned(),
        config_path: Some(shown_config.clone()),
        sigil_version: None,
        workspace_name: None,
    };

    if config_path.exists() {
        let refused: Diagnostic = diagnostic(
            "SIGIL_CONFIG_EXISTS",
            format!(
                "Refusing to overwrite existing {}.",
                join(&root, CONFIG_PATH)
            ),
            Location::at(CONFIG_PATH, None),
        );
        let diagnostics = views(&[refused], &display);
        let code = exit_code(&diagnostics);
        let text_lines = diagnostic_lines(&diagnostics, false);
        let markdown_facts = [("Config", shown_config)];
        let markdown_diagnostics = diagnostics.clone();
        let view = InitView {
            command: "init",
            meta,
            config: None,
            diagnostics,
        };
        return render(
            &request.global,
            Format::Text,
            code,
            &view,
            || lines_text(&text_lines),
            || {
                Markdown::new("Sigil init")
                    .facts(&markdown_facts)
                    .diagnostics(&markdown_diagnostics, false)
                    .finish()
            },
        );
    }

    let name = request.name.as_deref().map(str::trim).unwrap_or_default();
    let config = ConfigView {
        sigil_version: SIGIL_VERSION,
        workspace: WorkspaceView {
            name: if name.is_empty() {
                base_name(&root)
            } else {
                name.to_owned()
            },
            members: Vec::new(),
        },
        files: FilesView {
            include: if request.include.is_empty() {
                DEFAULT_INCLUDES.iter().map(|g| (*g).to_owned()).collect()
            } else {
                request.include.clone()
            },
            exclude: if request.exclude.is_empty() {
                DEFAULT_EXCLUDES.iter().map(|g| (*g).to_owned()).collect()
            } else {
                request.exclude.clone()
            },
        },
        tools: ToolsView {},
    };
    let config_text = pretty_file(&config)?;
    let glossary_text = pretty_file(&empty_glossary())?;

    let sigil_dir = target.join(".sigil");
    fs::create_dir_all(&sigil_dir).map_err(|error| {
        (
            3,
            format!("Cannot create {}: {error}\n", path_text(&sigil_dir)),
        )
    })?;
    write(&config_path, &config_text)?;
    let glossary_created = !glossary_path.exists();
    if glossary_created {
        write(&glossary_path, &glossary_text)?;
    }

    let workspace_name = config.workspace.name.clone();
    meta.sigil_version = Some(SIGIL_VERSION.to_owned());
    meta.workspace_name = Some(workspace_name.clone());
    let text_name = workspace_name.clone();
    let glossary_fact = if glossary_created {
        format!("created {shown_glossary}")
    } else {
        format!("kept existing {shown_glossary}")
    };
    let facts = [
        ("Config", shown_config.clone()),
        ("Workspace", workspace_name),
        ("Sigil version", SIGIL_VERSION.to_owned()),
        ("Glossary", glossary_fact),
    ];
    let view = InitView {
        command: "init",
        meta,
        config: Some(config),
        diagnostics: Vec::new(),
    };
    render(
        &request.global,
        Format::Text,
        0,
        &view,
        || format!("Created {shown_config}\nWorkspace {text_name} on Sigil {SIGIL_VERSION}\n"),
        || Markdown::new("Sigil init").facts(&facts).finish(),
    )
}
