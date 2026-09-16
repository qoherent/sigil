use serde_json::json;
use sigilc::{
    eqval::{self, DesignState, Limits},
    turtle::{self, Assertion, ONTOLOGY, TurtleLimits},
};

fn facts(body: &str) -> Vec<Assertion> {
    turtle::parse(
        format!("@prefix s: <{ONTOLOGY}> . @prefix : <urn:test:> .\n{body}").as_bytes(),
        TurtleLimits::default(),
    )
    .unwrap()
}

#[test]
fn required_authored_inventory_cannot_disappear_from_empty_model_output() {
    let units = [["urn:test:U".into(), "urn:test:A".into()]];
    let empty = eqval::design(&[], &units, Limits::default()).unwrap();
    assert_eq!(empty.state, DesignState::Loose);
    assert!(empty.closure.tables["coverage"].is_empty());
    assert!(
        empty.closure.tables["design-unresolved"]
            .iter()
            .any(|r| r[2] == "interpretation")
    );
    let prohibition = facts(":U s:from :A; s:relation \"uses\"; s:target :X; s:expected false .");
    let complete = eqval::design(&prohibition, &units, Limits::default()).unwrap();
    assert_eq!(complete.state, DesignState::Coherent);
    assert_eq!(
        complete.closure.tables["coverage"],
        vec![vec![
            json!("urn:test:U"),
            json!("urn:test:A"),
            json!("uses"),
            json!("urn:test:X"),
            json!("false"),
            json!("required-proposition")
        ]]
    );
    let erased = eqval::design(&facts(":U s:required false ."), &units, Limits::default()).unwrap();
    assert_eq!(erased.state, DesignState::Disjoint);
}

#[test]
fn design_states_preserve_capability_ownership_and_contradiction_rules() {
    for (body, expected) in [
        (":A s:requires :X .", DesignState::Loose),
        (
            ":A s:requires :X; s:dependsOn :B . :B s:provides :X .",
            DesignState::Coherent,
        ),
        (":S a s:State; s:required true .", DesignState::Loose),
        (
            ":S a s:State; s:required true . :A s:owns :S .",
            DesignState::Coherent,
        ),
        (":A s:excludes :X; s:uses :X .", DesignState::Disjoint),
        (":A s:assumed true .", DesignState::Loose),
        (
            ":P a s:Contract; s:required true; s:from :A; s:relation \"invokes\"; s:target :B; s:expected true . :Q a s:Contract; s:required true; s:from :A; s:relation \"invokes\"; s:target :B; s:expected false .",
            DesignState::Disjoint,
        ),
    ] {
        assert_eq!(
            eqval::design(&facts(body), &[], Limits::default())
                .unwrap()
                .state,
            expected,
            "{body}"
        );
    }
}

#[test]
fn fixed_lowering_separates_descriptive_edges_from_code_obligations() {
    let input = facts(
        ":A s:provides :X; s:requires :Y; s:excludes :Z; s:dependsOn :B; s:label \"A\"; s:latencyBudgetMs 20 .",
    );
    let output = eqval::design(&input, &[], Limits::default()).unwrap();
    let coverage = &output.closure.tables["coverage"];
    assert_eq!(coverage.len(), 3);
    assert!(
        coverage
            .iter()
            .any(|r| r[2] == "provides" && r[5] == "requires")
    );
    assert!(coverage.iter().any(|r| r[2] == "uses" && r[4] == "false"));
    assert_eq!(output.closure.tables["numeric-obligation"].len(), 1);
    let implementation = eqval::saturate(&input, Limits::default()).unwrap();
    assert!(!implementation.tables.contains_key("coverage"));
    assert!(!implementation.tables.contains_key("design-obligation"));
}
