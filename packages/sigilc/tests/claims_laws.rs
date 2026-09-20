use serde_json::Value;
use sigilc::{
    claims::{
        identity::{Body, Fact},
        prepare::{AdmissibleEntity, Binding, FacetRow, Request},
        program::{self, Saturated},
    },
    eqval,
};

mod support;

const SRC: &str = "d.sigil";
const A: &str = "urn:e:A";
const B: &str = "urn:e:B";
const CAP: &str = "urn:e:cap";

/// A design whose Facets can carry any contract role, so the section gate can
/// be exercised directly. Admission is covered separately.
fn request(roles: &[(&str, &str, &str)]) -> Request {
    let rows: Vec<FacetRow> = roles
        .iter()
        .map(|(facet, component, section)| FacetRow {
            facet: (*facet).to_string(),
            component: (*component).to_string(),
            component_label: (*component).to_string(),
            section: (*section).to_string(),
            source: SRC.to_string(),
            prose: "prose".to_string(),
        })
        .collect();
    let mut declared: Vec<(String, String)> = rows
        .iter()
        .map(|r| (r.component.clone(), r.section.clone()))
        .collect();
    declared.sort();
    declared.dedup();
    Request {
        binding: Binding {
            format: 1,
            source: SRC.to_string(),
            export_digest: "digest".into(),
            guidance_fingerprint: "guidance".into(),
            vocabulary_generation: 1,
            closure: vec![SRC.to_string()],
            facets: rows.iter().map(|r| r.facet.clone()).collect(),
        },
        rows,
        flows: Vec::new(),
        entities: vec![
            entity(A, "Component", None),
            entity(B, "Component", None),
            entity(CAP, "Tag", Some(A)),
        ],
        declared,
    }
}

fn entity(id: &str, kind: &str, owner: Option<&str>) -> AdmissibleEntity {
    AdmissibleEntity {
        id: id.to_string(),
        kind: kind.to_string(),
        label: id.to_string(),
        owner: owner.map(str::to_string),
        source: SRC.to_string(),
    }
}

fn claim(
    facet: &str,
    section: &str,
    subject: &str,
    relation: &str,
    object: &str,
    modality: &str,
    expected: &str,
) -> Fact {
    fact(
        facet,
        section,
        Body::Claim {
            subject: subject.into(),
            relation: relation.into(),
            object: object.into(),
            modality: modality.into(),
            expected: expected.into(),
        },
    )
}

fn property(facet: &str, section: &str, subject: &str, property: &str, value: &str) -> Fact {
    fact(
        facet,
        section,
        Body::Property {
            subject: subject.into(),
            property: property.into(),
            value: value.into(),
        },
    )
}

fn fact(facet: &str, section: &str, body: Body) -> Fact {
    // A distinct, stable identity per body; the real minting is tested in U4.
    let id = sigilc::sources::hash(
        &serde_json::to_vec(&(facet, section, &body)).expect("serialization"),
    );
    Fact {
        id,
        facet: facet.to_string(),
        component: A.to_string(),
        section: section.to_string(),
        body,
        defects: Vec::new(),
    }
}

fn run(request: &Request, facts: &[Fact]) -> Saturated {
    program::saturate(request, facts, eqval::Limits::default()).unwrap()
}

fn cell(row: &[Value], index: usize) -> &str {
    row[index].as_str().unwrap_or_default()
}

// --------------------------------------------------------- the section column

#[test]
fn an_evaluated_claim_carries_the_role_the_export_assigned_it() {
    let req = request(&[("f1", A, "goal")]);
    let world = run(
        &req,
        &[claim("f1", "goal", A, "provides", CAP, "required", "true")],
    );
    let claims = world.table("claim");
    assert_eq!(claims.len(), 1);
    assert_eq!(cell(&claims[0], 2), "goal", "role column: {:?}", claims[0]);
    assert_eq!(cell(&claims[0], 1), "f1");
}

// ------------------------------------------------------------- contradictions

#[test]
fn a_relation_asserted_and_negated_produces_a_contradiction_naming_both_claims() {
    let req = request(&[("f1", A, "interface"), ("f2", A, "constraints")]);
    let yes = claim("f1", "interface", A, "provides", CAP, "required", "true");
    let no = claim("f2", "constraints", A, "provides", CAP, "required", "false");
    let world = run(&req, &[yes.clone(), no.clone()]);

    let cited: Vec<&str> = world
        .table("violation")
        .iter()
        .filter(|r| cell(r, 0) == "contradictory-claims")
        .map(|r| cell(r, 3))
        .collect();
    assert!(cited.contains(&yes.id.as_str()), "got {cited:?}");
    assert!(cited.contains(&no.id.as_str()), "got {cited:?}");

    // The negated claim also collides with the relation actually holding.
    assert!(
        world
            .table("violation")
            .iter()
            .any(|r| cell(r, 0) == "negated-claim-holds" && cell(r, 3) == no.id),
        "{:?}",
        world.table("violation")
    );
}

#[test]
fn a_prohibition_contradicted_by_a_capability_is_a_violation() {
    let req = request(&[("f1", A, "constraints"), ("f2", A, "interface")]);
    let world = run(
        &req,
        &[
            claim("f1", "constraints", A, "excludes", CAP, "required", "true"),
            claim("f2", "interface", A, "provides", CAP, "required", "true"),
        ],
    );
    assert!(
        world
            .table("violation")
            .iter()
            .any(|r| cell(r, 0) == "excluded-capability"),
        "{:?}",
        world.table("violation")
    );
}

#[test]
fn two_claims_disagreeing_about_a_property_conflict() {
    let req = request(&[("f1", A, "state"), ("f2", A, "constraints")]);
    let world = run(
        &req,
        &[
            property("f1", "state", CAP, "exclusive", "true"),
            property("f2", "constraints", CAP, "exclusive", "false"),
        ],
    );
    assert!(
        world
            .table("violation")
            .iter()
            .any(|r| cell(r, 0) == "conflicting-property"),
        "{:?}",
        world.table("violation")
    );
}

// --------------------------------------------------------- ownership conflicts

#[test]
fn two_owners_of_exclusive_state_produce_an_ownership_conflict() {
    let req = request(&[
        ("f1", A, "state"),
        ("f2", A, "logic"),
        ("f3", A, "interface"),
    ]);
    let world = run(
        &req,
        &[
            property("f1", "state", CAP, "exclusive", "true"),
            claim("f2", "logic", A, "owns", CAP, "required", "true"),
            claim("f3", "interface", B, "owns", CAP, "required", "true"),
        ],
    );
    let conflicts: Vec<_> = world
        .table("violation")
        .iter()
        .filter(|r| cell(r, 0) == "exclusive-ownership")
        .cloned()
        .collect();
    assert!(!conflicts.is_empty(), "{:?}", world.table("violation"));
    let owners: Vec<&str> = conflicts.iter().map(|r| cell(r, 1)).collect();
    assert!(owners.contains(&A) && owners.contains(&B), "got {owners:?}");
}

#[test]
fn a_single_owner_of_exclusive_state_is_not_a_conflict() {
    let req = request(&[("f1", A, "state"), ("f2", A, "logic")]);
    let world = run(
        &req,
        &[
            property("f1", "state", CAP, "exclusive", "true"),
            claim("f2", "logic", A, "owns", CAP, "required", "true"),
        ],
    );
    assert!(
        !world
            .table("violation")
            .iter()
            .any(|r| cell(r, 0) == "exclusive-ownership"),
        "{:?}",
        world.table("violation")
    );
}

// ------------------------------------------------------------------ modality

#[test]
fn a_required_need_nothing_provides_is_unmet_and_a_permitted_one_is_not() {
    let req = request(&[("f1", A, "interface")]);
    let required = run(
        &req,
        &[claim(
            "f1",
            "interface",
            A,
            "requires",
            CAP,
            "required",
            "true",
        )],
    );
    assert_eq!(
        required.table("unmet-obligation").len(),
        1,
        "{:?}",
        required.table("unmet-obligation")
    );

    let permitted = run(
        &req,
        &[claim(
            "f1",
            "interface",
            A,
            "requires",
            CAP,
            "permitted",
            "true",
        )],
    );
    assert!(
        permitted.table("unmet-obligation").is_empty(),
        "a permitted need obliges nobody: {:?}",
        permitted.table("unmet-obligation")
    );
}

#[test]
fn an_assumption_is_unmet_until_something_commits_to_it() {
    let req = request(&[("f1", A, "decisions"), ("f2", A, "interface")]);
    // An assumption in a committing role, alone.
    let alone = run(
        &req,
        &[claim(
            "f2",
            "interface",
            A,
            "dependsOn",
            B,
            "assumed",
            "true",
        )],
    );
    assert_eq!(alone.table("unmet-obligation").len(), 1);
    assert!(
        alone.table("holds").is_empty(),
        "an assumption is not a commitment: {:?}",
        alone.table("holds")
    );

    // Now something authors it.
    let met = run(
        &req,
        &[
            claim("f2", "interface", A, "dependsOn", B, "assumed", "true"),
            claim("f2", "interface", A, "dependsOn", B, "required", "true"),
        ],
    );
    assert!(
        met.table("unmet-obligation").is_empty(),
        "{:?}",
        met.table("unmet-obligation")
    );
}

// ---------------------------------------------------------------- delegation

#[test]
fn an_obligation_met_through_a_dependency_is_not_reported_unmet() {
    // Proves diagnostics reads absence only after the closure stopped growing:
    // the satisfying fact is derived, not asserted.
    let req = request(&[("f1", A, "interface"), ("f2", B, "interface")]);
    let world = run(
        &req,
        &[
            claim("f1", "interface", A, "requires", CAP, "required", "true"),
            claim("f1", "interface", A, "dependsOn", B, "required", "true"),
            claim("f2", "interface", B, "provides", CAP, "required", "true"),
        ],
    );
    assert!(
        world.table("unmet-obligation").is_empty(),
        "delegation reaches: {:?}",
        world.table("unmet-obligation")
    );
    assert!(
        world.table("reachable").iter().any(|r| cell(r, 0) == A),
        "{:?}",
        world.table("reachable")
    );
}

#[test]
fn a_delegated_capability_is_derived_with_its_law_named() {
    let req = request(&[("f1", A, "interface"), ("f2", B, "interface")]);
    let world = run(
        &req,
        &[
            claim("f1", "interface", A, "delegates", B, "required", "true"),
            claim("f2", "interface", B, "provides", CAP, "required", "true"),
        ],
    );
    assert!(
        world
            .table("holds")
            .iter()
            .any(|r| cell(r, 0) == A && cell(r, 1) == "provides" && cell(r, 2) == CAP),
        "{:?}",
        world.table("holds")
    );
    assert!(
        world
            .table("because")
            .iter()
            .any(|r| cell(r, 3) == "delegated-capability" && cell(r, 4) == B),
        "every derived conclusion names its law and witness: {:?}",
        world.table("because")
    );
}

// ------------------------------------------------------------ the role gate

#[test]
fn the_same_claim_obliges_from_constraints_and_obliges_nothing_from_decisions() {
    // KTD7. This is the law the compiler could not express.
    let binding = claim("f1", "constraints", A, "requires", CAP, "required", "true");
    let rationale = claim("f2", "decisions", A, "requires", CAP, "required", "true");

    let bound = run(&request(&[("f1", A, "constraints")]), &[binding]);
    assert_eq!(
        bound.table("unmet-obligation").len(),
        1,
        "Constraints binds: {:?}",
        bound.table("unmet-obligation")
    );

    let considered = run(
        &request(&[("f2", A, "decisions")]),
        std::slice::from_ref(&rationale),
    );
    assert!(
        considered.table("unmet-obligation").is_empty(),
        "rationale obliges nobody: {:?}",
        considered.table("unmet-obligation")
    );
    assert!(
        considered.table("holds").is_empty(),
        "rationale commits to nothing: {:?}",
        considered.table("holds")
    );
    assert!(
        considered.table("violation").is_empty(),
        "rationale cannot contradict: {:?}",
        considered.table("violation")
    );
    // But it is retained and reportable.
    assert!(
        considered
            .table("claim")
            .iter()
            .any(|r| cell(r, 0) == rationale.id),
        "a rejected alternative stays visible: {:?}",
        considered.table("claim")
    );
}

#[test]
fn a_rejected_alternative_cannot_contradict_a_live_commitment() {
    let req = request(&[("f1", A, "interface"), ("f2", A, "decisions")]);
    let world = run(
        &req,
        &[
            claim("f1", "interface", A, "provides", CAP, "required", "true"),
            claim("f2", "decisions", A, "provides", CAP, "required", "false"),
        ],
    );
    assert!(
        world.table("violation").is_empty(),
        "considering and rejecting an option is not a contradiction: {:?}",
        world.table("violation")
    );
}

#[test]
fn the_committing_roles_are_every_role_except_decisions() {
    assert_eq!(program::NON_COMMITTING, &["decisions"]);
    assert!(!program::commits("decisions"));
    for section in [
        "goal",
        "interface",
        "state",
        "logic",
        "constraints",
        "cases",
    ] {
        assert!(program::commits(section), "{section} must commit");
    }
}

// ------------------------------------------------------------- housekeeping

#[test]
fn saturation_is_deterministic_and_reports_its_guidance_identity() {
    let req = request(&[("f1", A, "interface")]);
    let facts = [claim(
        "f1",
        "interface",
        A,
        "provides",
        CAP,
        "required",
        "true",
    )];
    let first = run(&req, &facts);
    let second = run(&req, &facts);
    assert_eq!(first.tables, second.tables);
    assert_eq!(
        first.guidance_fingerprint,
        sigilc::claims::guidance::fingerprint()
    );
}

#[test]
fn a_reading_row_reaches_the_world_without_deriving_anything() {
    let req = request(&[("f1", A, "decisions")]);
    let world = run(
        &req,
        &[fact(
            "f1",
            "decisions",
            Body::Reading {
                outcome: "no-commitment".into(),
            },
        )],
    );
    assert_eq!(world.table("reading").len(), 1);
    assert!(world.table("holds").is_empty());
    assert!(world.table("obligation").is_empty());
}

#[test]
fn the_same_proposition_in_two_facets_is_offered_as_a_simplification_candidate() {
    let req = request(&[("f1", A, "interface"), ("f2", A, "logic")]);
    let world = run(
        &req,
        &[
            claim("f1", "interface", A, "provides", CAP, "required", "true"),
            claim("f2", "logic", A, "provides", CAP, "required", "true"),
        ],
    );
    assert!(
        !world.table("duplicate-proposition").is_empty(),
        "a candidate, not a verdict: {:?}",
        world.table("duplicate-proposition")
    );
}

#[test]
fn the_emitted_program_carries_the_laws_and_only_parsed_values() {
    let req = request(&[("f1", A, "interface")]);
    let facts = [claim(
        "f1",
        "interface",
        A,
        "provides",
        CAP,
        "required",
        "true",
    )];
    let text = program::program(&req, &facts);
    assert!(text.contains("(ruleset closure)"));
    assert!(text.contains("(commits \"interface\")"));
    assert!(
        !text.contains("(commits \"decisions\")"),
        "the role gate must be visible in the data"
    );
    assert!(text.contains(&format!("(facet \"f1\" {A:?}")));
}

// ------------------------------------------------- ungrounded claims (P0 fix)

#[test]
fn an_ungrounded_claim_cannot_manufacture_a_violation_against_an_unrelated_entity() {
    // A claim naming an entity the Facet never grounds is flagged Ungrounded by
    // identity::admit (tested in claims_dialect.rs), but must not be allowed to
    // reach saturation and forge a contradiction, ownership conflict, or
    // obligation the design never actually stated. Constructed directly with a
    // defect, mirroring how admit() would have flagged it, since this test
    // targets the saturation boundary rather than the grounding check itself.
    let req = request(&[("f1", A, "interface"), ("f2", A, "constraints")]);

    let mut forged = claim("f1", "interface", A, "provides", CAP, "required", "true");
    forged.defects = vec![sigilc::claims::identity::Defect::Ungrounded(
        CAP.to_string(),
    )];
    let real = claim("f2", "constraints", A, "provides", CAP, "required", "false");

    let world = run(&req, &[forged.clone(), real.clone()]);
    assert!(
        world.table("violation").is_empty(),
        "a defect-carrying claim must not reach the program at all: {:?}",
        world.table("violation")
    );
    assert!(
        world.table("holds").is_empty(),
        "the forged claim must not contribute to holds either: {:?}",
        world.table("holds")
    );

    // The real claim, on its own, still contradicts nothing — proving the
    // absence above is because the forged claim was excluded, not because the
    // scenario itself is contradiction-free.
    let alone = run(&req, std::slice::from_ref(&real));
    assert!(alone.table("violation").is_empty());

    // The emitted program text itself must never mention the forged claim's id.
    let text = program::program(&req, &[forged.clone(), real]);
    assert!(
        !text.contains(&forged.id),
        "a defect-carrying fact must not appear in the saturated program at all"
    );
}

#[test]
fn a_defect_carrying_property_or_measure_is_also_excluded_from_the_program() {
    let req = request(&[("f1", A, "state")]);
    let mut prop = property("f1", "state", CAP, "exclusive", "true");
    prop.defects = vec![sigilc::claims::identity::Defect::Ungrounded(
        CAP.to_string(),
    )];
    let text = program::program(&req, std::slice::from_ref(&prop));
    assert!(!text.contains(&prop.id));

    let world = run(&req, std::slice::from_ref(&prop));
    assert!(world.table("violation").is_empty());
}

// ------------------------------------------ minted flow entities (U3)

fn step(facet: &str, ordinal: u32) -> Fact {
    fact(facet, "logic", Body::Step { ordinal })
}

/// The graph identity `program.rs` mints for a component's Logic section.
fn graph_of(component: &str) -> String {
    sigilc::sources::hash(
        &serde_json::to_vec(&("sigil-flow-graph-v1", component, "logic")).expect("serialization"),
    )
}

#[test]
fn a_step_is_emitted_as_an_entity_of_its_own_kind() {
    let request = request(&[("f1", A, "logic")]);
    let world = run(&request, &[step("f1", 1)]);

    let kinds: Vec<(&str, &str)> = world
        .table("entity")
        .iter()
        .map(|r| (cell(r, 1), cell(r, 3)))
        .collect();
    assert!(
        kinds.contains(&("Step", A)),
        "a step is an entity the tool minted, owned by its component: {kinds:?}"
    );
    assert!(
        kinds.contains(&("Graph", A)),
        "a section that declares a step mints one graph: {kinds:?}"
    );
    // The design's own entities are untouched beside them.
    assert!(kinds.contains(&("Component", "")) || kinds.iter().any(|(k, _)| *k == "Component"));
}

#[test]
fn the_required_state_law_is_unchanged_by_minted_entities() {
    // That law joins `entity` filtering on the literal kind "Tag", which is
    // what makes adding kinds safe. Pin it: a Step in the table must not reach
    // it, and a Tag must still reach it exactly as before.
    let request = request(&[("f1", A, "state"), ("f2", A, "logic")]);
    let with_steps = run(
        &request,
        &[
            property("f1", "state", CAP, "required", "true"),
            step("f2", 1),
        ],
    );
    let without = run(
        &request,
        &[property("f1", "state", CAP, "required", "true")],
    );

    let obligations = |w: &Saturated| -> Vec<String> {
        let mut v: Vec<String> = w
            .table("obligation")
            .iter()
            .map(|r| format!("{} {} {}", cell(r, 1), cell(r, 2), cell(r, 3)))
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        obligations(&with_steps),
        obligations(&without),
        "minted entities must not reach a law that filters on kind Tag"
    );
    assert!(
        !obligations(&with_steps).is_empty(),
        "and that law still fires"
    );
}

#[test]
fn a_step_belongs_to_its_own_components_graph() {
    let request = request(&[("f1", A, "logic")]);
    let world = run(&request, &[step("f1", 1), step("f1", 2)]);
    let pairs: Vec<(&str, &str)> = world
        .table("in-graph")
        .iter()
        .map(|r| (cell(r, 0), cell(r, 1)))
        .collect();
    assert_eq!(pairs.len(), 2, "both steps, one graph");
    for (_, g) in &pairs {
        assert_eq!(*g, graph_of(A));
    }
}

#[test]
fn what_a_step_does_is_read_straight_out_of_holds() {
    // The claims are ordinary: `step reads Tag`. No projection from bespoke
    // rows, which is what removes the join every law would otherwise carry.
    let request = request(&[("f1", A, "logic")]);
    let s = step("f1", 1);
    let reads = claim("f1", "logic", &s.id, "reads", CAP, "required", "true");
    let world = run(&request, &[s.clone(), reads]);

    let touches: Vec<(&str, &str)> = world
        .table("flow-touches")
        .iter()
        .map(|r| (cell(r, 0), cell(r, 1)))
        .collect();
    assert_eq!(touches, vec![(s.id.as_str(), CAP)]);
}

#[test]
fn a_guard_reaches_the_program_with_its_operand() {
    let request = request(&[("f1", A, "logic")]);
    let g = fact(
        "f1",
        "logic",
        Body::Guard {
            step: 1,
            operand: "input".into(),
            value: "requestId".into(),
        },
    );
    let world = run(&request, &[step("f1", 1), g]);
    let guards: Vec<(&str, &str, &str)> = world
        .table("flow-guard")
        .iter()
        .map(|r| (cell(r, 1), cell(r, 2), cell(r, 3)))
        .collect();
    assert_eq!(guards, vec![("1", "input", "requestId")]);
}

#[test]
fn a_defect_carrying_flow_row_never_reaches_the_program() {
    let request = request(&[("f1", A, "logic")]);
    let mut bad = step("f1", 1);
    bad.defects
        .push(sigilc::claims::identity::Defect::Degenerate);
    let world = run(&request, &[bad]);
    assert!(
        world.table("flow-step").is_empty(),
        "a defective row is excluded from saturation, not emitted and then ignored"
    );
    // The graph is still minted, and deliberately so: the suppression has to
    // be reported, and it hangs off the graph entity. Excluding the row and
    // the graph together would leave a reader with a flagged row and no word
    // that the check stopped running.
    assert!(
        world.table("entity").iter().any(|r| cell(r, 1) == "Graph"),
        "a graph with a defective row is still a graph, so its suppression is reportable"
    );
    assert_eq!(
        world
            .table("suppressed-graph")
            .iter()
            .map(|r| cell(r, 0))
            .collect::<Vec<_>>(),
        vec![A],
        "and the suppression itself is reported"
    );
}

#[test]
fn one_defective_row_suppresses_its_whole_graphs_check() {
    // Per-row exclusion is safe for a claim, which only ever adds a
    // derivation. It inverts here: dropping one edge severs a path and
    // manufactures dead ends on well-formed steps upstream. So the whole
    // graph's check stops, and says so.
    let request = request(&[("f1", A, "logic")]);
    let (s1, s2) = (step("f1", 1), step("f1", 2));
    let g = graph_of(A);
    let mut broken = edge("f1", &s1.id, &s2.id);
    broken
        .defects
        .push(sigilc::claims::identity::Defect::Degenerate);

    let world = run(
        &request,
        &[s1.clone(), s2.clone(), broken, edge("f1", &s2.id, &g)],
    );
    assert!(
        unreached(&world).is_empty(),
        "s1 only dangles because the defective edge was dropped; reporting it \
         would be a finding this tool manufactured"
    );
    assert_eq!(
        world
            .table("suppressed-graph")
            .iter()
            .map(|r| cell(r, 0))
            .collect::<Vec<_>>(),
        vec![A]
    );
}

#[test]
fn a_defect_in_one_graph_does_not_suppress_another() {
    let request = request(&[("f1", A, "logic"), ("f2", B, "logic")]);
    let mut bad = step("f1", 1);
    bad.defects
        .push(sigilc::claims::identity::Defect::Degenerate);
    let mut good = step("f2", 1);
    good.component = B.to_string();
    let world = run(&request, &[bad, good.clone()]);

    assert_eq!(
        unreached(&world),
        vec![good.id.clone()],
        "the well-formed graph is still checked"
    );
    assert_eq!(
        world
            .table("suppressed-graph")
            .iter()
            .map(|r| cell(r, 0))
            .collect::<Vec<_>>(),
        vec![A],
        "and only the graph that carried the defect is suppressed"
    );
}

// ------------------------------------------ end reachability (U4)

/// An edge from one step to another, or to the graph.
fn edge(facet: &str, from: &str, to: &str) -> Fact {
    claim(facet, "logic", from, "to", to, "required", "true")
}

fn unreached(world: &Saturated) -> Vec<String> {
    let mut v: Vec<String> = world
        .table("unreached-step")
        .iter()
        .map(|r| cell(r, 0).to_string())
        .collect();
    v.sort();
    v
}

#[test]
fn a_step_whose_result_no_longer_reaches_an_end_is_derived_as_unreached() {
    // Covers AE1's shape. Three steps; the middle one's output goes nowhere.
    let request = request(&[("f1", A, "logic")]);
    let (s1, s2, s3) = (step("f1", 1), step("f1", 2), step("f1", 3));
    let g = graph_of(A);
    let world = run(
        &request,
        &[
            s1.clone(),
            s2.clone(),
            s3.clone(),
            edge("f1", &s1.id, &s3.id),
            edge("f1", &s3.id, &g),
        ],
    );
    assert_eq!(
        unreached(&world),
        vec![s2.id.clone()],
        "only the step with no path to the end is derived"
    );
}

#[test]
fn a_chain_where_every_step_reaches_the_end_derives_nothing() {
    let request = request(&[("f1", A, "logic")]);
    let (s1, s2) = (step("f1", 1), step("f1", 2));
    let g = graph_of(A);
    let world = run(
        &request,
        &[
            s1.clone(),
            s2.clone(),
            edge("f1", &s1.id, &s2.id),
            edge("f1", &s2.id, &g),
        ],
    );
    assert!(unreached(&world).is_empty());
}

#[test]
fn a_branching_flow_reports_only_the_branch_that_dead_ends() {
    let request = request(&[("f1", A, "logic")]);
    let (s1, ok, dead) = (step("f1", 1), step("f1", 2), step("f1", 3));
    let g = graph_of(A);
    let world = run(
        &request,
        &[
            s1.clone(),
            ok.clone(),
            dead.clone(),
            edge("f1", &s1.id, &ok.id),
            edge("f1", &s1.id, &dead.id),
            edge("f1", &ok.id, &g),
        ],
    );
    assert_eq!(unreached(&world), vec![dead.id.clone()]);
}

#[test]
fn a_step_pointing_only_at_a_dead_end_is_itself_unreached() {
    let request = request(&[("f1", A, "logic")]);
    let (a, b) = (step("f1", 1), step("f1", 2));
    let world = run(&request, &[a.clone(), b.clone(), edge("f1", &a.id, &b.id)]);
    let mut want = vec![a.id.clone(), b.id.clone()];
    want.sort();
    assert_eq!(unreached(&world), want);
}

#[test]
fn a_self_edge_does_not_make_a_step_reach_an_end() {
    // A loop is a legitimate shape and admission lets it through. It must not
    // be mistaken for a path to an end, and must not hang the closure.
    let request = request(&[("f1", A, "logic")]);
    let s = step("f1", 1);
    let world = run(&request, &[s.clone(), edge("f1", &s.id, &s.id)]);
    assert_eq!(unreached(&world), vec![s.id.clone()]);
}

#[test]
fn an_outward_call_ends_nothing_unless_the_edge_is_declared() {
    // Declared, never inferred. Without this rule every step that calls out
    // would terminate trivially and the check would never fire.
    let request = request(&[("f1", A, "logic")]);
    let s = step("f1", 1);
    let calls = claim("f1", "logic", &s.id, "invokes", CAP, "required", "true");
    let world = run(&request, &[s.clone(), calls]);
    assert_eq!(
        unreached(&world),
        vec![s.id.clone()],
        "calling outward is not ending; the edge to the graph is"
    );
}

#[test]
fn the_derivation_carries_the_law_that_reached_it() {
    let request = request(&[("f1", A, "logic")]);
    let s = step("f1", 1);
    let g = graph_of(A);
    let world = run(&request, &[s.clone(), edge("f1", &s.id, &g)]);
    let laws: Vec<&str> = world
        .table("because")
        .iter()
        .filter(|r| cell(r, 1) == "flow-end")
        .map(|r| cell(r, 3))
        .collect();
    assert!(laws.contains(&"flow-end-direct"), "got {laws:?}");
}

#[test]
fn the_unreached_relation_is_readable_from_the_saturated_world() {
    // A relation absent from the exported-table list is computed and then
    // discarded with no error, so the law would look broken rather than
    // unexported. Pin that it is exported.
    let request = request(&[("f1", A, "logic")]);
    let world = run(&request, &[step("f1", 1)]);
    assert_eq!(world.table("unreached-step").len(), 1);
}
