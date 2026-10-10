//! Computed findings, each citing the claims and the law that produced it.
//!
//! Nothing here consults a model. Every finding is read out of a saturated
//! table or decided from the admission record, and carries enough provenance
//! that a reader can check it instead of trusting it.
use super::{
    identity::{Body, Defect, Fact},
    link::{Linked, SourceEvidence, Unread, UnresolvedImport, WORKSPACE},
    prepare::Request,
    program::{Saturated, text},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Changes when the on-disk report's shape changes.
///
/// 2 adds the flow finding classes. They are part of the report a consumer
/// reads, so a reader pinned to 1 cannot be handed one. 3 replaces the
/// identity's export digest with the digest of the tree-based binding and adds
/// the `uninterpreted-context` finding. 4 adds the linked check's report: the
/// `incomplete` state, the `unread` and `unresolvedImports` lists and the
/// `linked` evidence. 5 reports an ingest that left units unread as
/// `incomplete` with the same `unread` list, adds the `gap` class and drops the
/// `ungrounded-claim` finding: a name outside a Facet's list now refuses the
/// unit rather than being kept and flagged. 6 adds editor-compatible finding locations.
pub const REPORT_VERSION: u32 = 6;

/// The suffix of a linked report, so it never overwrites an ingest report.
pub const LINKED_SUFFIX: &str = ".linked.json";

/// The directory this component owns. Never the compiler's world cache.
/// Inside the store directory (`<root>/.sigil` by default).
pub const STORE: &str = "claims";

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
    /// Something a flow's own shape shows: a step that leads nowhere, or a
    /// graph whose check could not run.
    ///
    /// Its own class because it rests on a model's reading of prose, and
    /// weighting that the same as a derived contradiction would fail a build
    /// on a misreading. `state_of` below is what keeps it a warning.
    Flow,
    /// Something the interpretation says the design leaves out: a name the
    /// prose relies on that no Tag declares, or that the Facet never
    /// references.
    ///
    /// A warning, like a flow finding: many such mentions are harmless context,
    /// such as a constraint forbidding "framework code". `state_of` below is
    /// what keeps it from failing a design.
    Gap,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finding {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<crate::locations::Location>,
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
    /// Digest of the request binding the report was computed under.
    pub binding_digest: String,
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
    /// The linked check found no contradiction, but a unit has no valid
    /// reading or an import did not resolve, so it can not say the design
    /// holds together. Only the linked check reports it.
    Incomplete,
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
    /// Units no valid stored reading covers, workspace-wide. Linked reports only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread: Option<Vec<Unread>>,
    /// Imports that did not resolve, workspace-wide. Linked reports only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unresolved_imports: Option<Vec<UnresolvedImport>>,
    /// What each source was read against. Linked reports only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked: Option<LinkedEvidence>,
}

/// What a linked report was joined from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkedEvidence {
    pub workspace_digest: String,
    pub sources: Vec<SourceEvidence>,
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

/// Which question a law in the `violation` table answers.
///
/// Only violation laws reach here; unmet promises and interpretation defects
/// are built with an explicit class at their own construction sites. New
/// violation laws default to a contradiction, which is what the rest are.
fn violation_class(law: &str) -> Class {
    match law {
        "exclusive-ownership" => Class::OwnershipConflict,
        _ => Class::Contradiction,
    }
}

/// Every finding the saturated tables and the admission record yield, before
/// any run decides whose they are. Ingest and the linked check both start here,
/// so one law cannot report differently in the two.
fn derive(request: &Request, facts: &[Fact], world: &Saturated) -> Vec<Finding> {
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
            locations: Vec::new(),
            class: violation_class(&law),
            law,
            subject: text(row, 1),
            object: text(row, 2),
            claims: vec![witness],
            component,
            section,
            detail: String::new(),
        });
    }

    // A step whose edges reach none of its graph's declared ends. Reported
    // whether or not a Constraints claim reaches that graph: the check needs no
    // governance, only the flow's own shape.
    for row in world.table("unreached-step") {
        let step = text(row, 0);
        let (component, section) = where_of(&step);
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Flow,
            law: "unreached-step".into(),
            subject: step.clone(),
            object: text(row, 1),
            claims: vec![step],
            component,
            section,
            detail: "this step's edges reach none of its flow's declared ends".into(),
        });
    }

    // The three step laws. Each rests on a model's reading of prose, so each
    // reports in the flow class and none reaches the gating table.
    for row in world.table("step-violation") {
        let (law, step, object, witness) = (text(row, 0), text(row, 1), text(row, 2), text(row, 3));
        let (component, section) = where_of(&step);
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Flow,
            law: law.clone(),
            subject: step.clone(),
            object,
            // The witness is a claim for the contradiction and ownership laws;
            // the step is named so a reader can follow the finding back to the
            // prose that produced it either way.
            claims: vec![witness, step],
            component,
            section,
            detail: match law.as_str() {
                "step-excluded-action" | "step-negated-action" => {
                    "this step does what a claim reaching its flow forbids".into()
                }
                _ => "this step writes state its component does not own, which a claim marks exclusive"
                    .into(),
            },
        });
    }

    // A requirement a flow touches and no step guards on. A guard can name only
    // a Facet its own source presented, so when the requirement is another
    // component's the flow's component can never answer it; say so, because the
    // fix is the guarantee in that component's interface.
    let graph_owner: BTreeMap<String, String> = world
        .table("entity")
        .iter()
        .filter(|row| text(row, 1) == "Graph")
        .map(|row| (text(row, 0), text(row, 3)))
        .collect();
    for row in world.table("unguarded-flow") {
        let (claim, graph, object) = (text(row, 0), text(row, 1), text(row, 2));
        let (component, section) = where_of(&claim);
        let foreign = graph_owner
            .get(&graph)
            .is_some_and(|owner| *owner != component);
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Flow,
            law: "unguarded-flow".into(),
            subject: graph,
            object,
            claims: vec![claim],
            component,
            section,
            detail: if foreign {
                "this flow acts on what a claim in another component requires, and its own component cannot guard on that requirement; the guarantee belongs in its interface"
                    .into()
            } else {
                "this flow acts on what a reaching claim requires, and no step guards on it"
                    .into()
            },
        });
    }

    // A graph whose check did not run, so a reader learns that rather than
    // only that one of its rows was flagged.
    for row in world.table("suppressed-graph") {
        let component = text(row, 0);
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Flow,
            law: "suppressed-graph".into(),
            subject: component.clone(),
            object: String::new(),
            claims: Vec::new(),
            component,
            section: "logic".into(),
            detail: "a row of this flow carries a defect, so its dead-end check did not run; \
                 dropping the row instead would manufacture dead ends upstream"
                .into(),
        });
    }

    // Promises nothing satisfies, read only after the closure stabilized.
    for row in world.table("unmet-obligation") {
        let witness = text(row, 0);
        let (component, section) = where_of(&witness);
        findings.push(Finding {
            locations: Vec::new(),
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
            let (law, detail) = match defect {
                Defect::Degenerate => (
                    "degenerate-claim",
                    "subject and object are the same entity, so the claim asserts nothing",
                ),
            };
            findings.push(Finding {
                locations: Vec::new(),
                class: Class::Interpretation,
                law: law.into(),
                subject: subject_of(&fact.body),
                object: subject_of(&fact.body),
                claims: vec![fact.id.clone()],
                component: fact.component.clone(),
                section: fact.section.clone(),
                detail: detail.to_string(),
            });
        }
    }

    // What a Facet's prose relies on that the design does not give it.
    for fact in facts {
        let Body::Undeclared { name, declared } = &fact.body else {
            continue;
        };
        let (law, object, detail) = match declared {
            Some(entity) => (
                "unreferenced-name",
                entity.clone(),
                format!(
                    "the prose relies on {name:?}, which the design declares, but this Facet never references it"
                ),
            ),
            None => (
                "undeclared-name",
                name.clone(),
                format!("the prose relies on {name:?}, which no Tag in the design declares"),
            ),
        };
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Gap,
            law: law.into(),
            subject: fact.component.clone(),
            object,
            claims: vec![fact.id.clone()],
            component: fact.component.clone(),
            section: fact.section.clone(),
            detail,
        });
    }

    // A declared role the interpretation left untouched. Attributed to the
    // interpretation, never to the design.
    for (component, section) in super::identity::uninterpreted(request, facts) {
        findings.push(Finding {
            locations: Vec::new(),
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
    findings
}

/// Build the report for one interpretation of one design source.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn report(
    request: &Request,
    facts: &[Fact],
    world: &Saturated,
    interpretations: &[String],
) -> Report {
    let mut findings = derive(request, facts, world);
    let origin: BTreeMap<&str, &Fact> = facts.iter().map(|f| (f.id.as_str(), f)).collect();

    // A finding is reported by each run whose selected source authored a step
    // or a Facet it names. Imported interface readings join the program as
    // context, so without this a dependency's findings appear in every
    // dependent's report as well as its own. A finding naming two sources
    // reaches both authors deliberately:
    // an ownership conflict names a step and the owning component by
    // construction, and neither author can fix it alone.
    let mine: BTreeSet<&str> = request.own_rows().map(|r| r.facet.as_str()).collect();
    let owned = |id: &str| {
        origin
            .get(id)
            .is_some_and(|f| mine.contains(f.facet.as_str()))
    };
    findings.retain(|f| {
        f.claims.iter().any(|id| owned(id))
            || request
                .own_rows()
                .any(|r| r.component == f.component && r.source == request.binding.source)
    });

    // An imported interface Facet nothing has read yet. Added after the
    // ownership filter above: it names a dependency's Facet on purpose, so its
    // author can see why this source's check is looser than it looks. This
    // run never requests it; its own source's run does.
    for (component, facet) in super::identity::uninterpreted_context(request, facts) {
        findings.push(Finding {
            locations: Vec::new(),
            class: Class::Interpretation,
            law: "uninterpreted-context".into(),
            subject: component.clone(),
            object: facet,
            claims: Vec::new(),
            component,
            section: "interface".into(),
            detail: "this imported interface Facet has no stored reading, so claims that depend on it could not be checked; prepare its own source to read it"
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
            binding_digest: request.binding.digest(),
            interpretations: interpretations.to_vec(),
            guidance_fingerprint: world.guidance_fingerprint.clone(),
            vocabulary_generation: request.binding.vocabulary_generation,
        },
        state,
        iterations: world.iterations,
        findings,
        disagreements: None,
        unread: None,
        unresolved_imports: None,
        linked: None,
    }
}

/// Build the linked check's report: every law over the joined readings of the
/// workspace, optionally narrowed to the findings one source authored part of.
///
/// Completeness is the workspace's, never the view's: what is unread or
/// unresolved anywhere keeps the state from reading as a pass.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn linked_report(linked: &Linked, world: &Saturated, view: Option<&str>) -> Report {
    let mut findings = derive(&linked.request, &linked.facts, world);
    if let Some(source) = view {
        let involved = Involvement::new(linked);
        findings.retain(|f| involved.in_finding(f, source));
    }
    let incomplete = !linked.unread.is_empty() || !linked.unresolved_imports.is_empty();
    let state = match state_of(&findings) {
        State::Disjoint => State::Disjoint,
        _ if incomplete => State::Incomplete,
        state => state,
    };
    Report {
        version: REPORT_VERSION,
        source: view.unwrap_or(WORKSPACE).to_owned(),
        identity: Identity {
            binding_digest: linked.request.binding.digest(),
            interpretations: linked.memo_keys.clone(),
            guidance_fingerprint: world.guidance_fingerprint.clone(),
            vocabulary_generation: linked.request.binding.vocabulary_generation,
        },
        state,
        iterations: world.iterations,
        findings,
        disagreements: None,
        unread: Some(linked.unread.clone()),
        unresolved_imports: Some(linked.unresolved_imports.clone()),
        linked: Some(LinkedEvidence {
            workspace_digest: linked.workspace_digest.clone(),
            sources: linked.sources.clone(),
        }),
    }
}

/// Record the units an ingest left unread, which keeps its state from reading
/// as a pass: the design is not checked where nothing was read.
pub fn mark_unread(report: &mut Report, unread: Vec<Unread>) {
    if unread.is_empty() {
        return;
    }
    report.unread = Some(unread);
    if report.state != State::Disjoint {
        report.state = State::Incomplete;
    }
}

/// Which source authored each part a finding can name.
struct Involvement<'a> {
    /// Fact id to the source of the Facet it reads.
    fact_source: BTreeMap<&'a str, &'a str>,
    /// Entity id to the source that declares it.
    entity_source: BTreeMap<&'a str, &'a str>,
}

impl<'a> Involvement<'a> {
    fn new(linked: &'a Linked) -> Self {
        let facet_source: BTreeMap<&str, &str> = linked
            .request
            .rows
            .iter()
            .map(|r| (r.facet.as_str(), r.source.as_str()))
            .collect();
        Self {
            fact_source: linked
                .facts
                .iter()
                .filter_map(|f| Some((f.id.as_str(), *facet_source.get(f.facet.as_str())?)))
                .collect(),
            entity_source: linked
                .request
                .entities
                .iter()
                .map(|e| (e.id.as_str(), e.source.as_str()))
                .collect(),
        }
    }

    /// Whether `source` authored a claim, a component or a Tag the finding names.
    fn in_finding(&self, finding: &Finding, source: &str) -> bool {
        finding
            .claims
            .iter()
            .any(|id| self.fact_source.get(id.as_str()) == Some(&source))
            || [&finding.component, &finding.subject, &finding.object]
                .iter()
                .any(|id| self.entity_source.get(id.as_str()) == Some(&source))
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
        // U2 mints the Step entity these resolve to; until then they have no
        // subject to report, and no finding is built from them.
        Body::Reading { .. } | Body::Step { .. } | Body::Guard { .. } | Body::Undeclared { .. } => {
            String::new()
        }
    }
}

/// Where this component's reports live. A sibling of the compiler's cache,
/// never inside it.
fn store_path(root: &Path) -> PathBuf {
    root.join(STORE)
}

/// Write the report under the store this component owns.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn write(report: &Report, root: &Path) -> Result<PathBuf, String> {
    store(report, root, &report.source, ".json")
}

/// Write one artifact under the store this component owns.
///
/// Shared by the report and the judgment context so the two cannot drift on
/// naming, formatting, or which directory they land in.
pub(crate) fn store(
    value: &impl Serialize,
    root: &Path,
    source: &str,
    suffix: &str,
) -> Result<PathBuf, String> {
    let dir = store_path(root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(format!("{}{suffix}", source.replace(['/', '\\', ':'], "_")));
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

/// Attach a repeat comparison to a report.
///
/// Additive by construction: it sets a field the report otherwise omits and
/// touches no finding the first interpretation produced.
pub fn attach(report: &mut Report, comparison: Vec<Disagreement>) {
    report.disagreements = Some(comparison);
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

/// Attach editor-compatible source ranges without changing claim identities.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ComputedFindings interface
pub fn locate(report: &mut Report, input: &crate::structure::DesignInput, facts: &[Fact]) {
    for finding in &mut report.findings {
        let mut facets: BTreeSet<&str> = finding
            .claims
            .iter()
            .filter_map(|id| facts.iter().find(|f| f.id == *id).map(|f| f.facet.as_str()))
            .collect();
        // A context finding names the unread Facet directly.
        if input.units.iter().any(|u| u.id == finding.object) {
            facets.insert(&finding.object);
        }
        if facets.is_empty() {
            facets.extend(
                input
                    .units
                    .iter()
                    .filter(|u| {
                        u.owner.as_deref() == Some(finding.component.as_str())
                            && super::vocabulary::section_name(&u.section)
                                == finding.section.as_str()
                    })
                    .map(|u| u.id.as_str()),
            );
        }
        finding.locations = facets
            .into_iter()
            .filter_map(|facet| crate::locations::Location::design(input, facet))
            .collect();
        finding.locations.sort();
        finding.locations.dedup();
    }
}
