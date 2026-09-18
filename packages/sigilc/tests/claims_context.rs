use sigilc::{
    claims::{
        context::{self, Context, Coverage},
        dialect::{self, Limits},
        findings::{self, Identity},
        identity::{self, Fact},
        prepare::{self, Request},
        program,
    },
    eqval,
    frontend::DesignInput,
};
use std::{fs, path::PathBuf};

mod support;

const BASE: &str = "base.sigil";
const BASE_GOAL: &str = "facet:base.sigil:29";
const BASE_INTERFACE: &str = "facet:base.sigil:71";
const BASE_CONSTRAINTS: &str = "facet:base.sigil:129";

fn shared_input() -> DesignInput {
    DesignInput::parse(&serde_json::to_vec(&support::shared_value()).unwrap()).unwrap()
}

fn run(artifact: &str) -> (Request, Vec<Fact>, Context) {
    let input = shared_input();
    let request = prepare::project(&input, BASE).unwrap();
    let rows = dialect::parse(artifact, Limits::default()).unwrap();
    let facts = identity::admit(&request, &input, &rows).unwrap();
    let world = program::saturate(&request, &input, &facts, eqval::Limits::default()).unwrap();
    let identity = Identity {
        export_digest: request.binding.export_digest.clone(),
        interpretations: vec!["artifact".into()],
        guidance_fingerprint: world.guidance_fingerprint.clone(),
        vocabulary_generation: request.binding.vocabulary_generation,
    };
    let context = context::build(&request, &facts, &world, identity);
    (request, facts, context)
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .unwrap()
}

// ------------------------------------------------------------------ coverage

#[test]
fn every_unit_in_the_design_appears_even_with_nothing_found_about_it() {
    // R21. Only the interface Facet is interpreted; all three still appear, so
    // a defect in an untouched unit stays reachable by the judge.
    let (request, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    assert_eq!(context.units.len(), request.rows.len());
    assert_eq!(context.units.len(), 3, "base.sigil declares three Facets");

    let bare: Vec<_> = context
        .units
        .iter()
        .filter(|u| u.asserted.is_empty())
        .collect();
    assert_eq!(bare.len(), 2, "two units drew nothing and still appear");
    for unit in bare {
        assert_eq!(unit.coverage, Coverage::Uninterpreted);
        assert!(!unit.prose.is_empty(), "even a bare unit carries its prose");
    }
}

#[test]
fn coverage_distinguishes_a_read_facet_from_an_untouched_one() {
    let (_, _, context) = run(&format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    let coverage = |facet: &str| {
        context
            .units
            .iter()
            .find(|u| u.facet == facet)
            .unwrap()
            .coverage
    };
    assert_eq!(coverage(BASE_GOAL), Coverage::ReadWithoutCommitment);
    assert_eq!(coverage(BASE_INTERFACE), Coverage::Interpreted);
    assert_eq!(coverage(BASE_CONSTRAINTS), Coverage::Uninterpreted);
}

// ---------------------------------------------------------------- provenance

#[test]
fn a_derived_conclusion_carries_the_law_and_witness_that_reached_it() {
    // R20. The judge reads the conclusion rather than re-deriving it.
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"delegates\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_INTERFACE:?} \"result\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    let unit = context
        .units
        .iter()
        .find(|u| u.facet == BASE_INTERFACE)
        .unwrap();
    assert!(
        unit.derived.iter().any(|d| d.law == "asserted"),
        "{:?}",
        unit.derived
    );
    for conclusion in &unit.derived {
        assert!(!conclusion.law.is_empty());
        assert!(!conclusion.witness.is_empty());
    }
}

// --------------------------------------------------------------- obligations

#[test]
fn an_unfilled_promise_names_what_raised_it_and_where_it_is_stated() {
    // R22, and the one missing-detail admission element that is a fact:
    // "The existing promise or supplied intent that makes the omission
    // relevant" (integrations/skills/sigil-evaluate/references/design-review.md).
    let (request, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n"
    ));
    let unit = context
        .units
        .iter()
        .find(|u| u.facet == BASE_INTERFACE)
        .unwrap();
    assert_eq!(unit.obligations.len(), 1, "{:?}", unit.obligations);
    let obligation = &unit.obligations[0];
    assert!(!obligation.filled, "nothing provides result");
    assert_eq!(obligation.relation, "provides");

    let promise = &obligation.promise;
    assert!(!promise.claim.is_empty(), "the promise names its claim");
    assert_eq!(promise.facet, BASE_INTERFACE);
    assert_eq!(promise.section, "interface");
    assert_eq!(promise.source, BASE);
    let expected = &request
        .rows
        .iter()
        .find(|r| r.facet == BASE_INTERFACE)
        .unwrap()
        .prose;
    assert_eq!(
        &promise.prose, expected,
        "where the promise is stated is carried as authored text"
    );

    // The admission element this satisfies is really in that document.
    let rules = fs::read_to_string(
        repo_root().join("integrations/skills/sigil-evaluate/references/design-review.md"),
    )
    .unwrap();
    assert!(
        rules.contains("The existing promise or supplied intent that makes the omission"),
        "the admission rule this context targets must still be worded that way"
    );
}

#[test]
fn a_promise_that_is_met_still_appears_with_its_filled_state() {
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n"
    ));
    let unit = context
        .units
        .iter()
        .find(|u| u.facet == BASE_INTERFACE)
        .unwrap();
    assert_eq!(unit.obligations.len(), 1);
    assert!(
        unit.obligations[0].filled,
        "a met promise is recorded as met, not omitted: {:?}",
        unit.obligations
    );
}

// ------------------------------------------------------------ simplification

#[test]
fn the_same_proposition_in_two_units_is_proposed_without_a_verdict() {
    // R23.
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    let duplicates: Vec<_> = context
        .simplification
        .iter()
        .filter(|c| c.kind == "duplicate-proposition")
        .collect();
    assert!(!duplicates.is_empty(), "{:?}", context.simplification);
    let candidate = duplicates[0];
    assert_eq!(candidate.claims.len(), 2);
    assert_eq!(candidate.facets.len(), 2);
    assert!(
        candidate.detail.contains("may preserve"),
        "a candidate, not a ruling: {}",
        candidate.detail
    );
}

#[test]
fn a_claim_the_laws_already_derive_is_proposed_as_subsumed() {
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"delegates\" \"result\" \"required\" \"true\")\n\
         (claim {BASE_INTERFACE:?} \"result\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    let subsumed: Vec<_> = context
        .simplification
        .iter()
        .filter(|c| c.kind == "subsumed-claim")
        .collect();
    assert!(
        !subsumed.is_empty(),
        "delegation already reaches this: {:?}",
        context.simplification
    );
    assert!(
        subsumed[0].detail.contains("already derive"),
        "{}",
        subsumed[0].detail
    );
}

#[test]
fn a_design_with_nothing_redundant_proposes_nothing() {
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    assert!(
        context.simplification.is_empty(),
        "{:?}",
        context.simplification
    );
}

// ------------------------------------------------------------ self-sufficiency

#[test]
fn a_consumer_can_quote_evidence_without_opening_a_sigil_file() {
    // R24. Everything a missing-detail question needs is in the context.
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n"
    ));
    // What a consumer actually receives is the serialized form, so the check
    // is that the prose survives it rather than that it appears verbatim in
    // the encoded bytes.
    let delivered: Context =
        serde_json::from_slice(&serde_json::to_vec(&context).unwrap()).unwrap();
    for (unit, received) in context.units.iter().zip(&delivered.units) {
        assert!(
            !unit.prose.is_empty(),
            "unit {} carries no prose",
            unit.facet
        );
        assert!(!unit.component_label.is_empty());
        assert_eq!(received.prose, unit.prose);
        assert_eq!(received.facet, unit.facet);
    }
    // And the judge is told which roles commit nothing, so a Decisions Facet
    // deriving nothing does not read as a bug.
    assert_eq!(context.non_committing_roles, vec!["decisions".to_string()]);
    assert_eq!(context.version, context::CONTEXT_VERSION);
}

#[test]
fn the_context_records_what_it_was_computed_from() {
    let (request, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n"
    ));
    assert_eq!(context.source, BASE);
    assert_eq!(
        context.identity.export_digest,
        request.binding.export_digest
    );
    assert_eq!(
        context.identity.guidance_fingerprint,
        sigilc::claims::guidance::fingerprint()
    );
    assert_eq!(
        context.identity.vocabulary_generation,
        request.binding.vocabulary_generation
    );
}

#[test]
fn the_context_round_trips_through_its_serialized_form() {
    let (_, _, context) = run(&format!(
        "(claim {BASE_INTERFACE:?} \"Base\" \"requires\" \"result\" \"required\" \"true\")\n"
    ));
    let bytes = serde_json::to_vec(&context).unwrap();
    let back: Context = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(back, context);
    // The report and the context agree on identity, so a consumer can pair them.
    assert_eq!(context.identity.vocabulary_generation, 1);
    assert_eq!(findings::REPORT_VERSION, 1);
}
