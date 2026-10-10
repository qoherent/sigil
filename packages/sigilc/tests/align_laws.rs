use serde_json::Value;
use sigilc::{
    align::{
        admit,
        prepare::{Binding, DesignName, Request},
        program,
    },
    claims::{
        identity::{Body, Fact},
        prepare::AdmissibleEntity,
    },
    engine,
};
const A: &str = "panel";
const B: &str = "service";
const T: &str = "results";
const S: &str = "request";
fn entities() -> Vec<AdmissibleEntity> {
    [
        (A, "Component", None),
        (B, "Component", None),
        (T, "Tag", Some(B)),
        (S, "Tag", Some(A)),
    ]
    .into_iter()
    .map(|(id, kind, owner)| AdmissibleEntity {
        id: id.into(),
        kind: kind.into(),
        label: id.into(),
        owner: owner.map(str::to_owned),
        source: "d.sigil".into(),
    })
    .collect()
}
fn fact(body: Body, section: &str) -> Fact {
    Fact {
        id: sigilc::sources::hash(&serde_json::to_vec(&(&body, section)).unwrap()),
        facet: "facet".into(),
        component: A.into(),
        section: section.into(),
        body,
        defects: vec![],
    }
}
fn claim(s: &str, r: &str, o: &str, expected: &str) -> Fact {
    fact(
        Body::Claim {
            subject: s.into(),
            relation: r.into(),
            object: o.into(),
            modality: "required".into(),
            expected: expected.into(),
        },
        "interface",
    )
}
fn prop(p: &str) -> Fact {
    fact(
        Body::Property {
            subject: S.into(),
            property: p.into(),
            value: "true".into(),
        },
        "state",
    )
}
fn code(path: &str, rows: &str) -> Vec<admit::Fact> {
    let request = Request {
        binding: Binding {
            format: 1,
            path: path.into(),
            content_hash: "c".into(),
            names_digest: "n".into(),
            selection_digest: "s".into(),
            guidance_fingerprint: "g".into(),
            vocabulary_generation: 1,
        },
        source: "source".into(),
        names: entities()
            .into_iter()
            .map(|e| DesignName {
                id: e.id.clone(),
                kind: e.kind,
                label: e.label.clone(),
                qualified_label: e.label,
                owner: e.owner,
                source: e.source,
                digest: "d".into(),
                membership_digest: "m".into(),
                claims: vec![],
                facets: vec![],
            })
            .collect(),
    };
    let rows = sigilc::align::dialect::parse(rows, Default::default()).unwrap();
    admit::admit(&request, &rows).unwrap().facts
}
fn run(facts: Vec<Fact>, code: Vec<admit::Fact>) -> program::Saturated {
    program::saturate(&entities(), &facts, &code, engine::Limits::default()).unwrap()
}
fn has(w: &program::Saturated, table: &str, law: &str) -> bool {
    w.table(table)
        .iter()
        .any(|r| r[0] == Value::String(law.into()))
}
#[test]
fn component_members_deliver_but_tests_and_tag_helpers_do_not_answer_provides() {
    let promise = claim(B, "provides", T, "true");
    for rows in [
        "(element \"f\" \"function\") (realizes \"f\" \"results\")",
        "(element \"f\" \"test\") (realizes \"f\" \"service\") (realizes \"f\" \"results\")",
    ] {
        assert!(has(
            &run(vec![promise.clone()], code("s.rs", rows)),
            "unanswered",
            "provides"
        ));
    }
    let w = run(
        vec![promise],
        code(
            "s.rs",
            "(element \"f\" \"function\") (realizes \"f\" \"service\") (element \"helper\" \"function\") (realizes \"helper\" \"service\") (realizes \"helper\" \"results\")",
        ),
    );
    assert!(w.table("unanswered").is_empty());
}
#[test]
fn requires_through_service_and_tag_dependency() {
    for target in [B, T] {
        for action in ["uses", "invokes", "dependsOn"] {
            let mut c = code(
                "p.rs",
                &format!(
                    "(element \"f\" \"function\") (realizes \"f\" \"panel\") (act \"f\" \"{action}\" \"{target}\")"
                ),
            );
            c.extend(code("s.rs","(element \"f\" \"function\") (realizes \"f\" \"service\") (realizes \"f\" \"results\")"));
            let w = run(vec![claim(A, "requires", T, "true")], c);
            assert!(w.table("unanswered").is_empty(), "{action} {target}: {w:?}");
        }
    }
}
#[test]
fn exclusive_ownership_catches_foreign_unmapped_writer_and_cites_both_sides() {
    let mut c = code(
        "p.rs",
        "(element \"f\" \"state\") (realizes \"f\" \"panel\") (act \"f\" \"owns\" \"request\")",
    );
    c.extend(code(
        "cache.rs",
        "(element \"cache\" \"state\") (act \"cache\" \"owns\" \"request\")",
    ));
    let w = run(vec![prop("exclusive"), claim(A, "owns", S, "true")], c);
    assert!(has(&w, "breach", "exclusive-ownership"));
    assert!(w.table("breach").iter().any(|r| r[2] != "" && r[3] != ""));
    let w = run(
        vec![prop("exclusive"), claim(A, "owns", S, "true")],
        code(
            "cache.rs",
            "(element \"cache\" \"state\") (act \"cache\" \"owns\" \"request\")",
        ),
    );
    assert!(has(&w, "breach", "exclusive-ownership"));
}
#[test]
fn same_component_multiple_elements_and_tests_are_not_second_owners() {
    let c = code(
        "p.rs",
        "(element \"a\" \"state\") (realizes \"a\" \"panel\") (act \"a\" \"owns\" \"request\") (element \"b\" \"state\") (realizes \"b\" \"panel\") (act \"b\" \"owns\" \"request\") (element \"test\" \"test\") (realizes \"test\" \"service\") (act \"test\" \"owns\" \"request\")",
    );
    assert!(
        run(
            vec![
                prop("exclusive"),
                prop("required"),
                claim(A, "owns", S, "true")
            ],
            c
        )
        .table("breach")
        .is_empty()
    );
    assert!(has(
        &run(vec![prop("required")], vec![]),
        "unanswered",
        "required-state-owner"
    ));
}
#[test]
fn exclusions_negatives_and_logic_are_breach_only() {
    for mut p in [
        claim(A, "excludes", T, "true"),
        claim(A, "uses", T, "false"),
    ] {
        let w = run(vec![p.clone()], vec![]);
        assert!(w.table("unanswered").is_empty());
        let w = run(
            vec![p.clone()],
            code(
                "p.rs",
                "(element \"f\" \"function\") (realizes \"f\" \"panel\") (act \"f\" \"uses\" \"results\")",
            ),
        );
        assert!(!w.table("breach").is_empty());
        p.section = "logic".into();
        assert!(run(vec![p], vec![]).table("unanswered").is_empty());
    }
    for section in ["logic", "cases", "decisions"] {
        let mut p = claim(A, "provides", T, "true");
        p.section = section.into();
        assert!(run(vec![p], vec![]).table("unanswered").is_empty());
    }
}
#[test]
fn budgets_and_missing_measures_cover_all_named_units() {
    for (bound, measure) in [
        ("maxDurationDays", "durationDays"),
        ("maxLeadDays", "leadDays"),
        ("maxSpanDays", "spanDays"),
        ("latencyBudgetMs", "latencyMs"),
    ] {
        let p = fact(
            Body::Measure {
                subject: S.into(),
                property: bound.into(),
                number: "180".into(),
            },
            "constraints",
        );
        assert!(has(
            &run(vec![p.clone()], vec![]),
            "unanswered",
            "numeric-budget"
        ));
        for (n, breach) in [("365", true), ("7", false)] {
            let w = run(
                vec![p.clone()],
                code(
                    "p.rs",
                    &format!(
                        "(element \"f\" \"function\") (realizes \"f\" \"request\") (measure \"f\" \"{measure}\" \"{n}\")"
                    ),
                ),
            );
            assert_eq!(has(&w, "breach", "numeric-budget"), breach);
            assert!(w.table("unanswered").is_empty());
        }
    }
}
#[test]
fn required_code_relations_have_no_design_self_satisfaction() {
    for relation in ["uses", "owns", "invokes", "dependsOn"] {
        assert!(
            !run(vec![claim(A, relation, T, "true")], vec![])
                .table("unanswered")
                .is_empty()
        );
        let w = run(
            vec![claim(A, relation, T, "true")],
            code(
                "p.rs",
                &format!(
                    "(element \"f\" \"function\") (realizes \"f\" \"panel\") (act \"f\" \"{relation}\" \"results\")"
                ),
            ),
        );
        assert!(w.table("unanswered").is_empty());
    }
}
#[test]
fn ownership_is_not_a_service_dependency() {
    let mut c = code(
        "p.rs",
        "(element \"f\" \"function\") (realizes \"f\" \"panel\") (act \"f\" \"owns\" \"results\")",
    );
    c.extend(code(
        "s.rs",
        "(element \"f\" \"function\") (realizes \"f\" \"service\") (realizes \"f\" \"results\")",
    ));
    assert!(has(
        &run(vec![claim(A, "requires", T, "true")], c),
        "unanswered",
        "requires"
    ));
}
#[test]
fn assumed_owner_is_not_a_committed_rightful_owner() {
    let mut p = claim(A, "owns", S, "true");
    if let Body::Claim { modality, .. } = &mut p.body {
        *modality = "assumed".into();
    }
    let w = run(
        vec![prop("exclusive"), p],
        code(
            "s.rs",
            "(element \"f\" \"state\") (realizes \"f\" \"service\") (act \"f\" \"owns\" \"request\")",
        ),
    );
    assert!(w.table("breach").is_empty());
}
#[test]
fn logic_and_cases_budgets_are_enforced_without_unanswered() {
    for section in ["logic", "cases"] {
        let p = fact(
            Body::Measure {
                subject: S.into(),
                property: "maxLeadDays".into(),
                number: "180".into(),
            },
            section,
        );
        assert!(run(vec![p.clone()], vec![]).table("unanswered").is_empty());
        let w = run(
            vec![p],
            code(
                "p.rs",
                "(element \"f\" \"function\") (realizes \"f\" \"request\") (measure \"f\" \"leadDays\" \"365\")",
            ),
        );
        assert!(has(&w, "breach", "numeric-budget"));
    }
}
#[test]
fn positive_relation_with_tag_actor_is_not_an_unanswerable_component_promise() {
    assert!(
        run(vec![claim(S, "uses", T, "true")], vec![])
            .table("unanswered")
            .is_empty()
    );
}
