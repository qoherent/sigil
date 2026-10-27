//! The `check` command: the workspace's diagnostics plus the advisory
//! untagged-Facet and convention warnings, with a character location for each.
use crate::{
    Context,
    args::{CheckRequest, Format},
    model::{self, Counts, DiagnosticView, WorkspaceMeta},
    output::{Markdown, Output, diagnostic_lines, lines_text, render},
    session::Session,
};
use serde::Serialize;
use sigil_core::{
    language::{
        conventions::advisory_diagnostics, diagnostics::order_diagnostics,
        resolve::ResolvedWorkspace,
    },
    types::Diagnostic,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckOutput {
    command: &'static str,
    #[serde(flatten)]
    meta: WorkspaceMeta,
    diagnostics: Vec<DiagnosticView>,
    diagnostic_counts: Counts,
}

/// The diagnostics `check` reports, in canonical order: what resolving the
/// workspace found plus the advisory warnings. When discovery stopped
/// before any workspace was read, only its own diagnostics.
fn diagnostics_of(session: &Session) -> Vec<Diagnostic> {
    let Some(workspace) = &session.workspace else {
        return session.diagnostics.clone();
    };
    let resolved = ResolvedWorkspace::from(workspace);
    let advisory = advisory_diagnostics(&resolved, workspace);
    let mut all = resolved.diagnostics;
    all.extend(advisory);
    session.reword(&mut all);
    order_diagnostics(all)
}

pub fn run(request: &CheckRequest, ctx: &Context) -> Output {
    let session = Session::open(ctx, request.path.as_deref(), request.global.root.as_deref())?;
    let diagnostics = diagnostics_of(&session);
    let views = match &session.workspace {
        Some(workspace) => model::views_with_locations(&diagnostics, &session.display, workspace),
        None => model::views(&diagnostics, &session.display),
    };
    let counts = model::counts(&views);
    let output = CheckOutput {
        command: "check",
        meta: session.meta(),
        diagnostics: views,
        diagnostic_counts: counts,
    };
    let summary = format!(
        "{} error, {} warning, {} info",
        counts.error, counts.warning, counts.info
    );
    let show = request.show_locations;
    let text = || {
        let mut lines = vec![
            format!("Workspace root: {}", output.meta.workspace_root),
            format!("Diagnostics: {summary}"),
        ];
        lines.extend(diagnostic_lines(&output.diagnostics, show));
        lines_text(&lines)
    };
    let markdown = || {
        Markdown::new("Sigil check")
            .facts(&[
                ("Workspace root", output.meta.workspace_root.clone()),
                ("Diagnostics", summary.clone()),
            ])
            .diagnostics(&output.diagnostics, show)
            .finish()
    };
    render(
        &request.global,
        Format::Text,
        model::exit_code(&output.diagnostics),
        &output,
        text,
        markdown,
    )
}
