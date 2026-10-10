//! Located implementation findings and the versioned workspace report.
use super::{admit::Fact as CodeFact, program::Saturated};
use crate::{
    claims::{
        findings::State as DesignState,
        identity::{Body, Fact},
    },
    locations::Location,
    structure::DesignInput,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub const REPORT_VERSION: u32 = 1;
pub const REPORT_PATH: &str = "claims/workspace.align.json";
pub const CONTEXT_PATH: &str = "claims/workspace.align.context.json";
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Closed,
    Converged,
    Drift,
    Incomplete,
}
impl State {
    pub fn exit(self) -> u8 {
        match self {
            Self::Closed | Self::Converged => 0,
            Self::Drift | Self::Incomplete => 1,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub workspace_digest: String,
    pub design_binding_digest: String,
    pub selection_digest: String,
    pub names_digest: String,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
    pub implementation_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finding {
    pub law: String,
    pub subject: String,
    pub object: String,
    pub detail: String,
    pub claims: Vec<String>,
    pub code_rows: Vec<CodeFact>,
    pub locations: Vec<Location>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub version: u32,
    pub source: String,
    pub state: State,
    pub design_state: DesignState,
    pub identity: Identity,
    pub iterations: usize,
    pub incomplete_reasons: Vec<String>,
    pub findings: Vec<Finding>,
    pub undesigned_files: Vec<String>,
    pub undesigned_elements: Vec<String>,
    pub unanswered: Vec<Finding>,
    pub unread_files: Vec<String>,
    pub selection: Value,
    pub design_findings: Vec<crate::claims::findings::Finding>,
}
fn text(row: &[Value], index: usize) -> &str {
    row.get(index).and_then(Value::as_str).unwrap_or_default()
}
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::LocatedFindings interface
pub fn derive(
    input: &DesignInput,
    design: &[Fact],
    code: &[CodeFact],
    world: &Saturated,
) -> (Vec<Finding>, Vec<Finding>) {
    let label = |id: &str| {
        input
            .entities
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.label.as_str())
            .unwrap_or(id)
            .to_owned()
    };
    let mut grouped: BTreeMap<(String, String, String), BTreeSet<String>> = BTreeMap::new();
    for r in world.table("breach") {
        let key = (
            text(r, 0).to_owned(),
            text(r, 1).to_owned(),
            text(r, 5).to_owned(),
        );
        let ids = grouped.entry(key).or_default();
        for i in [2, 3] {
            if !text(r, i).is_empty() {
                ids.insert(text(r, i).to_owned());
            }
        }
    }
    let mut findings = Vec::new();
    for ((law, id, object), ids) in grouped {
        let Some(f) = design.iter().find(|f| f.id == id) else {
            continue;
        };
        let mut witnesses = vec![f.clone()];
        if law == "exclusive-ownership" {
            witnesses.extend(
                design.iter().filter(|f| f.defects.is_empty() && crate::claims::program::commits(&f.section) && matches!(
                    &f.body,
                    Body::Claim { relation, object: owned, expected, modality, .. }
                        if relation == "owns" && owned == &object && expected == "true" && modality != "assumed"
                )).cloned(),
            );
        }
        findings.push(located(
            input,
            &witnesses,
            code.iter()
                .filter(|f| ids.contains(&f.id))
                .cloned()
                .collect(),
            Finding {
                law: law.clone(),
                subject: subject(f).into(),
                object: object.clone(),
                detail: format!(
                    "{law}: implementation disagrees with {} for {}",
                    label(subject(f)),
                    label(&object)
                ),
                claims: vec![],
                code_rows: vec![],
                locations: vec![],
            },
        ));
    }
    let mut unanswered = Vec::new();
    for r in world.table("unanswered") {
        let Some(f) = design.iter().find(|f| f.id == text(r, 1)) else {
            continue;
        };
        let finding = located(
            input,
            std::slice::from_ref(f),
            vec![],
            Finding {
                law: text(r, 0).into(),
                subject: text(r, 2).into(),
                object: text(r, 3).into(),
                detail: format!(
                    "unanswered promise: {} {} {}",
                    label(text(r, 2)),
                    text(r, 0),
                    label(text(r, 3))
                ),
                claims: vec![],
                code_rows: vec![],
                locations: vec![],
            },
        );
        findings.push(finding.clone());
        unanswered.push(finding);
    }
    findings.sort_by_cached_key(|f| serde_json::to_string(f).unwrap());
    unanswered.sort_by_cached_key(|f| serde_json::to_string(f).unwrap());
    (findings, unanswered)
}
fn subject(f: &Fact) -> &str {
    match &f.body {
        Body::Claim { subject, .. }
        | Body::Property { subject, .. }
        | Body::Measure { subject, .. } => subject,
        _ => &f.component,
    }
}
fn located(
    input: &DesignInput,
    design: &[Fact],
    code: Vec<CodeFact>,
    mut finding: Finding,
) -> Finding {
    finding.claims = design.iter().map(|f| f.id.clone()).collect();
    finding.claims.sort();
    finding.claims.dedup();
    finding.locations = design
        .iter()
        .filter_map(|f| Location::design(input, &f.facet))
        .collect();
    finding.code_rows = code;
    finding.locations.sort();
    finding.locations.dedup();
    finding
}
