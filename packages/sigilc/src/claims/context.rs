//! The judgment context: what a judge needs, so it reads conclusions instead
//! of re-deriving them from prose.
//!
//! This component does not judge. It carries every unit of the design, what was
//! derived about it and why, which promises are unmet and where each was
//! stated, and which formulations look redundant — and stops there.
use super::{
    findings::Identity,
    identity::{Body, Fact},
    prepare::Request,
    program::{self, Saturated, text},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const CONTEXT_VERSION: u32 = 1;

/// How far the interpretation got with one Facet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Coverage {
    /// At least one claim satisfied this unit.
    Interpreted,
    /// The interpreter read it and drew no commitment from it.
    ReadWithoutCommitment,
    /// The interpreter returned nothing usable for it.
    Uninterpreted,
}

/// A claim as authored, with the role it was authored under.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asserted {
    pub claim: String,
    pub body: Body,
    pub satisfies_unit: bool,
}

/// A conclusion the laws reached, and what reached it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Derived {
    pub subject: String,
    pub relation: String,
    pub object: String,
    /// The law that produced it, or `asserted` when a claim stated it directly.
    pub law: String,
    /// A claim identity for an asserted conclusion, an intermediary otherwise.
    pub witness: String,
}

/// Where a promise is stated, which is what makes an omission relevant.
///
/// This is the one element of the advisory reviewer's missing-detail admission
/// rule that is a fact rather than a judgment. The other two — which
/// human-owned behaviors the omission leaves open, and why implementation
/// cannot safely choose among them — are the judge's work, not this tool's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Promise {
    pub claim: String,
    pub facet: String,
    pub component: String,
    pub section: String,
    pub source: String,
    /// The authored text the promise is stated in.
    pub prose: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Obligation {
    pub subject: String,
    pub relation: String,
    pub object: String,
    pub filled: bool,
    pub promise: Promise,
}

/// A smaller formulation that may preserve every promise. Never a verdict.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub kind: String,
    pub claims: Vec<String>,
    pub facets: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Unit {
    pub facet: String,
    pub component: String,
    pub component_label: String,
    pub section: String,
    /// Carried so a consumer needs no access to the design sources.
    pub prose: String,
    pub coverage: Coverage,
    pub asserted: Vec<Asserted>,
    pub derived: Vec<Derived>,
    pub obligations: Vec<Obligation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub version: u32,
    pub source: String,
    pub identity: Identity,
    /// Every unit in the design, including ones the computation found nothing
    /// about: a defect in a unit whose promises all happen to be met is still
    /// reachable by the judge.
    pub units: Vec<Unit>,
    pub simplification: Vec<Candidate>,
    /// Roles whose claims commit nothing, so the judge knows why a Decisions
    /// Facet's claims derived nothing rather than inferring a bug.
    pub non_committing_roles: Vec<String>,
}

/// The suffix this component's on-disk artifact uses, mirroring how
/// findings.rs owns its own report suffix.
pub const SUFFIX: &str = ".context.json";

/// Build the judgment context for one interpretation of one design source.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::JudgmentContext interface
pub fn build(request: &Request, facts: &[Fact], world: &Saturated, identity: Identity) -> Context {
    let by_facet: BTreeMap<&str, Vec<&Fact>> = facts.iter().fold(BTreeMap::new(), |mut acc, f| {
        acc.entry(f.facet.as_str()).or_default().push(f);
        acc
    });
    let origin: BTreeMap<&str, &Fact> = facts.iter().map(|f| (f.id.as_str(), f)).collect();
    let prose: BTreeMap<&str, &str> = request
        .rows
        .iter()
        .map(|r| (r.facet.as_str(), r.prose.as_str()))
        .collect();

    // Conclusions, grouped by the claim or intermediary that witnesses them.
    let derived: Vec<Derived> = world
        .table("because")
        .iter()
        .map(|row| Derived {
            subject: text(row, 0),
            relation: text(row, 1),
            object: text(row, 2),
            law: text(row, 3),
            witness: text(row, 4),
        })
        .collect();

    // Indexed once. Scanning these per Facet made the pass quadratic in
    // (Facets x derived rows), which bites on a design with many units.
    let mut derived_by_witness: BTreeMap<&str, Vec<&Derived>> = BTreeMap::new();
    for entry in &derived {
        derived_by_witness
            .entry(entry.witness.as_str())
            .or_default()
            .push(entry);
    }
    let mut obligations_by_claim: BTreeMap<String, Vec<&Vec<Value>>> = BTreeMap::new();
    for row in world.table("obligation") {
        obligations_by_claim
            .entry(text(row, 0))
            .or_default()
            .push(row);
    }

    let unmet: BTreeSet<String> = world
        .table("unmet-obligation")
        .iter()
        .map(|row| obligation_key(&text(row, 0), &text(row, 1), &text(row, 2), &text(row, 3)))
        .collect();

    let mut units = Vec::new();
    for row in &request.rows {
        let mine: &[&Fact] = by_facet.get(row.facet.as_str()).map_or(&[], Vec::as_slice);
        let asserted: Vec<Asserted> = mine
            .iter()
            .map(|f| Asserted {
                claim: f.id.clone(),
                body: f.body.clone(),
                satisfies_unit: f.satisfies_unit(),
            })
            .collect();

        let ids: BTreeSet<&str> = mine.iter().map(|f| f.id.as_str()).collect();
        let mut mine_derived: Vec<Derived> = ids
            .iter()
            .filter_map(|id| derived_by_witness.get(id))
            .flat_map(|entries| entries.iter().map(|d| (*d).clone()))
            .collect();
        mine_derived.sort();
        mine_derived.dedup();

        let mut obligations = Vec::new();
        for obligation_row in ids
            .iter()
            .filter_map(|id| obligations_by_claim.get(*id))
            .flat_map(|rows| rows.iter().copied())
        {
            let raised_by = text(obligation_row, 0);
            let (subject, relation, object) = (
                text(obligation_row, 1),
                text(obligation_row, 2),
                text(obligation_row, 3),
            );
            let key = obligation_key(&raised_by, &subject, &relation, &object);
            let source_fact = origin.get(raised_by.as_str()).copied();
            obligations.push(Obligation {
                subject,
                relation,
                object,
                filled: !unmet.contains(&key),
                promise: Promise {
                    claim: raised_by.clone(),
                    facet: row.facet.clone(),
                    component: row.component.clone(),
                    section: source_fact
                        .map(|f| f.section.clone())
                        .unwrap_or_else(|| row.section.clone()),
                    source: row.source.clone(),
                    prose: prose
                        .get(row.facet.as_str())
                        .copied()
                        .unwrap_or("")
                        .to_owned(),
                },
            });
        }

        let coverage = if mine
            .iter()
            .any(|f| f.satisfies_unit() && !matches!(f.body, Body::Reading { .. }))
        {
            Coverage::Interpreted
        } else if mine
            .iter()
            .any(|f| f.satisfies_unit() && matches!(f.body, Body::Reading { .. }))
        {
            Coverage::ReadWithoutCommitment
        } else {
            Coverage::Uninterpreted
        };

        units.push(Unit {
            facet: row.facet.clone(),
            component: row.component.clone(),
            component_label: row.component_label.clone(),
            section: row.section.clone(),
            prose: row.prose.clone(),
            coverage,
            asserted,
            derived: mine_derived,
            obligations,
        });
    }

    Context {
        version: CONTEXT_VERSION,
        source: request.binding.source.clone(),
        identity,
        units,
        simplification: candidates(world, &origin),
        non_committing_roles: program::NON_COMMITTING
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
    }
}

/// Smaller formulations that may keep every promise. Proposed, never ruled on.
fn candidates(world: &Saturated, origin: &BTreeMap<&str, &Fact>) -> Vec<Candidate> {
    let mut out = BTreeSet::new();

    // The same proposition authored in two different Facets.
    for row in world.table("duplicate-proposition") {
        let (a, b) = (text(row, 0), text(row, 1));
        if a >= b {
            continue;
        }
        let facets: Vec<String> = [a.as_str(), b.as_str()]
            .iter()
            .filter_map(|id| origin.get(*id).map(|f| f.facet.clone()))
            .collect();
        out.insert(Candidate {
            kind: "duplicate-proposition".into(),
            claims: vec![a, b],
            facets,
            detail:
                "two units author the same proposition; one formulation may preserve both promises"
                    .into(),
        });
    }

    // A claim the laws already derive by another route, so stating it directly
    // may be redundant. Subsumption is a candidate, not a defect: the explicit
    // claim may be the one carrying the intent.
    let mut asserted: BTreeMap<(String, String, String), Vec<String>> = BTreeMap::new();
    let mut inferred: BTreeSet<(String, String, String)> = BTreeSet::new();
    for row in world.table("because") {
        let triple = (text(row, 0), text(row, 1), text(row, 2));
        if text(row, 3) == "asserted" {
            asserted.entry(triple).or_default().push(text(row, 4));
        } else {
            inferred.insert(triple);
        }
    }
    for (triple, claims) in asserted {
        if !inferred.contains(&triple) {
            continue;
        }
        let facets: Vec<String> = claims
            .iter()
            .filter_map(|id| origin.get(id.as_str()).map(|f| f.facet.clone()))
            .collect();
        out.insert(Candidate {
            kind: "subsumed-claim".into(),
            claims,
            facets,
            detail: format!(
                "the laws already derive {} {} {} by another route",
                triple.0, triple.1, triple.2
            ),
        });
    }
    out.into_iter().collect()
}

fn obligation_key(id: &str, subject: &str, relation: &str, object: &str) -> String {
    format!("{id}\u{1f}{subject}\u{1f}{relation}\u{1f}{object}")
}
