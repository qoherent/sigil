//! Computed findings, each citing the claims and the law that produced it.
//!
//! Nothing here consults a model. Every finding is read out of a saturated
//! table or decided from the admission record, and carries enough provenance
//! that a reader can check it instead of trusting it.
use super::{
    identity::{Body, Defect, Fact},
    prepare::Request,
    program::Saturated,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub const REPORT_VERSION: u32 = 1;

/// The directory this component owns. Never the compiler's world cache.
pub const STORE: &str = ".sigil/claims";

/// What kind of question a finding answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Class {
    /// Two commitments that cannot both hold.
    Contradiction,
    /// Two components claiming the same exclusive state.
    OwnershipConflict,
    /// A promise nothing in the design satisfies.
    UnmetObligation,
    /// A defect in the interpretation rather than in the design.
    Interpretation,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finding {
    pub class: Class,
    /// The law that derived this finding, or the admission rule that decided it.
    pub law: String,
    pub subject: String,
    pub object: String,
    /// Claim identities a reader can follow back to the prose they came from.
    pub claims: Vec<String>,
    pub component: String,
    pub section: String,
    pub detail: String,
}

/// What the report was computed from, so a stale one is detectable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub export_digest: String,
    /// Every interpretation artifact supplied, in the order supplied.
    pub interpretations: Vec<String>,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
}

/// The overall verdict, in the compiler's own vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Nothing contradicts and every promise is met.
    Coherent,
    /// No contradiction, but promises or interpretation coverage are unresolved.
    Loose,
    /// A contradiction or an ownership conflict was derived.
    Disjoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub version: u32,
    pub source: String,
    pub identity: Identity,
    pub state: State,
    pub iterations: usize,
    pub findings: Vec<Finding>,
    /// Claims the runs disagreed on, when a second interpretation was supplied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disagreements: Option<Vec<Disagreement>>,
}

/// One claim present in one interpretation of a Facet and absent from another.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Disagreement {
    pub facet: String,
    pub section: String,
    /// Which interpretation carried it: the first or the repeat.
    pub only_in: String,
    pub claim: String,
    pub detail: String,
}

/// Which laws answer which question.
fn class_of(law: &str) -> Class {
    match law {
        "exclusive-ownership" => Class::OwnershipConflict,
        "unmet-obligation" => Class::UnmetObligation,
        "degenerate-claim" | "ungrounded-claim" | "uninterpreted-section" => Class::Interpretation,
        _ => Class::Contradiction,
    }
}

/// Build the report for one interpretation of one design source.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn report(
    request: &Request,
    facts: &[Fact],
    world: &Saturated,
    interpretations: &[String],
) -> Report {
    let origin: BTreeMap<&str, &Fact> = facts.iter().map(|f| (f.id.as_str(), f)).collect();
    let where_of = |id: &str| {
        origin
            .get(id)
            .map(|f| (f.component.clone(), f.section.clone()))
            .unwrap_or_default()
    };

    let mut findings = Vec::new();

    // Violations and ownership conflicts, straight out of the saturated table.
    for row in world.table("violation") {
        let law = text(row, 0);
        let witness = text(row, 3);
        let (component, section) = where_of(&witness);
        findings.push(Finding {
            class: class_of(&law),
            law,
            subject: text(row, 1),
            object: text(row, 2),
            claims: vec![witness],
            component,
            section,
            detail: String::new(),
        });
    }

    // Promises nothing satisfies, read only after the closure stabilized.
    for row in world.table("unmet-obligation") {
        let witness = text(row, 0);
        let (component, section) = where_of(&witness);
        findings.push(Finding {
            class: Class::UnmetObligation,
            law: "unmet-obligation".into(),
            subject: text(row, 1),
            object: text(row, 3),
            claims: vec![witness],
            component,
            section,
            detail: format!("nothing satisfies {} {}", text(row, 2), text(row, 3)),
        });
    }

    // Defects in the interpretation, not the design.
    for fact in facts {
        for defect in &fact.defects {
            let (law, object, detail) = match defect {
                Defect::Degenerate => (
                    "degenerate-claim",
                    subject_of(&fact.body),
                    "subject and object are the same entity, so the claim asserts nothing"
                        .to_string(),
                ),
                Defect::Ungrounded(entity) => (
                    "ungrounded-claim",
                    entity.clone(),
                    format!(
                        "{entity} does not occur in this Facet's resolved references, its owning component, or a provider its source imports"
                    ),
                ),
            };
            findings.push(Finding {
                class: Class::Interpretation,
                law: law.into(),
                subject: subject_of(&fact.body),
                object,
                claims: vec![fact.id.clone()],
                component: fact.component.clone(),
                section: fact.section.clone(),
                detail,
            });
        }
    }

    // A declared role the interpretation left untouched. Attributed to the
    // interpretation, never to the design.
    for (component, section) in super::identity::uninterpreted(request, facts) {
        findings.push(Finding {
            class: Class::Interpretation,
            law: "uninterpreted-section".into(),
            subject: component.clone(),
            object: section.clone(),
            claims: Vec::new(),
            component,
            section,
            detail:
                "this role declares a Facet the interpretation returned nothing for; the gap is in the interpretation"
                    .into(),
        });
    }

    findings.sort();
    findings.dedup();
    let state = state_of(&findings);
    Report {
        version: REPORT_VERSION,
        source: request.binding.source.clone(),
        identity: Identity {
            export_digest: request.binding.export_digest.clone(),
            interpretations: interpretations.to_vec(),
            guidance_fingerprint: world.guidance_fingerprint.clone(),
            vocabulary_generation: request.binding.vocabulary_generation,
        },
        state,
        iterations: world.iterations,
        findings,
        disagreements: None,
    }
}

fn state_of(findings: &[Finding]) -> State {
    if findings
        .iter()
        .any(|f| matches!(f.class, Class::Contradiction | Class::OwnershipConflict))
    {
        State::Disjoint
    } else if findings.is_empty() {
        State::Coherent
    } else {
        State::Loose
    }
}

fn subject_of(body: &Body) -> String {
    match body {
        Body::Claim { subject, .. }
        | Body::Property { subject, .. }
        | Body::Measure { subject, .. } => subject.clone(),
        Body::Reading { .. } => String::new(),
    }
}

fn text(row: &[Value], index: usize) -> String {
    row.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Where this component's reports live. A sibling of the compiler's cache,
/// never inside it.
pub fn store_path(root: &Path) -> PathBuf {
    root.join(STORE)
}

/// Write the report under the store this component owns.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn write(report: &Report, root: &Path) -> Result<PathBuf, String> {
    let dir = store_path(root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = format!("{}.json", report.source.replace(['/', '\\', ':'], "_"));
    let path = dir.join(name);
    let mut bytes = serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

/// Compare two interpretations of the same design, per Facet.
///
/// The first interpretation remains the sole basis for the computed report;
/// this comparison is additive and never suppresses a finding the first one
/// produced. It costs a full extra interpretation, so it is opt-in.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn disagreements(first: &[Fact], repeat: &[Fact]) -> Vec<Disagreement> {
    let key = |f: &Fact| (f.facet.clone(), f.section.clone(), body_key(&f.body));
    let left: BTreeMap<_, _> = first.iter().map(|f| (key(f), f)).collect();
    let right: BTreeMap<_, _> = repeat.iter().map(|f| (key(f), f)).collect();

    let mut out = Vec::new();
    for (k, fact) in &left {
        if !right.contains_key(k) {
            out.push(one(fact, "first"));
        }
    }
    for (k, fact) in &right {
        if !left.contains_key(k) {
            out.push(one(fact, "repeat"));
        }
    }
    out.sort();
    out
}

fn one(fact: &Fact, only_in: &str) -> Disagreement {
    Disagreement {
        facet: fact.facet.clone(),
        section: fact.section.clone(),
        only_in: only_in.to_owned(),
        claim: fact.id.clone(),
        detail: format!(
            "this Facet's reading is unstable: the {only_in} interpretation asserted this and the other did not"
        ),
    }
}

/// Identity of what a row says, independent of which run produced it.
fn body_key(body: &Body) -> String {
    serde_json::to_string(body).expect("body serialization")
}
