use serde_json::json;
use sigilc::{
    catalog::{self, DesignIdentities},
    frontend::DesignInput,
    eqval::DesignState,
    turtle::{self, Assertion, TurtleLimits},
};
use std::collections::BTreeMap;

fn frontend() -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&json!({
        "schemaVersion":1, "frontendVersion":"test",
        "sources":[{"path":"a.sigil","text":"component A {}"},{"path":"b.sigil","text":"component B {}"}],
        "context":[{"path":".sigil/config.json","text":null},{"path":".sigil/local.json","text":null},{"path":".sigil/glossary.json","text":null}],
        "diagnostics":[], "imports":[],
        "entities":[
            {"id":"urn:sigil:component:a.sigil:A","type":"Component","label":"A","source":"a.sigil","owner":null,"exported":true},
            {"id":"urn:sigil:component:b.sigil:B","type":"Component","label":"B","source":"b.sigil","owner":null,"exported":true}
        ],
        "units":[{"id":"urn:sigil:unit:a.sigil:1:1","source":"a.sigil","owner":"urn:sigil:component:a.sigil:A","form":"component","section":"goal","tag":null,"range":{"start":{"line":1,"column":1},"end":{"line":1,"column":14}}}]
    })).unwrap()).unwrap()
}

fn facts(body: &str) -> Vec<Assertion> {
    turtle::parse(format!("@prefix s: <https://sigil.dev/ontology/1#> . @prefix a: <urn:sigil:entity:a.sigil:> . @prefix b: <urn:sigil:entity:b.sigil:> . @prefix c: <urn:sigil:component:a.sigil:> . {body}").as_bytes(), TurtleLimits::default()).unwrap()
}

fn projections(extra: &str) -> BTreeMap<String, Vec<Assertion>> {
    BTreeMap::from([
        (
            "a.sigil".into(),
            facts(&format!(
                "a:Read a s:Capability; s:label \"Read\"@en; s:description \"secret relationship\" . c:A s:provides a:Read . {extra}"
            )),
        ),
        (
            "b.sigil".into(),
            facts("<urn:sigil:component:b.sigil:B> s:uses a:Read ."),
        ),
    ])
}

#[test]
fn freezes_only_identity_and_preserves_status_and_relationship_reuse() {
    let input = frontend();
    let loose = DesignIdentities::collect(&input, &projections(""))
        .unwrap()
        .freeze(DesignState::Loose, "first".into(), true)
        .unwrap();
    let coherent = DesignIdentities::collect(&input, &projections("c:A s:requires a:Read ."))
        .unwrap()
        .freeze(DesignState::Coherent, "second".into(), true)
        .unwrap();
    assert_eq!(loose.catalog.fingerprint(), coherent.catalog.fingerprint());
    assert_eq!(loose.catalog.entries().len(), 3);
    let content = serde_json::to_string(&loose.catalog).unwrap();
    for forbidden in [
        "secret",
        "provides",
        "requires",
        "urn:sigil:unit:",
        "first",
        "provisional",
    ] {
        assert!(!content.contains(forbidden), "{forbidden}");
    }
    let mut renamed = projections("");
    renamed
        .get_mut("a.sigil")
        .unwrap()
        .retain(|a| a.predicate != format!("{}label", turtle::ONTOLOGY));
    renamed
        .get_mut("a.sigil")
        .unwrap()
        .extend(facts("a:Read s:label \"Read changed\"@en ."));
    let changed = DesignIdentities::collect(&input, &renamed)
        .unwrap()
        .freeze(DesignState::Coherent, "third".into(), true)
        .unwrap();
    assert_ne!(loose.catalog.fingerprint(), changed.catalog.fingerprint());
    for (state, fresh) in [
        (DesignState::Disjoint, true),
        (DesignState::Loose, false),
        (DesignState::Coherent, false),
    ] {
        assert!(
            DesignIdentities::collect(&input, &projections(""))
                .unwrap()
                .freeze(state, "x".into(), fresh)
                .is_err()
        );
    }
}

#[test]
fn declarations_are_owned_and_explicit_but_foreign_references_are_allowed() {
    let input = frontend();
    for body in [
        "b:Other a s:State; s:label \"Other\" .",
        "a:Other a s:State .",
        "a:Other s:label \"Other\" .",
        "a:Other a s:State; s:label \" \" .",
        "a:Other a s:State, s:Artifact; s:label \"Other\" .",
        "a:Other a s:State; s:label \"One\", \"Two\" .",
        "a:Other a s:Component; s:label \"Other\" .",
        "c:A a s:State .",
        "c:A s:label \"changed\" .",
        "<urn:sigil:component:b.sigil:B> a s:Component .",
        "<urn:sigil:unit:a.sigil:1:1> a s:State .",
        "c:A s:uses <urn:sigil:unit:a.sigil:1:1> .",
        "<urn:sigil:unit:a.sigil:1:1> s:target <urn:sigil:unit:a.sigil:1:1> .",
        "<urn:sigil:unit:a.sigil:1:1> a s:Contract; s:relation \"owns\", \"hasContract\" .",
        "<urn:sigil:entity:a.sigil:%52ead> a s:Capability; s:label \"Read\" .",
        "<urn:sigil:entity:a.sigil:> a s:Capability; s:label \"Empty\" .",
    ] {
        assert!(
            catalog::validate_design("a.sigil", &input, &facts(body)).is_err(),
            "{body}"
        );
    }
    let local = facts(
        "c:A a s:Component; s:label \"A\"; s:uses b:Foreign . <urn:sigil:unit:a.sigil:1:1> a s:Contract .",
    );
    catalog::validate_design("a.sigil", &input, &local).unwrap();
    assert!(
        catalog::validate_design(
            "b.sigil",
            &input,
            &facts("<urn:sigil:unit:a.sigil:1:1> s:expected false .")
        )
        .is_err()
    );
    assert!(
        DesignIdentities::collect(&input, &BTreeMap::from([("a.sigil".into(), local.clone())]))
            .is_err()
    );
    DesignIdentities::collect(
        &input,
        &BTreeMap::from([
            ("a.sigil".into(), local),
            (
                "b.sigil".into(),
                facts("b:Foreign a s:Capability; s:label \"Foreign\" ."),
            ),
        ]),
    )
    .unwrap();
    assert_eq!(
        catalog::domain_id("folder/a.sigil", "Read café").unwrap(),
        "urn:sigil:entity:folder%2Fa.sigil:Read%20caf%C3%A9"
    );
    assert!(catalog::domain_id("../a.sigil", "X").is_err());
}

#[test]
fn implementation_cannot_expand_or_mutate_the_identity_universe() {
    let catalog = DesignIdentities::collect(&frontend(), &projections(""))
        .unwrap()
        .freeze(DesignState::Loose, "x".into(), true)
        .unwrap()
        .catalog;
    catalog.validate_implementation(&[]).unwrap();
    catalog
        .validate_implementation(&facts(
            "c:A a s:Component; s:label \"A\"; s:uses a:Read . a:Read s:label \"Read\"@en .",
        ))
        .unwrap();
    for body in [
        "c:A s:uses b:Missing .",
        "b:Missing s:uses c:A .",
        "c:A a s:State .",
        "c:A s:label \"alias\" .",
        "a:Read s:label \"Read\" .", // Language is part of label identity.
        "c:A s:uses <urn:sigil:unit:a.sigil:1:1> .",
        "c:A s:uses s:Component .", // Classes are vocabulary only in rdf:type.
        "<urn:sigil:unit:a.sigil:1:1> a s:Contract .",
    ] {
        assert!(
            catalog.validate_implementation(&facts(body)).is_err(),
            "{body}"
        );
    }
}
