//! Full-design gate, scoped implementation closure, and deterministic reporting.
use super::{
    dialect::Row,
    guidance, memo, prepare, program,
    report::{self, Finding, Identity, Report, State},
    vocabulary,
};
use crate::{
    claims::{findings, program as design_program},
    command::{Output, json},
    engine,
    locations::Location,
    sources,
    structure::{Severity, Stage},
};
use serde_json::json;
use std::{collections::BTreeMap, path::Path};
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::AlignCheck interface
pub fn run(root: &Path, store: &Path) -> Output {
    let workspace = prepare::load(root, store).map_err(prepare::LoadError::output)?;
    let errors: Vec<_> = workspace
        .input
        .diagnostics
        .iter()
        .filter(|d| matches!(d.stage, Stage::Workspace) && matches!(d.severity, Severity::Error))
        .map(|d| d.message.as_str())
        .collect();
    if !errors.is_empty() {
        return Err((
            3,
            format!("the workspace could not be read: {}", errors.join("; ")),
        ));
    }
    // Scope never hides unread/disjoint design. The entire linked design is gated.
    let design_world = design_program::saturate(
        &workspace.linked.request,
        &workspace.linked.facts,
        engine::Limits::default(),
    )
    .map_err(|e| (3, e))?;
    let mut design_report = findings::linked_report(&workspace.linked, &design_world, None);
    findings::locate(
        &mut design_report,
        &workspace.input,
        &workspace.linked.facts,
    );
    let requests = workspace.requests(root).map_err(|e| (3, e))?;
    let split = memo::split(&requests, store);
    let scoped: Vec<_> = workspace
        .linked
        .facts
        .iter()
        .filter(|f| {
            workspace.linked.request.rows.iter().any(|r| {
                r.facet == f.facet && workspace.selection.design.sources.contains(&r.source)
            })
        })
        .cloned()
        .collect();
    let code: Vec<_> = split
        .reused
        .iter()
        .flat_map(|(_, a)| a.facts.clone())
        .collect();
    let world = if matches!(
        design_report.state,
        findings::State::Coherent | findings::State::Loose
    ) {
        Some(
            program::saturate(
                &workspace.linked.request.entities,
                &scoped,
                &code,
                engine::Limits::default(),
            )
            .map_err(|e| (3, e))?,
        )
    } else {
        None
    };
    let (mut findings, unanswered) = world
        .as_ref()
        .map(|w| report::derive(&workspace.input, &scoped, &code, w))
        .unwrap_or_default();
    let mut undesigned_files = Vec::new();
    let mut undesigned_elements = Vec::new();
    for (r, a) in &split.reused {
        if !a.rows.iter().any(|r| matches!(r, Row::Realizes { .. })) {
            undesigned_files.push(r.binding.path.clone());
            findings.push(Finding {
                law: "undesigned-file".into(),
                subject: r.binding.path.clone(),
                object: String::new(),
                detail: format!("undesigned selected file: {}", r.binding.path),
                claims: vec![],
                code_rows: a.facts.clone(),
                locations: vec![Location::element(&r.binding.path, r.source.as_bytes())],
            });
        }
        for e in &a.undesigned_elements {
            let element = format!("{}::{e}", r.binding.path);
            undesigned_elements.push(element.clone());
            findings.push(Finding {
                law: "undesigned-element".into(),
                subject: element.clone(),
                object: String::new(),
                detail: format!("undesigned element: {element}"),
                claims: vec![],
                code_rows: a
                    .facts
                    .iter()
                    .filter(|f| f.element == element)
                    .cloned()
                    .collect(),
                locations: vec![Location::element(&r.binding.path, r.source.as_bytes())],
            });
        }
    }
    if world.is_none() {
        findings.clear();
    }
    // Code locations use the exact whole-file bytes captured for this check.
    let code_locations: BTreeMap<_, _> = requests
        .iter()
        .map(|r| {
            (
                r.binding.path.as_str(),
                Location::element(&r.binding.path, r.source.as_bytes()),
            )
        })
        .collect();
    for f in &mut findings {
        for row in &f.code_rows {
            if let Some(location) = code_locations.get(row.path.as_str()) {
                f.locations.push(location.clone());
            }
        }
        f.locations.sort();
        f.locations.dedup();
    }
    undesigned_files.sort();
    undesigned_elements.sort();
    let unread_files: Vec<_> = split.stale.iter().map(|r| r.binding.path.clone()).collect();
    let mut reasons = Vec::new();
    match design_report.state {
        findings::State::Incomplete => reasons.push("design-incomplete".into()),
        findings::State::Disjoint => reasons.push("design-disjoint".into()),
        _ => {}
    }
    if !unread_files.is_empty() {
        reasons.push("unread-files".into());
    }
    if !workspace.selection.implementation.unpresentable.is_empty() {
        reasons.push("unpresentable-files".into());
    }
    let state = if !reasons.is_empty() {
        State::Incomplete
    } else if !findings.is_empty() {
        State::Drift
    } else if design_report.state == findings::State::Coherent {
        State::Closed
    } else {
        State::Converged
    };
    let identity = Identity {
        workspace_digest: workspace.linked.workspace_digest.clone(),
        design_binding_digest: workspace.linked.request.binding.digest(),
        selection_digest: workspace.selection.fingerprint.clone(),
        names_digest: workspace.names_digest.clone(),
        guidance_fingerprint: guidance::fingerprint(),
        vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
        implementation_digest: sources::hash(
            &serde_json::to_vec(&code).map_err(|e| (3, e.to_string()))?,
        ),
    };
    let report = Report {
        version: report::REPORT_VERSION,
        source: "workspace".into(),
        state,
        design_state: design_report.state,
        identity: identity.clone(),
        iterations: world.as_ref().map(|w| w.iterations).unwrap_or(0),
        incomplete_reasons: reasons,
        findings,
        undesigned_files,
        undesigned_elements,
        unanswered,
        unread_files,
        selection: serde_json::to_value(&workspace.selection).map_err(|e| (3, e.to_string()))?,
        design_findings: design_report.findings.clone(),
    };
    let context = json!({
        "version": report::REPORT_VERSION,
        "source": "workspace",
        "identity": identity,
        "designCheck": design_report,
        "designFacts": scoped,
        "designFacets": workspace.linked.request.rows,
        "codeFacts": code,
        "entities": workspace.linked.request.entities,
        "tables": world.as_ref().map(|w| &w.tables),
        "selection": report.selection,
    });
    let report_path = crate::claims::findings::store(&report, store, "workspace", ".align.json")
        .map_err(|e| (3, e))?;
    let context_path =
        crate::claims::findings::store(&context, store, "workspace", ".align.context.json")
            .map_err(|e| (3, e))?;
    json(
        state.exit(),
        &json!({
            "version": report.version,
            "scope": "workspace",
            "state": state,
            "designState": report.design_state,
            "incompleteReasons": report.incomplete_reasons,
            "findings": report.findings.len(),
            "unreadUnits": report.unread_files.len(),
            "report": report_path,
            "judgmentContext": context_path,
            "workspaceDigest": report.identity.workspace_digest,
            "vocabularyGeneration": report.identity.vocabulary_generation,
            "guidanceFingerprint": report.identity.guidance_fingerprint,
        }),
    )
}
