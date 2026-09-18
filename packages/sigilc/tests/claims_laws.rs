use serde_json::Value;
use sigilc::{
    claims::{
        identity::{Body, Fact},
        prepare::{AdmissibleEntity, Binding, FacetRow, Request},
        program::{self, Saturated},
    },
    eqval,
    frontend::DesignInput,
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

fn empty_input() -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&support::shared_value()).unwrap()).unwrap()
}

fn run(request: &Request, facts: &[Fact]) -> Saturated {
    program::saturate(request, &empty_input(), facts, eqval::Limits::default()).unwrap()
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
    let text = program::program(&req, &empty_input(), &facts);
    assert!(text.contains("(ruleset closure)"));
    assert!(text.contains("(commits \"interface\")"));
    assert!(
        !text.contains("(commits \"decisions\")"),
        "the role gate must be visible in the data"
    );
    assert!(text.contains(&format!("(facet \"f1\" {A:?}")));
}
