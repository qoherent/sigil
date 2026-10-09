mod support;
use sigilc::{
    eqval::{self, DesignState, Limits},
    report,
    turtle::{self, ONTOLOGY, TurtleLimits},
};
use std::collections::BTreeMap;
use support::Workspace;

// @sigil tests packages/sigilc/report.sigil::SigilGateDiagnostics::Bounds interface,cases
#[test]
fn findings_are_bounded_deterministic_and_preserve_contradictions_and_missing_locations() {
    let root = Workspace::new();
    root.write(
        "a.sigil",
        b"component A {\ngoal {\nAuthored fixture.\n}\ninterface {\nOffer A.\n}\n}",
    );
    let input = root.design_input();
    let facts = turtle::parse(
        format!("@prefix s: <{ONTOLOGY}> . <urn:a> s:excludes <urn:b>; s:uses <urn:b> .")
            .as_bytes(),
        TurtleLimits::default(),
    )
    .unwrap();
    let units: Vec<_> = (0..1005)
        .map(|i| [format!("urn:unit:{i}"), "urn:a".into()])
        .collect();
    let world = eqval::design(&facts, &units, Limits::default()).unwrap();
    assert_eq!(world.state, DesignState::Disjoint);
    let mut sources = BTreeMap::new();
    for fact in &facts {
        sources.insert(
            fact.id(),
            (0..10).map(|i| format!("source-{i}.sigil")).collect(),
        );
    }
    let result = report::design(&input, &world, &[], &sources);
    assert_eq!(result.items.len(), 1000);
    assert_eq!(result.omitted, 6);
    let first = &result.items[0];
    assert_eq!(first.code, "DESIGN_CONTRADICTION");
    assert_eq!(first.severity, "error");
    assert_eq!(first.locations.len(), 8);
    assert_eq!(first.omitted_locations, 2);
    assert!(
        first
            .locations
            .iter()
            .all(|l| l.range.is_none() && l.side == "design")
    );
    assert_eq!(
        first.witness.as_ref().unwrap().row,
        world.closure.tables["violation"][0]
    );
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::to_value(report::design(&input, &world, &[], &sources)).unwrap()
    );
    assert_eq!(world.closure.tables["design-unresolved"].len(), 1005);
    assert_eq!(world.state, DesignState::Disjoint);
}
