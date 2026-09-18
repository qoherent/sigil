use sigilc::{
    claims::{
        dialect::{self, Limits},
        findings::{self, Class, Report, State},
        identity::{self, Fact},
        prepare::{self, Request},
        program,
    },
    eqval,
    frontend::DesignInput,
};
use std::fs;

mod support;
use support::Workspace;

const BASE: &str = "base.sigil";
const BASE_GOAL: &str = "facet:base.sigil:29";
const BASE_INTERFACE: &str = "facet:base.sigil:71";
const BASE_CONSTRAINTS: &str = "facet:base.sigil:129";
const BASE_ID: &str = "urn:sigil:component:base.sigil:Base";

fn shared_input() -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&support::shared_value()).unwrap()).unwrap()
}

/// The whole path: project, read the artifact, admit, saturate, report.
fn run(artifact: &str) -> (Request, Vec<Fact>, Report) {
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &input, &facts, eqval::Limits::default()).unwrap();
    let report = findings::report(&request, &facts, &world, &["artifact-digest".into()]);
    (request, facts, report)
}

/// An interpretation that covers every declared role of base.sigil cleanly.
fn clean_artifact() -> String {
    format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    )
}

// ------------------------------------------------------- acceptance examples

#[test]
fn a_claim_pointing_at_itself_is_reported_degenerate_and_leaves_its_unit_unsatisfied() {
    // Covers AE1.
    let (_, facts, report) = run(&format!(
        "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n"
    ));
    let degenerate: Vec<_> = report
        .findings
        .iter()
        .filter(|f| f.law == "degenerate-claim")
        .collect();
    assert_eq!(degenerate.len(), 1, "{:?}", report.findings);
    assert_eq!(degenerate[0].class, Class::Interpretation);
    assert_eq!(degenerate[0].claims, vec![facts[0].id.clone()]);
    assert_eq!(degenerate[0].section, "goal");
    assert!(!facts[0].satisfies_unit());

    // And the role it failed to interpret is reported as a gap.
    assert!(
        report
            .findings
            .iter()
            .any(|f| f.law == "uninterpreted-section" && f.object == "goal"),
        "{:?}",
        report.findings
    );
}

#[test]
fn a_role_the_interpretation_skipped_is_named_with_its_component() {
    // Covers AE2. base.sigil declares goal, interface and constraints; this
    // artifact answers two of them.
    let (_, _, report) = run(&format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    let gaps: Vec<_> = report
        .findings
        .iter()
        .filter(|f| f.law == "uninterpreted-section")
        .collect();
    assert_eq!(gaps.len(), 1, "{:?}", report.findings);
    assert_eq!(gaps[0].object, "constraints");
    assert_eq!(gaps[0].subject, BASE_ID, "the component must be named");
    assert_eq!(gaps[0].class, Class::Interpretation);
    assert!(
        gaps[0].detail.contains("the interpretation"),
        "the gap is attributed to the interpretation, not the design: {}",
        gaps[0].detail
    );
    assert!(gaps[0].claims.is_empty(), "an absence cites no claim");
}

#[test]
fn a_declared_but_empty_role_is_not_a_gap() {
    // Covers AE3. base.sigil declares no `cases` Facet, so nothing is owed for
    // it and nothing is reported against it.
    let (request, _, report) = run(&clean_artifact());
    assert!(
        !request.declared.iter().any(|(_, s)| s == "cases"),
        "a role with no Facet is not declared: {:?}",
        request.declared
    );
    assert!(
        !report.findings.iter().any(|f| f.object == "cases"),
        "{:?}",
        report.findings
    );
}

// --------------------------------------------------------------- provenance

#[test]
fn every_finding_names_exactly_one_law_and_cites_its_claims() {
    let (_, _, report) = run(&format!(
        "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    ));
    assert!(!report.findings.is_empty());
    for finding in &report.findings {
        assert!(!finding.law.is_empty(), "{finding:?}");
        assert!(
            !finding.detail.is_empty() || !finding.claims.is_empty(),
            "{finding:?}"
        );
        if finding.law == "uninterpreted-section" {
            // A gap is an absence; there is no claim to cite.
            continue;
        }
        assert!(
            !finding.claims.is_empty(),
            "a computed finding must cite what produced it: {finding:?}"
        );
    }
}

#[test]
fn an_unmet_promise_names_the_claim_that_raised_it() {
    let (_, facts, report) = run(&format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    ));
    let unmet: Vec<_> = report
        .findings
        .iter()
        .filter(|f| f.class == Class::UnmetObligation)
        .collect();
    assert_eq!(unmet.len(), 1, "{:?}", report.findings);
    let raised_by = &unmet[0].claims[0];
    let origin = facts.iter().find(|f| &f.id == raised_by).unwrap();
    assert_eq!(origin.facet, BASE_INTERFACE);
    assert_eq!(unmet[0].section, "interface");
    assert!(unmet[0].detail.contains("provides"), "{}", unmet[0].detail);
}

// -------------------------------------------------------------- the verdict

#[test]
fn a_fully_interpreted_design_with_no_defect_is_coherent() {
    let (_, _, report) = run(&clean_artifact());
    assert_eq!(report.state, State::Coherent, "{:?}", report.findings);
    assert!(report.findings.is_empty(), "{:?}", report.findings);
    assert_eq!(report.version, findings::REPORT_VERSION);
    assert_eq!(report.source, BASE);
}

#[test]
fn an_unresolved_promise_is_loose_and_a_contradiction_is_disjoint() {
    let (_, _, loose) = run(&format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    ));
    assert_eq!(loose.state, State::Loose);

    let (_, _, disjoint) = run(&format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"provides\" \"value\" \"required\" \"false\")\n"
    ));
    assert_eq!(disjoint.state, State::Disjoint, "{:?}", disjoint.findings);
}

#[test]
fn a_design_with_no_findings_still_reports_what_was_checked() {
    let (_, _, report) = run(&clean_artifact());
    assert!(report.findings.is_empty());
    assert!(!report.identity.export_digest.is_empty());
    assert!(!report.identity.guidance_fingerprint.is_empty());
    assert_eq!(report.identity.interpretations, vec!["artifact-digest"]);
    assert!(report.iterations > 0, "saturation ran");
}

// ------------------------------------------------------------ reproducibility

#[test]
fn the_same_design_and_interpretation_produce_an_identical_report() {
    let artifact = clean_artifact();
    let (_, _, first) = run(&artifact);
    let (_, _, second) = run(&artifact);
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&second).unwrap(),
        "two runs of the same inputs must diff clean"
    );
}

#[test]
fn the_recorded_identity_distinguishes_a_stale_report() {
    let (_, _, report) = run(&clean_artifact());
    let mut stale = report.clone();
    stale.identity.guidance_fingerprint.push('x');
    assert_ne!(
        serde_json::to_vec(&report).unwrap(),
        serde_json::to_vec(&stale).unwrap()
    );

    let mut other_artifact = report.clone();
    other_artifact.identity.interpretations = vec!["different".into()];
    assert_ne!(
        report.identity.interpretations, other_artifact.identity.interpretations,
        "every supplied interpretation is part of the report's identity"
    );
}

// ------------------------------------------------------------------- storage

#[test]
fn the_report_is_written_to_the_store_this_component_owns() {
    let workspace = Workspace::new();
    let (_, _, report) = run(&clean_artifact());
    let path = findings::write(&report, &workspace.0).unwrap();
    assert!(path.starts_with(workspace.0.join(findings::STORE)));
    let round_tripped: Report = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(round_tripped, report);
}

#[test]
fn a_run_never_writes_into_the_compilers_world_cache() {
    let workspace = Workspace::new();
    let worlds = workspace.0.join(".sigil/worlds");
    fs::create_dir_all(&worlds).unwrap();
    fs::write(worlds.join("index.json"), b"{\"compiler\":\"owned\"}").unwrap();

    let (_, _, report) = run(&clean_artifact());
    findings::write(&report, &workspace.0).unwrap();

    assert_eq!(
        fs::read_to_string(worlds.join("index.json")).unwrap(),
        "{\"compiler\":\"owned\"}",
        "the compiler's cache must be untouched"
    );
    assert_eq!(
        fs::read_dir(&worlds).unwrap().count(),
        1,
        "nothing new appeared in the compiler's cache"
    );
    assert_ne!(findings::STORE, ".sigil/worlds");
}

// ------------------------------------------------ repeat interpretation (U8)

/// Admit a second artifact against the same request, as a repeat run does.
fn admit_against(request: &Request, artifact: &str) -> Vec<Fact> {
    let input = shared_input();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    identity::admit(request, &input, &rows).unwrap()
}

#[test]
fn two_identical_interpretations_disagree_about_nothing() {
    let (request, facts, _) = run(&clean_artifact());
    let repeat = admit_against(&request, &clean_artifact());
    assert_eq!(facts, repeat, "the same artifact admits identically");
    assert!(findings::disagreements(&facts, &repeat).is_empty());
}

#[test]
fn one_differing_claim_is_reported_against_the_facet_it_came_from() {
    let (request, first, _) = run(&clean_artifact());
    let changed = format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    );
    let repeat = admit_against(&request, &changed);
    let disagreements = findings::disagreements(&first, &repeat);
    assert_eq!(disagreements.len(), 2, "{disagreements:?}");
    for entry in &disagreements {
        assert_eq!(entry.facet, BASE_INTERFACE, "{entry:?}");
        assert_eq!(entry.section, "interface");
        assert!(entry.detail.contains("unstable"), "{}", entry.detail);
    }
    let sides: Vec<&str> = disagreements.iter().map(|d| d.only_in.as_str()).collect();
    assert!(
        sides.contains(&"first") && sides.contains(&"repeat"),
        "{sides:?}"
    );
}

#[test]
fn a_facet_only_the_repeat_read_is_a_disagreement_and_still_a_gap() {
    // The first interpretation stays the sole basis for the computed report, so
    // the gap it produced is not suppressed by the comparison.
    let first_artifact = format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    );
    let (request, first, mut report) = run(&first_artifact);
    assert!(
        report
            .findings
            .iter()
            .any(|f| f.law == "uninterpreted-section" && f.object == "goal"),
        "{:?}",
        report.findings
    );

    let repeat = admit_against(
        &request,
        &format!(
            "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (reading {BASE_GOAL:?} \"no-commitment\")\n"
        ),
    );
    let disagreements = findings::disagreements(&first, &repeat);
    assert_eq!(disagreements.len(), 1, "{disagreements:?}");
    assert_eq!(disagreements[0].facet, BASE_GOAL);
    assert_eq!(disagreements[0].only_in, "repeat");

    findings::attach(&mut report, disagreements);
    assert!(
        report
            .findings
            .iter()
            .any(|f| f.law == "uninterpreted-section" && f.object == "goal"),
        "the comparison must not suppress the first run's gap: {:?}",
        report.findings
    );
}

#[test]
fn the_comparison_is_absent_unless_a_second_artifact_was_supplied() {
    let (request, first, report) = run(&clean_artifact());
    assert!(
        report.disagreements.is_none(),
        "an opt-in comparison costs a full extra interpretation"
    );
    let serialized = serde_json::to_string(&report).unwrap();
    assert!(!serialized.contains("disagreements"), "{serialized}");

    let repeat = admit_against(&request, &clean_artifact());
    let mut with = report.clone();
    findings::attach(&mut with, findings::disagreements(&first, &repeat));
    assert_eq!(with.disagreements, Some(Vec::new()));
    assert!(
        serde_json::to_string(&with)
            .unwrap()
            .contains("disagreements")
    );
}

#[test]
fn supplying_a_second_artifact_changes_the_recorded_report_identity() {
    let (_, _, one) = run(&clean_artifact());
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
    let rows = dialect::parse(&clean_artifact(), Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &input, &facts, eqval::Limits::default()).unwrap();
    let two = findings::report(
        &request,
        &facts,
        &world,
        &["artifact-digest".into(), "repeat-digest".into()],
    );
    assert_ne!(
        one.identity.interpretations, two.identity.interpretations,
        "every supplied interpretation is part of what the report was computed from"
    );
    assert_eq!(two.identity.interpretations.len(), 2);
}
