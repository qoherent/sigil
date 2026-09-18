use serde_json::{Value, json};
use sigilc::{
    claims::{
        dialect::{self, Limits, Row},
        identity::{self, Body, Defect},
        prepare::{self, Request},
        vocabulary,
    },
    frontend::DesignInput,
    turtle,
};

mod support;

const BASE: &str = "base.sigil";
const CONSUMER: &str = "consumer.sigil";
const BASE_GOAL: &str = "facet:base.sigil:29";
const BASE_INTERFACE: &str = "facet:base.sigil:71";
const BASE_CONSTRAINTS: &str = "facet:base.sigil:129";
const CONSUMER_GOAL: &str = "facet:consumer.sigil:75";
const CONSUMER_INTERFACE: &str = "facet:consumer.sigil:107";
const BASE_ID: &str = "urn:sigil:component:base.sigil:Base";
const VALUE_ID: &str = "urn:sigil:component:base.sigil:Base:tag:value";

fn input_from(value: Value) -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&value).unwrap()).unwrap()
}

fn shared_input() -> DesignInput {
    input_from(support::shared_value())
}

fn request_for(input: &DesignInput, source: &str) -> Request {
    prepare::project(input, source).unwrap()
}

/// Parse then admit, which is the order ingest uses.
fn accept(
    input: &DesignInput,
    source: &str,
    artifact: &str,
) -> Result<Vec<identity::Fact>, String> {
    let request = request_for(input, source);
    let rows = dialect::parse(artifact, Limits::default())?;
    identity::admit(&request, input, &rows)
}

// ---------------------------------------------------------------- data only

#[test]
fn an_artifact_carrying_a_rule_beside_a_valid_claim_is_refused_whole() {
    // Covers AE4.
    let artifact = format!(
        "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
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
    for offending in [
        "(ruleset extra)",
        "(run 3)",
        "(push)",
        "(relation sneaky (String))",
    ] {
        let artifact = format!(
            "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n{offending}\n"
        );
        assert!(
            dialect::parse(&artifact, Limits::default()).is_err(),
            "{offending} must be refused"
        );
    }
}

#[test]
fn a_non_literal_argument_is_refused() {
    for artifact in [
        format!("(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" true)\n"),
        format!("(measure {BASE_GOAL:?} \"Base\" \"risk\" 1)\n"),
        format!(
            "(claim {BASE_GOAL:?} \"Base\" \"provides\" (f \"value\") \"required\" \"true\")\n"
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
    // Both rows name an unknown relation. If validation ran first the error
    // would name the relation; the atom limit has to win.
    let artifact = format!(
        "(claim {BASE_GOAL:?} \"Base\" \"nonsense\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_GOAL:?} \"Base\" \"nonsense\" \"value\" \"required\" \"true\")\n"
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
    let artifact = format!("(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\")\n");
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(error.contains("6 columns"), "got: {error}");
    assert!(
        error.contains("\"provides\""),
        "must name the atom: {error}"
    );
}

#[test]
fn an_unknown_relation_modality_or_row_name_is_refused_with_the_offending_atom() {
    let cases = [
        (
            format!("(claim {BASE_GOAL:?} \"Base\" \"offers\" \"value\" \"required\" \"true\")\n"),
            "offers",
        ),
        (
            format!(
                "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"mandatory\" \"true\")\n"
            ),
            "mandatory",
        ),
        (
            format!(
                "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" \"maybe\")\n"
            ),
            "maybe",
        ),
        (format!("(assertion {BASE_GOAL:?} \"Base\")\n"), "assertion"),
        (
            format!("(property {BASE_GOAL:?} \"Base\" \"unknownFlag\" \"true\")\n"),
            "unknownFlag",
        ),
        (
            format!("(reading {BASE_GOAL:?} \"maybe-later\")\n"),
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
    let bad = [
        ("\"-1\"", "negative"),
        ("\"nan\"", "finite"),
        ("\"inf\"", "finite"),
    ];
    for (value, reason) in bad {
        let artifact = format!("(measure {BASE_GOAL:?} \"Base\" \"cost\" {value})\n");
        let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
        assert!(error.contains(reason), "{value} -> {error}");
    }
    let artifact = format!("(measure {BASE_GOAL:?} \"Base\" \"risk\" \"2\")\n");
    let error = dialect::parse(&artifact, Limits::default()).unwrap_err();
    assert!(error.contains("greater than one"), "got: {error}");
    assert!(
        dialect::parse(
            &format!("(measure {BASE_GOAL:?} \"Base\" \"risk\" \"0.5\")\n"),
            Limits::default()
        )
        .is_ok()
    );
}

#[test]
fn the_published_relations_are_read_through_the_compilers_public_accessor() {
    // KTD8: widening this would mean editing turtle.rs, whose text
    // eqval::fingerprint() hashes, invalidating every stored world.
    let expected: std::collections::BTreeSet<&str> =
        turtle::ENTITY_PREDICATES.iter().copied().collect();
    assert_eq!(vocabulary::relations(), expected);
    let all = turtle::vocabulary();
    for name in vocabulary::boolean_properties() {
        assert_eq!(all.get(name), Some(&"boolean"));
    }
    for name in vocabulary::numeric_properties() {
        assert_eq!(all.get(name), Some(&"number"));
    }
}

// ----------------------------------------------------------------- identity

#[test]
fn a_claim_naming_an_entity_outside_the_closure_is_refused_by_name() {
    // base.sigil imports nothing, so Consumer is not in its closure.
    let artifact = format!(
        "(claim {BASE_GOAL:?} \"Base\" \"dependsOn\" \"Consumer\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains("Consumer"), "got: {error}");
}

#[test]
fn a_claim_coining_an_identity_the_design_never_declared_is_refused() {
    let artifact = format!(
        "(claim {BASE_GOAL:?} \"Base\" \"provides\" \"RetryPolicy\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains("RetryPolicy"), "got: {error}");
    assert!(error.contains("declares"), "got: {error}");
}

#[test]
fn a_row_about_a_facet_the_request_did_not_ask_about_is_refused() {
    let artifact = format!(
        "(claim {CONSUMER_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    );
    let error = accept(&shared_input(), BASE, &artifact).unwrap_err();
    assert!(error.contains(CONSUMER_GOAL), "got: {error}");
}

#[test]
fn identity_is_minted_deterministically_and_distinguishes_bodies() {
    let input = shared_input();
    let artifact = format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    );
    let once = accept(&input, BASE, &artifact).unwrap();
    let twice = accept(&input, BASE, &artifact).unwrap();
    assert_eq!(once, twice, "the same artifact mints the same identity");
    assert_eq!(once.len(), 1);

    let other = accept(
        &input,
        BASE,
        &format!(
            "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"permitted\" \"true\")\n"
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
    let input = shared_input();
    let facts = accept(
        &input,
        BASE,
        &format!("(claim {BASE_GOAL:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"),
    )
    .unwrap();
    assert_eq!(facts[0].section, "goal");
    assert_eq!(facts[0].component, BASE_ID);

    let facts = accept(
        &input,
        BASE,
        &format!(
            "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
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
    // Covers AE1. The owning component has to be in the grounding set, or this
    // would be refused as ungrounded before the degenerate check could see it.
    let facts = accept(
        &shared_input(),
        BASE,
        &format!("(claim {BASE_GOAL:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n"),
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert!(
        facts[0].defects.contains(&Defect::Degenerate),
        "got {:?}",
        facts[0].defects
    );
    assert!(
        !facts[0]
            .defects
            .iter()
            .any(|d| matches!(d, Defect::Ungrounded(_))),
        "the Facet's own component grounds it: {:?}",
        facts[0].defects
    );
    assert!(!facts[0].satisfies_unit());
}

#[test]
fn a_claim_on_an_imported_tag_is_accepted_and_grounded() {
    // Covers AE5. consumer.sigil's interface Facet resolves both imported Tags.
    let facts = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {CONSUMER_INTERFACE:?} \"Consumer\" \"uses\" \"value\" \"required\" \"true\")\n"
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
fn an_entity_absent_from_this_facets_resolved_records_is_ungrounded() {
    // consumer.sigil's goal Facet references no Tag, so `value` could not have
    // come from it, even though the claim is admissible against the closure.
    let facts = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {CONSUMER_GOAL:?} \"Consumer\" \"uses\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert!(
        facts[0]
            .defects
            .contains(&Defect::Ungrounded(VALUE_ID.to_string())),
        "got {:?}",
        facts[0].defects
    );
    assert!(!facts[0].satisfies_unit());
}

#[test]
fn a_provider_component_reached_through_an_import_grounds_a_claim() {
    let facts = accept(
        &shared_input(),
        CONSUMER,
        &format!(
            "(claim {CONSUMER_GOAL:?} \"Consumer\" \"dependsOn\" \"Base\" \"required\" \"true\")\n"
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
fn an_ambiguous_tag_reference_is_not_grounding_evidence() {
    // KTD6's stated limit: the resolver could not say what the name means, so
    // it cannot vouch for a claim about it.
    // base.sigil's constraints Facet resolves two of its own Tags and takes part
    // in no import, so the reference status can be changed on its own.
    let mut value = support::shared_value();
    for reference in value["references"].as_array_mut().unwrap() {
        if reference["facet"] == BASE_CONSTRAINTS {
            reference["tag"] = Value::Null;
            reference["status"] = json!("ambiguous");
        }
    }
    let input = input_from(value);
    let grounded = accept(
        &shared_input(),
        BASE,
        &format!(
            "(claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert!(
        grounded[0].defects.is_empty(),
        "a resolved reference grounds the claim: {:?}",
        grounded[0].defects
    );
    let facts = accept(
        &input,
        BASE,
        &format!(
            "(claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    assert!(
        facts[0]
            .defects
            .contains(&Defect::Ungrounded(VALUE_ID.to_string())),
        "an ambiguous reference must not ground a claim: {:?}",
        facts[0].defects
    );
}

// ------------------------------------------------------- readings and gaps

#[test]
fn a_reading_row_is_accepted_retained_and_yields_no_claim() {
    let facts = accept(
        &shared_input(),
        BASE,
        &format!("(reading {BASE_GOAL:?} \"unresolved\")\n"),
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
                &format!("(reading {BASE_GOAL:?} {outcome:?})\n"),
                Limits::default()
            )
            .is_ok(),
            "{outcome} must be accepted"
        );
    }
}

#[test]
fn a_role_with_no_interpreted_row_is_a_gap_and_one_with_a_reading_is_not() {
    let input = shared_input();
    let request = request_for(&input, BASE);

    // Nothing returned at all: every declared role is a gap.
    let gaps = identity::uninterpreted(&request, &[]);
    assert_eq!(gaps.len(), 3, "base declares three roles: {gaps:?}");

    // A reading closes the goal role without asserting anything.
    let rows = dialect::parse(
        &format!("(reading {BASE_GOAL:?} \"no-commitment\")\n"),
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
        &format!("(claim {BASE_GOAL:?} \"Base\" \"provides\" \"Base\" \"required\" \"true\")\n"),
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
    assert!(dialect::facets(&rows).is_empty());
}
