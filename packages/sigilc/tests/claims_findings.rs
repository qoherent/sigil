use sigilc::{
    claims::{
        dialect::{self, Limits},
        findings::{self, Class, Report, State},
        identity::{self, Fact},
        prepare::{self, Request},
        program,
    },
    eqval,
};
use std::fs;

mod support;
use support::{
    BASE, BASE_CONSTRAINTS, BASE_GOAL, BASE_INTERFACE, CONSUMER, Workspace, shared_input,
};

const BASE_ID: &str = "urn:sigil:component:base.sigil:Base";

/// The whole path: project, read the artifact, admit, saturate, report.
fn run(artifact: &str) -> (Request, Vec<Fact>, Report) {
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &facts, eqval::Limits::default()).unwrap();
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
    let world = program::saturate(&request, &facts, eqval::Limits::default()).unwrap();
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

// ------------------------------------------------- flow findings (U6)

/// A one-component export with a Logic section, since base.sigil has none.
fn flow_design(paragraphs: &[&str]) -> (sigilc::frontend::DesignInput, Vec<String>) {
    use serde_json::{Value, json};
    let path = "flow.sigil";
    let mut text = String::from("component Flow {\n  logic {\n");
    let mut spans = Vec::new();
    for p in paragraphs {
        let at = text.len() + 4;
        text.push_str(&format!("    {p}\n"));
        spans.push((at, at + p.len()));
    }
    text.push_str("  }\n  constraints {\n");
    let guard_at = text.len() + 4;
    text.push_str("    a stated constraint\n");
    let guard_span = (guard_at, guard_at + "a stated constraint".len());
    text.push_str("  }\n}\n");
    let id = format!("urn:sigil:component:{path}:Flow");
    let units: Vec<Value> = spans
        .iter()
        .map(|(s, e)| {
            json!({"id": format!("facet:{path}:{s}"), "source": path, "owner": id,
                   "section": "logic", "range": {"start": s, "end": e},
                   "proseRange": {"start": s, "end": e}, "grouping": null,
                   "introductions": [], "references": [], "links": [], "payload": null,
                   "valid": true, "complete": true})
        })
        .collect();
    let mut units = units;
    units.push(
        json!({"id": format!("facet:{path}:{}", guard_span.0), "source": path,
        "owner": id, "section": "constraints",
        "range": {"start": guard_span.0, "end": guard_span.1},
        "proseRange": {"start": guard_span.0, "end": guard_span.1}, "grouping": null,
        "introductions": [], "references": [], "links": [], "payload": null,
        "valid": true, "complete": true}),
    );
    // Logic Facets first, then the constraints Facet, so callers index by order.
    let mut facets: Vec<String> = spans
        .iter()
        .map(|(s, _)| format!("facet:{path}:{s}"))
        .collect();
    facets.push(format!("facet:{path}:{}", guard_span.0));
    let input = sigilc::frontend::DesignInput::parse(
        &serde_json::to_vec(&json!({
            "schemaVersion": 2, "languageVersion": "0.8.0", "frontendVersion": "test",
            "sources": [{"path": path, "text": text}],
            "context": [
                {"path": ".sigil/config.json", "text": "{\"sigilVersion\":\"0.8.0\"}"},
                {"path": ".sigil/local.json", "text": null},
                {"path": ".sigil/glossary.json", "text": null}
            ],
            "diagnostics": [], "entities": [json!({
                "id": id, "type": "Component", "label": "Flow", "source": path, "owner": null,
                "range": {"start": 0, "end": text.len()}, "nameRange": {"start": 10, "end": 14},
                "identityResolved": true, "valid": true, "complete": true})],
            "units": units, "imports": [], "groups": [], "introductions": [],
            "references": [], "links": []
        }))
        .unwrap(),
    )
    .unwrap();
    (input, facets)
}

fn run_flow(paragraphs: &[&str], artifact: &str) -> Report {
    let (input, _) = flow_design(paragraphs);
    let request = prepare::project(&input, "flow.sigil").unwrap();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &facts, eqval::Limits::default()).unwrap();
    findings::report(&request, &facts, &world, &["artifact-digest".into()])
}

#[test]
fn a_dead_end_step_is_reported_and_does_not_fail_the_build() {
    let (_, f) = flow_design(&["first", "second"]);
    let report = run_flow(
        &["first", "second"],
        &format!(
            "(step {0:?} \"1\")\n(step {1:?} \"2\")\n\
             (claim {1:?} \"step:2\" \"to\" \"graph\" \"required\" \"true\")\n",
            f[0], f[1]
        ),
    );
    let flow: Vec<&findings::Finding> = report
        .findings
        .iter()
        .filter(|x| x.class == findings::Class::Flow)
        .collect();
    assert_eq!(flow.len(), 1, "step 1 leads nowhere; step 2 ends the flow");
    assert_eq!(flow[0].law, "unreached-step");
    assert!(!flow[0].subject.is_empty(), "the finding names the step");
    assert_eq!(flow[0].section, "logic", "and where it was authored");

    // The whole point of the class: a misreading of prose must not fail a build.
    assert_ne!(
        report.state,
        findings::State::Disjoint,
        "a dead-end step rests on a model's reading and cannot gate"
    );
}

#[test]
fn a_dead_end_does_not_mask_a_real_contradiction() {
    let (_, f) = flow_design(&["first", "second"]);
    let report = run_flow(
        &["first", "second"],
        &format!(
            "(step {0:?} \"1\")\n\
             (claim {1:?} \"Flow\" \"provides\" \"Flow\" \"required\" \"true\")\n",
            f[0], f[2]
        ),
    );
    assert!(
        report
            .findings
            .iter()
            .any(|x| x.class == findings::Class::Flow),
        "the dead end is still reported"
    );
    assert!(
        report
            .findings
            .iter()
            .any(|x| x.class == findings::Class::Interpretation),
        "and the degenerate claim alongside it"
    );
}

#[test]
fn a_suppressed_graph_says_so_rather_than_only_flagging_a_row() {
    let (_, f) = flow_design(&["first", "second"]);
    // A degenerate claim authored in a Logic Facet: its subject and object
    // coincide, so it asserts nothing, and a defective row suppresses its
    // whole graph rather than being dropped alone.
    let report = run_flow(
        &["first", "second"],
        &format!(
            "(step {0:?} \"1\")\n\
             (claim {0:?} \"Flow\" \"provides\" \"Flow\" \"required\" \"true\")\n",
            f[0]
        ),
    );
    let laws: Vec<&str> = report.findings.iter().map(|x| x.law.as_str()).collect();
    assert!(
        laws.contains(&"suppressed-graph"),
        "a reader learns the check did not run, not only that a row was flagged: {laws:?}"
    );
    assert!(
        !laws.contains(&"unreached-step"),
        "and no dead end is manufactured while it is suppressed: {laws:?}"
    );
}

#[test]
fn two_runs_over_one_unchanged_interpretation_report_identically() {
    let artifact = {
        let (_, f) = flow_design(&["first", "second"]);
        format!(
            "(step {0:?} \"1\")\n(step {1:?} \"2\")\n\
             (claim {0:?} \"step:1\" \"to\" \"step:2\" \"required\" \"true\")\n\
             (claim {1:?} \"step:2\" \"to\" \"graph\" \"required\" \"true\")\n",
            f[0], f[1]
        )
    };
    let a = run_flow(&["first", "second"], &artifact);
    let b = run_flow(&["first", "second"], &artifact);
    assert_eq!(a.findings, b.findings);
    assert_eq!(a.state, b.state);
    assert_eq!(a.version, 2, "the report version moved with the new class");
}

#[test]
fn a_dependencys_uninterpreted_role_is_never_this_sources_gap() {
    // The request presents the whole resolved closure so a claim in one
    // component can be checked against a flow graph in a component it depends
    // on. Coverage is a different question, and stays the selected source's:
    // answering only your own source must not report a gap for every role in
    // every dependency.
    let input = shared_input();
    let request = prepare::project(&input, CONSUMER).unwrap();
    assert!(
        request.rows.iter().any(|r| r.source == BASE),
        "precondition: the dependency's Facets are presented"
    );

    // Answer nothing at all. Every gap reported must belong to CONSUMER.
    let gaps = identity::uninterpreted(&request, &[]);
    assert!(!gaps.is_empty(), "the selected source's own roles are gaps");
    for (component, _) in &gaps {
        assert!(
            request
                .rows
                .iter()
                .any(|r| &r.component == component && r.source == CONSUMER),
            "{component} is reported as a gap but authored nothing in {CONSUMER}"
        );
    }
}

#[test]
fn a_facet_whose_only_interpretation_is_a_step_is_not_a_gap() {
    // A flow spans a section, so a Facet may contribute nothing but one step of
    // it. That is an interpretation of that Facet, not silence.
    let (_, f) = flow_design(&["first", "second"]);
    let report = run_flow(
        &["first", "second"],
        &format!(
            "(step {0:?} \"1\")\n(step {1:?} \"2\")\n\
             (claim {1:?} \"step:2\" \"to\" \"graph\" \"required\" \"true\")\n\
             (reading {2:?} \"no-commitment\")\n",
            f[0], f[1], f[2]
        ),
    );
    assert!(
        !report
            .findings
            .iter()
            .any(|x| x.law == "uninterpreted-section"),
        "every Facet contributed: two steps and a reading row. Findings: {:?}",
        report.findings.iter().map(|x| &x.law).collect::<Vec<_>>()
    );
}

#[test]
fn a_dependencys_finding_is_not_repeated_in_its_dependents_report() {
    // The closure is presented whole, so a dependency's Facets reach this run.
    // Its findings belong to its own run, not to every dependent's.
    let input = shared_input();
    let request = prepare::project(&input, CONSUMER).unwrap();
    let base_facet = request
        .rows
        .iter()
        .find(|r| r.source == BASE)
        .unwrap()
        .facet
        .clone();

    // A degenerate claim authored in the dependency's Facet.
    let artifact =
        format!("(claim {base_facet:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n");
    let rows = dialect::parse(&artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &facts, eqval::Limits::default()).unwrap();
    let report = findings::report(&request, &facts, &world, &["d".into()]);

    assert!(
        !report.findings.iter().any(|f| f.law == "degenerate-claim"),
        "the defect is in {BASE}, so {BASE}'s own run reports it: {:?}",
        report.findings.iter().map(|f| &f.law).collect::<Vec<_>>()
    );

    // And the same interpretation, run against the source that authored it,
    // does report it.
    let own = prepare::project(&input, BASE).unwrap();
    let facts = identity::admit(&own, &input, &rows).unwrap();
    let world = program::saturate(&own, &facts, eqval::Limits::default()).unwrap();
    let report = findings::report(&own, &facts, &world, &["d".into()]);
    assert!(
        report.findings.iter().any(|f| f.law == "degenerate-claim"),
        "a finding must be reported by the run that owns it"
    );
}

// ------------------------------- flow rows in the repeat comparison (U8)

fn admit_flow(paragraphs: &[&str], artifact: &str) -> (Request, Vec<Fact>) {
    let (input, _) = flow_design(paragraphs);
    let request = prepare::project(&input, "flow.sigil").unwrap();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    (request, facts)
}

#[test]
fn two_readings_differing_in_one_edge_disagree_about_that_facet_only() {
    let (_, f) = flow_design(&["first", "second"]);
    let base = format!(
        "(step {0:?} \"1\")\n(step {1:?} \"2\")\n\
         (claim {1:?} \"step:2\" \"to\" \"graph\" \"required\" \"true\")\n",
        f[0], f[1]
    );
    let (_, first) = admit_flow(&["first", "second"], &base);
    let (_, repeat) = admit_flow(
        &["first", "second"],
        &format!(
            "{base}(claim {0:?} \"step:1\" \"to\" \"step:2\" \"required\" \"true\")\n",
            f[0]
        ),
    );

    let out = findings::disagreements(&first, &repeat);
    assert_eq!(
        out.len(),
        1,
        "one edge differs, so one disagreement: {out:?}"
    );
    assert_eq!(
        out[0].facet, f[0],
        "named by the Facet the edge was authored in"
    );
    assert_eq!(out[0].only_in, "repeat");
}

#[test]
fn two_identical_readings_carrying_graph_rows_disagree_about_nothing() {
    let (_, f) = flow_design(&["first"]);
    let artifact = format!(
        "(step {0:?} \"1\")\n(claim {0:?} \"step:1\" \"to\" \"graph\" \"required\" \"true\")\n",
        f[0]
    );
    let (_, a) = admit_flow(&["first"], &artifact);
    let (_, b) = admit_flow(&["first"], &artifact);
    assert!(findings::disagreements(&a, &b).is_empty());
}

#[test]
fn a_second_reading_suppresses_no_finding_from_the_first() {
    let (_, f) = flow_design(&["first", "second"]);
    let first_text = format!(
        "(step {0:?} \"1\")\n(step {1:?} \"2\")\n\
         (claim {1:?} \"step:2\" \"to\" \"graph\" \"required\" \"true\")\n",
        f[0], f[1]
    );
    let report = run_flow(&["first", "second"], &first_text);
    assert!(
        report.findings.iter().any(|x| x.law == "unreached-step"),
        "precondition: the first reading leaves step 1 dangling"
    );

    // A repeat that happens to fix the edge must not erase the first's finding.
    let (_, first) = admit_flow(&["first", "second"], &first_text);
    let (_, repeat) = admit_flow(
        &["first", "second"],
        &format!(
            "{first_text}(claim {0:?} \"step:1\" \"to\" \"step:2\" \"required\" \"true\")\n",
            f[0]
        ),
    );
    let mut report = report;
    findings::attach(&mut report, findings::disagreements(&first, &repeat));
    assert!(
        report.findings.iter().any(|x| x.law == "unreached-step"),
        "the first interpretation remains the sole basis for findings"
    );
    assert!(
        report.disagreements.is_some(),
        "and the comparison is reported beside it"
    );
}

#[test]
fn a_repeat_that_splits_one_step_in_two_disagrees_in_bounded_fashion() {
    // Step position lives inside the compared body, so a granularity
    // difference shifts every later position. Pinned here deliberately: this
    // is the ordinary variance between two model runs over the same prose, and
    // the size of the report is what a reader has to live with.
    let (_, f) = flow_design(&["first", "second"]);
    let (_, first) = admit_flow(
        &["first", "second"],
        &format!("(step {0:?} \"1\")\n(step {1:?} \"2\")\n", f[0], f[1]),
    );
    let (_, repeat) = admit_flow(
        &["first", "second"],
        &format!(
            "(step {0:?} \"1\")\n(step {0:?} \"2\")\n(step {1:?} \"3\")\n",
            f[0], f[1]
        ),
    );
    let out = findings::disagreements(&first, &repeat);
    let facets: std::collections::BTreeSet<&str> = out.iter().map(|d| d.facet.as_str()).collect();
    assert_eq!(
        out.len(),
        3,
        "the added step, and the renumbered one in each direction: {out:?}"
    );
    assert_eq!(
        facets.len(),
        2,
        "both Facets are named, because the renumbering crosses them"
    );
}

#[test]
fn a_logic_facet_yielding_only_graph_rows_is_interpreted() {
    let (_, f) = flow_design(&["first"]);
    let report = run_flow(
        &["first"],
        &format!(
            "(step {0:?} \"1\")\n(claim {0:?} \"step:1\" \"to\" \"graph\" \"required\" \"true\")\n\
             (reading {1:?} \"no-commitment\")\n",
            f[0], f[1]
        ),
    );
    assert!(
        !report
            .findings
            .iter()
            .any(|x| x.law == "uninterpreted-section"),
        "graph rows are an interpretation of the Facet that authored them"
    );
}
