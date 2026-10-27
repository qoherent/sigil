//! The `fmt` command: select files, check that every one can be formatted and
//! that the whole workspace stays valid with the new text, and only then write.
use crate::{
    Context,
    args::{FmtRequest, Format},
    display::fmt_controlling_path,
    model::{DiagnosticView, WorkspaceMeta, exit_code, views},
    output::{Output, diagnostic_lines, fail, lines_text, render, runtime_error},
    selection,
    session::Session,
};
use serde::Serialize;
use sigil_core::{
    language::{
        diagnostics::order_diagnostics,
        format::{LINE_TOO_LONG, format_document_resolved, is_conventions_error},
        fs::{DiskFs, Overlay},
        resolve::ResolvedWorkspace,
        workspace::Workspace,
    },
    types::{Diagnostic, Severity},
};
use std::{fs, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Formatted,
    Unchanged,
    Noncanonical,
    Failed,
}

impl Status {
    fn text(self) -> &'static str {
        match self {
            Self::Formatted => "formatted",
            Self::Unchanged => "unchanged",
            Self::Noncanonical => "noncanonical",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileResult {
    file_path: String,
    status: Status,
}

#[derive(Debug, Serialize)]
struct FmtOutput {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    check: bool,
    files: Vec<FileResult>,
    diagnostics: Vec<DiagnosticView>,
}

/// What the batch did, before it is shown.
struct Batch {
    /// Selected paths with their status, in workspace order.
    files: Vec<(String, Status)>,
    diagnostics: Vec<Diagnostic>,
}

fn has_blocking_error(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|d| {
        matches!(d.severity, Severity::Error) && d.code != LINE_TOO_LONG && !is_conventions_error(d)
    })
}

fn all_failed(selected: Vec<String>, mut diagnostics: Vec<Diagnostic>) -> Batch {
    // `check` reports a malformed conventions file; the formatter does not.
    diagnostics.retain(|d| !is_conventions_error(d));
    Batch {
        files: selected
            .into_iter()
            .map(|path| (path, Status::Failed))
            .collect(),
        diagnostics,
    }
}

/// The batch protocol over an already loaded workspace: check the workspace,
/// format every selected file, check the workspace again with the new text,
/// then write the changed files.
fn run_batch(
    root: &Path,
    workspace: &Workspace,
    selected: Vec<String>,
    check: bool,
) -> Result<Batch, (u8, String)> {
    let resolved = ResolvedWorkspace::from(workspace);
    if has_blocking_error(&resolved.diagnostics) {
        return Ok(all_failed(selected, resolved.diagnostics.clone()));
    }

    let prepared: Vec<_> = selected
        .iter()
        .map(|path| (path, format_document_resolved(workspace, &resolved, path)))
        .collect();
    let mut diagnostics = order_diagnostics(
        prepared
            .iter()
            .flat_map(|(_, result)| result.diagnostics.iter().cloned())
            .collect(),
    );
    let every_formatted = prepared
        .iter()
        .all(|(_, result)| result.formatted_source.is_some());
    if every_formatted {
        let disk = DiskFs::new(root);
        let mut overlay = Overlay::new(&disk);
        let mut any_changed = false;
        for (path, result) in &prepared {
            if result.changed
                && let Some(source) = &result.formatted_source
            {
                overlay.set(path, source.clone());
                any_changed = true;
            }
        }
        // Without a change the overlay is empty and a reload would resolve the
        // very workspace that is already resolved.
        diagnostics = if any_changed {
            let reloaded = Workspace::load_with(&overlay).map_err(runtime_error)?;
            ResolvedWorkspace::from(&reloaded).diagnostics
        } else {
            resolved.diagnostics.clone()
        };
    }
    if diagnostics
        .iter()
        .any(|d| matches!(d.severity, Severity::Error) && !is_conventions_error(d))
        || !every_formatted
    {
        return Ok(all_failed(selected, diagnostics));
    }

    let mut files = Vec::new();
    for (path, result) in &prepared {
        let status = if !result.changed {
            Status::Unchanged
        } else if check {
            Status::Noncanonical
        } else {
            Status::Formatted
        };
        if status == Status::Formatted
            && let Some(source) = &result.formatted_source
        {
            fs::write(root.join(path), source).map_err(|error| {
                runtime_error(format!("{}: {error}", root.join(path).display()))
            })?;
        }
        files.push(((*path).clone(), status));
    }
    // `check` reports a malformed conventions file; the formatter does not.
    diagnostics.retain(|d| !is_conventions_error(d));
    Ok(Batch { files, diagnostics })
}

fn show(request: &FmtRequest, session: &Session, mut batch: Batch) -> Output {
    let display = &session.display;
    session.reword(&mut batch.diagnostics);
    let diagnostics = views(&batch.diagnostics, display);
    let files: Vec<FileResult> = batch
        .files
        .into_iter()
        .map(|(path, status)| FileResult {
            file_path: display.path(&path),
            status,
        })
        .collect();
    // `Noncanonical` is only produced when `--check` is set.
    let difference = files.iter().any(|f| f.status == Status::Noncanonical);
    let failed = files.iter().any(|f| f.status == Status::Failed);
    let exit = if difference || failed {
        1
    } else {
        exit_code(&diagnostics)
    };
    let mut lines: Vec<String> = files
        .iter()
        .map(|f| format!("{} {}", f.status.text(), f.file_path))
        .collect();
    lines.extend(diagnostic_lines(&diagnostics, false));
    let model = FmtOutput {
        command: "fmt",
        meta: session.meta(),
        check: request.check,
        files,
        diagnostics,
    };
    // `fmt` offers json and text only; markdown is refused before this point.
    render(
        &request.global,
        Format::Text,
        exit,
        &model,
        || lines_text(&lines),
        || lines_text(&lines),
    )
}

pub fn run(request: &FmtRequest, ctx: &Context) -> Output {
    let targets = selection::targets(&ctx.cwd, &request.paths);
    let session = Session::open_controlled(
        ctx,
        Some(&targets[0]),
        request.global.root.as_deref(),
        fmt_controlling_path(&request.paths),
    )?;

    // Discovery that stopped short of a workspace (no config, a nested one)
    // leaves no source to select.
    let Some(workspace) = &session.workspace else {
        return fail(3, format!("No Sigil source matched {}.", targets[0]));
    };

    let sources: Vec<String> = workspace.sources.iter().map(|s| s.path.clone()).collect();
    let selected = match selection::select(
        &targets,
        session.display.absolute_root(),
        &sources,
        request.global.root.is_some(),
    ) {
        Ok(selected) => selected,
        Err(message) => return fail(3, message),
    };

    let batch = run_batch(&session.root, workspace, selected, request.check)?;
    show(request, &session, batch)
}
