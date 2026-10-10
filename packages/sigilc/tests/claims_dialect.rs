use sigilc::{
    claims::{
        canon,
        dialect::{self, Limits, Row},
        identity::{self, Body, Defect},
        prepare::{self, Binding, Request},
        vocabulary,
    },
    structure::DesignInput,
};

mod support;
use support::{
    BASE, CONSUMER, base_constraints, base_goal, base_interface, consumer_goal, consumer_interface,
    shared_input,
};

const BASE_ID: &str = "urn:sigil:component:base.sigil:Base";
const VALUE_ID: &str = "urn:sigil:component:base.sigil:Base:tag:value";

fn request_for(input: &DesignInput, source: &str) -> Request {
    support::project(input, source).unwrap()
}

/// Parse, resolve, then admit, which is the order ingest uses. Any problem
/// with any row is an error here, so a test reads the first reason.
fn accept(
    input: &DesignInput,
    source: &str,
    artifact: &str,
) -> Result<Vec<identity::Fact>, String> {
    let request = request_for(input, source);
    let parsed = dialect::read(artifact, Limits::default())?;
    if let Some(error) = parsed.errors.first() {
        return Err(error.reason.clone());
    }
    let resolved = canon::resolve(&request, parsed);
    if let Some(issue) = resolved.issues.first() {
        return Err(issue.reason.clone());
    }
    identity::admit(&request, input, &resolved.rows)
}

// ---------------------------------------------------------------- data only

#[test]
fn an_artifact_carrying_a_rule_beside_a_valid_claim_is_refused_whole() {
    let base_goal = base_goal();
    // Covers AE4.
    let artifact = format!(
        "(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (rule ((holds a b c)) ((reachable a b)))\n"
    );
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(
        error.contains("claim data only"),
        "refusal must say why, got: {error}"
    );
    // And nothing survives: the valid claim above the rule is gone with it.
    assert!(accept(&shared_input(), BASE, &artifact).is_err());
}

#[test]
fn a_ruleset_a_command_or_a_schedule_is_refused_whole() {
    let base_goal = base_goal();
    for offending in [
        "(ruleset extra)",
        "(run 3)",
        "(push)",
        "(relation sneaky (String))",
    ] {
        let artifact = format!(
            "(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n{offending}\n"
        );
        assert!(
            dialect::parse(&artifact, Limits::default()).is_err(),
            "{offending} must be refused"
        );
    }
}

#[test]
fn a_non_literal_argument_is_refused() {
    let base_goal = base_goal();
    for artifact in [
        format!("(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\" true)\n"),
        format!("(measure {base_goal:?} \"Base\" \"risk\" 1)\n"),
        format!(
            "(claim {base_goal:?} \"Base\" \"provides\" (f \"value\") \"required\" \"true\")\n"
        ),
    ] {
        assert!(
            dialect::parse(&artifact, Limits::default()).is_err(),
            "non-literal argument must be refused: {artifact}"
        );
    }
}

// ------------------------------------------------------------------- bounds

#[test]
fn the_byte_limit_is_checked_before_the_artifact_is_parsed() {
    // Syntactically broken, so only a pre-parse byte check can produce the
    // byte-limit message rather than a parse error.
    let artifact = "(((((".repeat(64);
    let limits = Limits {
        max_document_bytes: 8,
        max_atoms: 100,
    };
    let error = dialect::parse(&artifact, limits).unwrap_err();
    assert!(error.contains("byte limit"), "got: {error}");
}

#[test]
fn the_atom_limit_is_checked_before_any_row_is_validated() {
    let base_goal = base_goal();
    // Both rows name an unknown relation. If validation ran first the error
    // would name the relation; the atom limit has to win.
    let artifact = format!(
        "(claim {base_goal:?} \"Base\" \"nonsense\" \"value\" \"required\" \"true\")\n\
         (claim {base_goal:?} \"Base\" \"nonsense\" \"value\" \"required\" \"true\")\n"
    );
    let limits = Limits {
        max_document_bytes: 1_000_000,
        max_atoms: 1,
    };
    let error = dialect::parse(&artifact, limits).unwrap_err();
    assert!(error.contains("atom limit"), "got: {error}");
}

// --------------------------------------------------------------- vocabulary

#[test]
fn a_row_with_the_wrong_column_count_is_refused_with_the_offending_atom() {
    let base_goal = base_goal();
    let artifact = format!("(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\")\n");
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(error.contains("6 columns"), "got: {error}");
    assert!(
        error.contains("\"provides\""),
        "must name the atom: {error}"
    );
}

#[test]
fn an_unknown_relation_modality_or_row_name_is_refused_with_the_offending_atom() {
    let base_goal = base_goal();
    let cases = [
        (
            format!("(claim {base_goal:?} \"Base\" \"offers\" \"value\" \"required\" \"true\")\n"),
            "offers",
        ),
        (
            format!(
                "(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"mandatory\" \"true\")\n"
            ),
            "mandatory",
        ),
        (
            format!(
                "(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\" \"maybe\")\n"
            ),
            "maybe",
        ),
        (format!("(assertion {base_goal:?} \"Base\")\n"), "assertion"),
        (
            format!("(property {base_goal:?} \"Base\" \"unknownFlag\" \"true\")\n"),
            "unknownFlag",
        ),
        (
            format!("(reading {base_goal:?} \"maybe-later\")\n"),
            "maybe-later",
        ),
    ];
    for (artifact, offender) in cases {
        let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
        assert!(
            error.contains(offender),
            "refusal must name {offender}, got: {error}"
        );
    }
}

#[test]
fn numeric_measures_follow_the_ontology_bounds() {
    let base_goal = base_goal();
    let bad = [
        ("\"-1\"", "negative"),
        ("\"nan\"", "finite"),
        ("\"inf\"", "finite"),
    ];
    for (value, reason) in bad {
        let artifact = format!("(measure {base_goal:?} \"Base\" \"cost\" {value})\n");
        let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
        assert!(error.contains(reason), "{value} -> {error}");
    }
    let artifact = format!("(measure {base_goal:?} \"Base\" \"risk\" \"2\")\n");
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(error.contains("greater than one"), "got: {error}");
    assert!(
        dialect::parse(
            &format!("(measure {base_goal:?} \"Base\" \"risk\" \"0.5\")\n"),
            Limits::default()
        )
        .is_ok()
    );
}

// ----------------------------------------------------------------- identity

#[test]
fn a_claim_naming_an_entity_outside_the_closure_is_refused_by_name() {
    let base_goal = base_goal();
    // base.sigil imports nothing, so Consumer is not in its closure.
    let artifact = format!(
        "(claim {base_goal:?} \"Base\" \"dependsOn\" \"Consumer\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains("Consumer"), "got: {error}");
}

#[test]
fn a_claim_coining_an_identity_the_design_never_declared_is_refused() {
    let base_goal = base_goal();
    let artifact = format!(
        "(claim {base_goal:?} \"Base\" \"provides\" \"RetryPolicy\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains("RetryPolicy"), "got: {error}");
    assert!(error.contains("declares"), "got: {error}");
}

#[test]
fn a_row_about_a_facet_the_request_did_not_ask_about_is_refused() {
    let consumer_goal = consumer_goal();
    let artifact = format!(
        "(claim {consumer_goal:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains(consumer_goal), "got: {error}");
}

#[test]
fn identity_is_minted_deterministically_and_distinguishes_bodies() {
    let base_interface = base_interface();
    let input = shared_input();
    let artifact = format!(
        "(claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    );
    let once = accept(&input, BASE, &artifact).unwrap();
    let twice = accept(&input, BASE, &artifact).unwrap();
    assert_eq!(once, twice, "the same artifact mints the same identity");
    assert_eq!(once.len(), 1);

    let other = accept(
        &input,
        BASE,
        &format!(
            "(claim {base_interface:?} \"Base\" \"provides\" \"value\" \"permitted\" \"true\")\n"
        ),
    )
    .unwrap();
    assert_ne!(
        once[0].id, other[0].id,
        "modality is part of what a claim says, so it is part of its identity"
    );
}

#[test]
fn the_contract_role_on_an_accepted_fact_comes_from_the_export() {
    let base_goal = base_goal();
    let base_interface = base_interface();
    let input = shared_input();
    let facts = accept(
        &input,
        BASE,
        &format!("(reading {base_goal:?} \"no-commitment\")\n"),
    )
    .unwrap();
    assert_eq!(facts[0].section, "goal");
    assert_eq!(facts[0].component, BASE_ID);

    let facts = accept(
        &input,
        BASE,
        &format!(
            "(claim {base_interface:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert_eq!(
        facts[0].section, "interface",
        "the same claim text takes its role from the Facet it came from"
    );
}

// ---------------------------------------------------------------- grounding

#[test]
fn a_claim_relating_a_component_to_itself_is_grounded_then_degenerate() {
    let base_goal = base_goal();
    // Covers AE1. The owning component has to be in the grounding set, or this
    // would be refused as ungrounded before the degenerate check could see it.
    let facts = accept(
        &shared_input(),
        BASE,
        &format!("(claim {base_goal:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n"),
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert!(
        facts[0].defects.contains(&Defect::Degenerate),
        "got {:?}",
        facts[0].defects
    );
    assert!(!facts[0].satisfies_unit());
}

#[test]
fn a_claim_on_an_imported_tag_is_accepted_and_grounded() {
    let consumer_interface = consumer_interface();
    // Covers AE5. consumer.sigil's interface Facet resolves both imported Tags.
    let facts = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {consumer_interface:?} \"Consumer\" \"uses\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert!(
        facts[0].defects.is_empty(),
        "imported Tags are claimable: {:?}",
        facts[0].defects
    );
    assert!(facts[0].satisfies_unit());
    match &facts[0].body {
        Body::Claim { object, .. } => assert_eq!(object, VALUE_ID, "labels resolve to identities"),
        other => panic!("expected a claim, got {other:?}"),
    }
}

#[test]
fn an_entity_absent_from_this_facets_list_refuses_the_unit() {
    let consumer_goal = consumer_goal();
    // consumer.sigil's goal Facet references no Tag, so `value` is not on its
    // list, even though the design declares it. A name outside the list is a
    // mistake in the unit, not a claim kept and flagged.
    let error = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {consumer_goal:?} \"Consumer\" \"uses\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap_err();
    assert!(error.contains("\"value\""), "names the name: {error}");
    assert!(error.contains("not on this Facet's list"), "got: {error}");
}

#[test]
fn a_provider_component_reached_through_an_import_grounds_a_claim() {
    let consumer_goal = consumer_goal();
    let facts = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {consumer_goal:?} \"Consumer\" \"dependsOn\" \"Base\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert!(
        facts[0].defects.is_empty(),
        "Base is this source's import provider: {:?}",
        facts[0].defects
    );
}

#[test]
fn an_ambiguous_tag_reference_does_not_put_a_name_on_the_list() {
    let base_constraints = base_constraints();
    // KTD6's stated limit: the resolver could not say what the name means, so
    // it cannot vouch for a claim about it.
    // base.sigil's constraints Facet resolves two of its own Tags and takes part
    // in no import, so the reference status can be changed on its own.
    let mut input = shared_input();
    for reference in input
        .references
        .iter_mut()
        .filter(|r| r.facet == base_constraints)
    {
        reference.tag = None;
        reference.status = sigilc::structure::ReferenceStatus::Ambiguous;
    }
    let grounded = accept(
        &shared_input(),
        BASE,
        &format!(
            "(claim {base_constraints:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert!(
        grounded[0].defects.is_empty(),
        "a resolved reference grounds the claim: {:?}",
        grounded[0].defects
    );
    let error = accept(
        &input,
        BASE,
        &format!(
            "(claim {base_constraints:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap_err();
    assert!(
        error.contains("not on this Facet's list"),
        "an ambiguous reference must not put a name on the list: {error}"
    );
}

// ------------------------------------------------------- readings and gaps

#[test]
fn a_reading_row_is_accepted_retained_and_yields_no_claim() {
    let base_goal = base_goal();
    let facts = accept(
        &shared_input(),
        BASE,
        &format!("(reading {base_goal:?} \"unresolved\")\n"),
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert!(matches!(facts[0].body, Body::Reading { .. }));
    assert_eq!(facts[0].section, "goal");
    assert!(
        facts[0].satisfies_unit(),
        "reading a Facet and finding nothing to assert is an interpretation"
    );
    for outcome in vocabulary::READING_OUTCOMES {
        assert!(
            dialect::parse(
                &format!("(reading {base_goal:?} {outcome:?})\n"),
                Limits::default()
            )
            .is_ok(),
            "{outcome} must be accepted"
        );
    }
}

#[test]
fn a_role_with_no_interpreted_row_is_a_gap_and_one_with_a_reading_is_not() {
    let base_goal = base_goal();
    let input = shared_input();
    let request = request_for(&input, BASE);

    // Nothing returned at all: every declared role is a gap.
    let gaps = identity::uninterpreted(&request, &[]);
    assert_eq!(gaps.len(), 3, "base declares three roles: {gaps:?}");

    // A reading closes the goal role without asserting anything.
    let rows = dialect::parse(
        &format!("(reading {base_goal:?} \"no-commitment\")\n"),
        Limits::default(),
    )
    .unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let gaps = identity::uninterpreted(&request, &facts);
    assert!(
        !gaps.iter().any(|(_, section)| section == "goal"),
        "a Facet the interpreter read is not a gap: {gaps:?}"
    );
    assert_eq!(gaps.len(), 2);

    // A degenerate claim does not close its role.
    let rows = dialect::parse(
        &format!("(claim {base_goal:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n"),
        Limits::default(),
    )
    .unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let gaps = identity::uninterpreted(&request, &facts);
    assert!(
        gaps.iter().any(|(_, section)| section == "goal"),
        "a degenerate claim must not satisfy its unit: {gaps:?}"
    );
}

#[test]
fn an_empty_artifact_is_valid_data_and_claims_nothing() {
    // Covers AE3's precondition: silence is not malformed.
    let rows: Vec<Row> = dialect::parse("", Limits::default()).unwrap();
    assert!(rows.is_empty());
}

// ------------------------------------------------------- nesting depth (P1)

#[test]
fn deeply_nested_parens_are_refused_before_egglogs_own_parser_sees_them() {
    // egglog's parser recurses once per level of paren nesting with no depth
    // guard, so this must be caught by dialect's own scan before parse_program
    // ever runs -- otherwise a payload well inside the byte limit can exhaust
    // the native stack. 200 nesting levels is far below what a 1MB payload
    // could encode, and still large enough that a crash (not a returned Err)
    // would hang or abort the test process if the guard were absent.
    let opens: String = "(".repeat(200);
    let closes: String = ")".repeat(200);
    let artifact = format!("{opens}{closes}\n");
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(error.contains("nests"), "got: {error}");
}

#[test]
fn nesting_inside_a_quoted_string_does_not_count_as_depth() {
    let base_goal = base_goal();
    // A literal argument may legitimately contain parenthesis characters; the
    // depth scan must track string state, not just paren characters.
    let artifact =
        format!("(claim {base_goal:?} \"Base\" \"provides\" \"(((a)))\" \"required\" \"true\")\n");
    assert!(dialect::parse(&artifact, Limits::default()).is_ok());
}

#[test]
fn ordinary_rows_never_approach_the_depth_limit() {
    let base_goal = base_goal();
    for artifact in [
        format!("(claim {base_goal:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"),
        format!("(reading {base_goal:?} \"no-commitment\")\n"),
    ] {
        assert!(dialect::parse(&artifact, Limits::default()).is_ok());
    }
}

// -------------------------------------------------- coverage gaps closed

#[test]
fn a_measure_row_is_grounded_and_admitted_like_a_claim() {
    let base_goal = base_goal();
    let consumer_goal = consumer_goal();
    // The Measure arm of admit()'s grounding check had no direct test: every
    // existing measure fixture used a subject grounded through its own
    // component, never exercising the ungrounded branch for this row kind.
    let grounded = accept(
        &shared_input(),
        BASE,
        &format!("(measure {base_goal:?} \"Base\" \"risk\" \"0.5\")\n"),
    )
    .unwrap();
    assert_eq!(grounded.len(), 1);
    assert!(
        grounded[0].defects.is_empty(),
        "Base is its own Facet's owning component: {:?}",
        grounded[0].defects
    );
    match &grounded[0].body {
        Body::Measure {
            subject,
            property,
            number,
        } => {
            assert_eq!(subject, BASE_ID);
            assert_eq!(property, "risk");
            assert_eq!(number, "0.5");
        }
        other => panic!("expected a measure, got {other:?}"),
    }

    // consumer.sigil's goal Facet references no Tag, so a measure naming one
    // refuses its unit exactly like a claim would.
    let error = accept(
        &shared_input(),
        CONSUMER,
        &format!("(measure {consumer_goal:?} \"value\" \"risk\" \"0.5\")\n"),
    )
    .unwrap_err();
    assert!(error.contains("not on this Facet's list"), "got: {error}");
}

/// A design with no source text at all: sufficient for identity::admit, which
/// reads request.entities for name resolution and input only for grounding.
fn no_source_input() -> DesignInput {
    support::Workspace::new().design_input()
}

#[test]
fn a_label_shared_by_two_entities_in_the_closure_is_refused_as_ambiguous() {
    // EntityNames::resolve treats a label two entities share as unresolvable
    // rather than guessing; nothing in the fixtures exercised that branch.
    // Built directly, in the shape claims_laws.rs's request() helper uses,
    // since the full 0.8 export validator enforces cross-references (Tag
    // introductions, per-Unit introduction lists) this test has no need of.
    let request = Request {
        binding: Binding {
            format: prepare::REQUEST_FORMAT,
            source: "d.sigil".into(),
            source_content: "content".into(),
            interfaces: Vec::new(),
            guidance_fingerprint: "guidance".into(),
            vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
            facets: vec!["f1".into()],
        },
        rows: vec![prepare::FacetRow {
            facet: "f1".into(),
            component: "urn:e:Owner".into(),
            component_label: "Owner".into(),
            section: "interface".into(),
            source: "d.sigil".into(),
            prose: "prose".into(),
            handle: "#1".into(),
            names: vec!["Owner".into()],
            context: false,
        }],
        flows: Vec::new(),
        imports: Vec::new(),
        entities: vec![
            prepare::AdmissibleEntity {
                id: "urn:e:Owner".into(),
                kind: "Component".into(),
                label: "Owner".into(),
                owner: None,
                source: "d.sigil".into(),
            },
            prepare::AdmissibleEntity {
                id: "urn:e:Owner:tag:value".into(),
                kind: "Tag".into(),
                label: "value".into(),
                owner: Some("urn:e:Owner".into()),
                source: "d.sigil".into(),
            },
            prepare::AdmissibleEntity {
                id: "urn:e:Elsewhere:tag:value".into(),
                kind: "Tag".into(),
                label: "value".into(),
                owner: Some("urn:e:Elsewhere".into()),
                source: "d.sigil".into(),
            },
        ],
        declared: vec![("urn:e:Owner".into(), "interface".into())],
    };
    let rows = dialect::parse(
        "(claim \"f1\" \"Owner\" \"provides\" \"value\" \"required\" \"true\")\n",
        Limits::default(),
    )
    .unwrap();
    let error = identity::admit(&request, &no_source_input(), &rows).unwrap_err();
    assert!(error.contains("more than one entity"), "got: {error}");
}

// ------------------------------------------------------- flow rows (U1)

#[test]
fn a_step_declaration_carries_its_ordinal() {
    let rows = dialect::parse(r#"(step "f1" "3")"#, Limits::default()).unwrap();
    assert_eq!(
        rows,
        vec![Row::Step {
            facet: "f1".into(),
            ordinal: 3
        }]
    );
}

#[test]
fn a_step_ordinal_counts_from_one_and_is_a_number() {
    // Zero would be indistinguishable from a missing ordinal defaulting to the
    // first step, which is the kind of silent wrong answer this design keeps
    // having to design against.
    for bad in ["0", "-1", "first", "", "1.5"] {
        let artifact = format!(r#"(step "f1" "{bad}")"#);
        let err = dialect::parse(&artifact, Limits::default()).unwrap_err();
        assert!(
            err.contains("ordinal"),
            "{bad:?} must be refused as an ordinal, got: {err}"
        );
    }
}

#[test]
fn a_guard_names_its_step_by_reference_and_one_of_three_operands() {
    let rows = dialect::parse(
        r#"(guard "f1" "step:2" "input" "requestId")
           (guard "f1" "step:#3.2" "state" "urn:e:Owner:tag:value")
           (guard "f1" "step:2" "constraint" "facet:other.sigil:40")"#,
        Limits::default(),
    )
    .unwrap();
    assert_eq!(rows.len(), 3);
    assert!(matches!(&rows[0], Row::Guard { operand, value, .. }
        if operand == "input" && value == "requestId"));

    let err = dialect::parse(r#"(guard "f1" "step:2" "mood" "x")"#, Limits::default()).unwrap_err();
    assert!(err.contains("operand"), "got: {err}");

    let err = dialect::parse(r#"(guard "f1" "2" "input" "x")"#, Limits::default()).unwrap_err();
    assert!(
        err.contains("step:K"),
        "a bare number is not a step reference: {err}"
    );
}

#[test]
fn a_claim_about_a_step_is_required_and_expected_to_hold() {
    // Covers KTD38. A step either reads a state or it does not; there is no
    // permitted or assumed about it, and fixing the pair keeps flow facts out
    // of the laws that fire on disagreeing expectations.
    let ok = dialect::parse(
        r#"(claim "f1" "step:2" "reads" "urn:e:Owner:tag:value" "required" "true")"#,
        Limits::default(),
    )
    .unwrap();
    assert_eq!(ok.len(), 1);

    for (modality, expected) in [
        ("permitted", "true"),
        ("assumed", "true"),
        ("required", "false"),
    ] {
        let artifact = format!(
            r#"(claim "f1" "step:2" "reads" "urn:e:Owner:tag:value" "{modality}" "{expected}")"#
        );
        let err = dialect::parse(&artifact, Limits::default()).unwrap_err();
        assert!(
            err.contains("required and expected to hold"),
            "{modality}/{expected} must be refused, got: {err}"
        );
    }
}

#[test]
fn a_flow_ends_with_an_end_row_and_a_malformed_step_reference_is_not_accepted() {
    let ok = dialect::parse(
        r#"(end "f1" "5")
           (claim "f1" "step:1" "to" "step:#2.1" "required" "true")"#,
        Limits::default(),
    )
    .unwrap();
    assert_eq!(ok.len(), 2, "an end row declares the end of a flow");

    let err = dialect::parse(
        r#"(claim "f1" "step:5" "to" "graph" "required" "true")"#,
        Limits::default(),
    )
    .unwrap_err();
    assert!(
        err.contains("(end"),
        "an edge to the graph names the row that replaces it: {err}"
    );

    let err = dialect::parse(
        r#"(claim "f1" "step:" "to" "step:1" "required" "true")"#,
        Limits::default(),
    )
    .unwrap_err();
    assert!(err.contains("is not a step reference"), "got: {err}");
}

#[test]
fn a_non_flow_claim_keeps_every_modality() {
    // The fixed pair applies only where a step or a graph is named. An ordinary
    // claim between declared entities is unaffected.
    let rows = dialect::parse(
        r#"(claim "f1" "urn:e:Owner" "requires" "urn:e:Owner:tag:value" "permitted" "true")"#,
        Limits::default(),
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
}

#[test]
fn either_new_row_at_the_wrong_arity_is_refused_with_the_atom_echoed() {
    for artifact in [
        r#"(step "f1")"#,
        r#"(guard "f1" "step:2" "input")"#,
        r#"(end "f1")"#,
        r#"(undeclared "f1")"#,
    ] {
        let err = dialect::parse(artifact, Limits::default()).unwrap_err();
        assert!(err.contains("columns"), "got: {err}");
        assert!(err.contains("f1"), "the offending atom is echoed: {err}");
    }
}

#[test]
fn a_flow_row_beside_a_rule_declaration_is_refused_whole() {
    let err =
        dialect::parse("(step \"f1\" \"1\")\n(rule ((f)) ((g)))", Limits::default()).unwrap_err();
    assert!(!err.is_empty());
}

// ------------------------------------------ minting steps and graphs (U2)

/// A one-source export whose component carries a Logic section.
///
/// Both failure modes this unit guards against end in silence rather than an
/// error: a wrongly flagged row suppresses its whole graph's reachability
/// check without saying so. These tests therefore assert on the *absence* of a
/// defect, which is the thing that would go unnoticed.
fn flow_input(paragraphs: &[&str]) -> DesignInput {
    // Blank lines keep every paragraph its own Facet.
    let mut text = String::from("component Flow {\n  logic {\n");
    for p in paragraphs {
        text.push_str(&format!("    {p}\n\n"));
    }
    text.push_str("  }\n}\n");
    let root = support::Workspace::new();
    root.write("flow.sigil", text.as_bytes());
    root.design_input()
}

fn facets_of(input: &DesignInput) -> Vec<String> {
    let mut units: Vec<_> = input.units.iter().collect();
    units.sort_by_key(|u| u.prose_range.start);
    units.into_iter().map(|u| u.id.clone()).collect()
}

#[test]
fn a_self_edge_is_a_loop_and_not_a_degenerate_claim() {
    // A step whose edge returns to itself is an ordinary shape in a looping
    // flow. Flagged degenerate, it would suppress the whole graph's dead-end
    // check -- silently, because a defect is reported and the check simply
    // stops running.
    let input = flow_input(&["first", "second"]);
    let f = facets_of(&input);
    let artifact = format!(
        r#"(step "{0}" "1")
           (claim "{0}" "step:1" "to" "step:1" "required" "true")"#,
        f[0]
    );
    let facts = accept(&input, "flow.sigil", &artifact).unwrap();
    let edge = facts
        .iter()
        .find(|x| matches!(x.body, Body::Claim { .. }))
        .unwrap();
    assert!(
        edge.defects.is_empty(),
        "a self-edge between steps is a loop, not a claim that says nothing: {:?}",
        edge.defects
    );
}

#[test]
fn a_claim_about_a_minted_step_is_grounded_by_construction() {
    // A minted step is in no Facet's resolved references, so checking it the
    // ordinary way would flag every flow claim -- and suppress every graph's
    // check without erroring.
    let input = flow_input(&["first", "second"]);
    let f = facets_of(&input);
    let artifact = format!(
        r#"(step "{0}" "1")
           (step "{1}" "1")
           (claim "{0}" "step:1" "to" "step:{1}.1" "required" "true")
           (end "{1}" "1")"#,
        f[0], f[1]
    );
    let facts = accept(&input, "flow.sigil", &artifact).unwrap();
    assert_eq!(facts.len(), 4);
    for fact in &facts {
        assert!(
            fact.defects.is_empty(),
            "minted steps and graphs ground in their own section: {:?}",
            fact.defects
        );
    }
}

#[test]
fn an_ordinary_claim_is_still_checked_for_degeneracy_and_grounding() {
    let base_interface = base_interface();
    // The carve-outs narrow the checks; they must not disable them.
    let input = shared_input();
    let facts = accept(
        &input,
        BASE,
        &format!(r#"(claim {base_interface:?} "Base" "requires" "Base" "required" "true")"#),
    )
    .unwrap();
    assert!(
        facts[0].defects.contains(&Defect::Degenerate),
        "same subject and object between declared entities still asserts nothing"
    );
}

#[test]
fn a_facet_may_not_declare_the_same_step_twice() {
    // A step's number is its place within its own Facet, so it names exactly
    // one step there. Declared twice, it would not resolve to one identity.
    let input = flow_input(&["first", "second"]);
    let f = facets_of(&input);
    let artifact = format!(r#"(step "{0}" "1") (step "{0}" "1")"#, f[0]);
    let err = accept(&input, "flow.sigil", &artifact).unwrap_err();
    assert!(err.contains("a second time"), "got: {err}");
}

#[test]
fn two_facets_of_one_section_may_each_have_a_first_step() {
    // Paragraphs number their own steps, so two of them both starting at 1 is
    // the ordinary case, and the tool tells them apart by position.
    let input = flow_input(&["first", "second"]);
    let f = facets_of(&input);
    let artifact = format!(r#"(step "{0}" "1") (step "{1}" "1")"#, f[0], f[1]);
    let facts = accept(&input, "flow.sigil", &artifact).unwrap();
    assert_eq!(facts.len(), 2);
    let ordinals: Vec<u32> = facts
        .iter()
        .filter_map(|fact| match fact.body {
            Body::Step { ordinal } => Some(ordinal),
            _ => None,
        })
        .collect();
    assert_eq!(ordinals.len(), 2);
    assert_ne!(
        ordinals[0], ordinals[1],
        "positions across the section differ"
    );
}

#[test]
fn a_row_naming_an_undeclared_step_is_refused() {
    let input = flow_input(&["first"]);
    let f = facets_of(&input);
    let artifact = format!(
        r#"(step "{0}" "1")
           (claim "{0}" "step:1" "to" "step:9" "required" "true")"#,
        f[0]
    );
    let err = accept(&input, "flow.sigil", &artifact).unwrap_err();
    assert!(err.contains("never declares"), "got: {err}");
}

#[test]
fn steps_at_different_ordinals_mint_different_identities() {
    let input = flow_input(&["first", "second"]);
    let f = facets_of(&input);
    let artifact = format!(r#"(step "{0}" "1") (step "{0}" "2")"#, f[0]);
    let facts = accept(&input, "flow.sigil", &artifact).unwrap();
    assert_ne!(facts[0].id, facts[1].id);
}

#[test]
fn a_guards_state_operand_grounds_and_its_input_operand_does_not() {
    let input = flow_input(&["first"]);
    let f = facets_of(&input);
    // An input value is a literal. A design that never declares `requestId`
    // must still accept a guard comparing against it.
    let artifact = format!(
        r#"(step "{0}" "1")
           (guard "{0}" "step:1" "input" "requestId")"#,
        f[0]
    );
    let facts = accept(&input, "flow.sigil", &artifact).unwrap();
    let guard = facts
        .iter()
        .find(|x| matches!(x.body, Body::Guard { .. }))
        .unwrap();
    assert!(
        guard.defects.is_empty(),
        "an input value never resolves as an entity"
    );
}

#[test]
fn a_guard_naming_an_unpresented_constraint_facet_is_refused() {
    let input = flow_input(&["first"]);
    let f = facets_of(&input);
    let artifact = format!(
        r#"(step "{0}" "1")
           (guard "{0}" "step:1" "constraint" "facet:elsewhere.sigil:1")"#,
        f[0]
    );
    let err = accept(&input, "flow.sigil", &artifact).unwrap_err();
    assert!(
        err.contains("not a Facet this request presented"),
        "got: {err}"
    );
}

// ------------------------------------- data mistakes versus non-data (R5/R6)

#[test]
fn a_row_that_is_data_but_wrong_is_set_aside_and_the_rest_are_kept() {
    let parsed = dialect::read(
        "(claim \"#1\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim \"#2\" \"Base\" \"offers\" \"value\" \"required\" \"true\")\n\
         (go-ahead \"#3\" \"step:7\")\n\
         (step \"#4\" 2)\n\
         (reading \"#5\" \"no-commitment\")\n",
        Limits::default(),
    )
    .unwrap();
    assert_eq!(parsed.rows.len(), 2, "the two clean rows survive");
    let facets: Vec<&str> = parsed.errors.iter().map(|e| e.facet.as_str()).collect();
    assert_eq!(facets, ["#2", "#3", "#4"], "each mistake names its Facet");
    assert!(
        parsed.errors[2].reason.contains("quoted string literal"),
        "a bare number is a mistake in its row: {:?}",
        parsed.errors[2]
    );
    assert!(
        dialect::parse(
            "(reading \"#5\" \"no-commitment\")\n(go-ahead \"#3\" \"step:7\")\n",
            Limits::default()
        )
        .is_err(),
        "the strict reader still refuses on any defect"
    );
}

#[test]
fn only_a_command_a_rule_or_a_nested_expression_refuses_the_whole_artifact() {
    for artifact in [
        "(rule ((a)) ((b)))\n",
        "(run 3)\n",
        "(claim \"#1\" \"Base\" (f \"x\") \"value\" \"required\" \"true\")\n",
        "(claim \"#1\" \"Base\" \"provides\"\n",
    ] {
        assert!(
            dialect::read(artifact, Limits::default()).is_err(),
            "{artifact} must refuse the artifact"
        );
    }
}

#[test]
fn handles_end_rows_and_undeclared_rows_read() {
    let parsed = dialect::read(
        r##"(end "#3" "2")
(undeclared "#3" "framework code")
(claim "#3" "step:1" "to" "step:#4.1" "required" "true")
(guard "#3" "step:#4.1" "constraint" "#5")"##,
        Limits::default(),
    )
    .unwrap();
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.rows.len(), 4);
}

#[test]
fn a_step_reference_reads_a_local_step_or_another_facets_step() {
    assert_eq!(
        vocabulary::local_step_ref("step:2"),
        Some(vocabulary::LocalStepRef {
            facet: None,
            ordinal: 2
        })
    );
    assert_eq!(
        vocabulary::local_step_ref("step:#7.1"),
        Some(vocabulary::LocalStepRef {
            facet: Some("#7".into()),
            ordinal: 1
        })
    );
    for bad in ["step:", "step:0", "step:#7.", "step:.1", "step:#7.x", "2"] {
        assert_eq!(vocabulary::local_step_ref(bad), None, "{bad}");
    }
}

#[test]
fn an_answer_written_as_json_is_refused_whole_with_the_format_named() {
    for artifact in [
        "[\n  \"(reading \\\"#1\\\" \\\"no-commitment\\\")\"\n]\n",
        "{\"rows\": [\"(reading \\\"#1\\\" \\\"no-commitment\\\")\"]}",
    ] {
        let error = dialect::read(artifact, Limits::default()).unwrap_err();
        assert!(error.contains("not JSON"), "got: {error}");
    }
}

#[test]
fn day_count_bounds_are_distinct_and_conflicting_lead_bounds_are_reported() {
    let root = support::Workspace::new();
    root.write("booking.sigil", b"component Booking {\n  goal {\n    Manage bookings.\n  }\n  constraints {\n    A *booking request* starts at most 180 days ahead and lasts at most 7 days.\n\n    The booking request starts at most 365 days ahead.\n  }\n}\n");
    let input = root.design_input();
    let request = request_for(&input, "booking.sigil");
    let facets: Vec<_> = request
        .rows
        .iter()
        .filter(|r| r.section == "constraints")
        .collect();
    assert_eq!(facets.len(), 2);
    let rows = format!(
        "(measure {:?} \"booking request\" \"maxLeadDays\" \"180\")\n(measure {:?} \"booking request\" \"maxDurationDays\" \"7\")\n",
        facets[0].facet, facets[0].facet
    );
    let facts = accept(&input, "booking.sigil", &rows).unwrap();
    assert_eq!(facts.len(), 2);
    assert!(facts.iter().any(|f| matches!(&f.body, Body::Measure { property, number, .. } if property == "maxLeadDays" && number == "180")));
    let world =
        sigilc::claims::program::saturate(&request, &facts, sigilc::engine::Limits::default())
            .unwrap();
    assert!(world.table("violation").is_empty());
    let conflicting = format!(
        "{rows}(measure {:?} \"booking request\" \"maxLeadDays\" \"365\")\n",
        facets[1].facet
    );
    let facts = accept(&input, "booking.sigil", &conflicting).unwrap();
    let world =
        sigilc::claims::program::saturate(&request, &facts, sigilc::engine::Limits::default())
            .unwrap();
    assert!(
        world
            .table("violation")
            .iter()
            .any(|r| r[0] == "conflicting-measure")
    );
    let invalid = format!(
        "{rows}(measure {:?} \"booking request\" \"maxSpanDays\" \"many\")\n",
        facets[1].facet
    );
    let parsed = dialect::read(&invalid, Limits::default()).unwrap();
    assert_eq!(
        parsed.rows.len(),
        2,
        "valid rows survive another unit's bad number"
    );
    assert_eq!(parsed.errors.len(), 1);
    assert!(parsed.errors[0].reason.contains("number"));
}
