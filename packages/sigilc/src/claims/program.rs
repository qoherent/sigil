//! Re-emit validated facts into a tool-authored program, then saturate.
//!
//! The interpreter's text is never evaluated. Every row below is written from
//! values this crate parsed and checked, which is what keeps a returned
//! artifact data rather than code.
use super::{
    identity::{Body, Fact},
    prepare::Request,
    vocabulary,
};
use crate::{assertions::quote, eqval};
use egglog::EGraph;
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, time::Instant};

/// The contract role whose claims commit to nothing.
///
/// Rationale does not convert a rejected alternative or an unaccepted proposal
/// into a commitment, so a Decisions claim is retained, reported and passed to
/// the judge while deriving nothing. Whether `cases` belongs here too is the
/// plan's one open question; adding it is a one-element change.
pub const NON_COMMITTING: &[&str] = &["decisions"];

/// Tables the saturated world exposes, with their arities.
const EXPORTED: &[(&str, usize)] = &[
    ("holds", 3),
    ("because", 5),
    ("reachable", 2),
    ("violation", 4),
    ("obligation", 4),
    ("unmet-obligation", 4),
    ("duplicate-proposition", 2),
    ("claim", 8),
    ("property", 6),
    ("measure", 6),
    ("reading", 2),
    ("facet", 4),
    ("section-declared", 2),
    ("entity", 5),
    ("flow-step", 3),
    ("flow-guard", 4),
    ("in-graph", 2),
    ("flow-touches", 2),
    // The lattice itself cannot cross this boundary: the saturation reader
    // decodes only string and float cells, so `reaches-end` stays inside the
    // program and the diagnostics rule writes this String-valued relation for
    // findings to read.
    ("unreached-step", 2),
    ("suppressed-graph", 1),
    ("constraint-governs", 2),
    ("step-violation", 4),
    ("unguarded-flow", 3),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saturated {
    pub guidance_fingerprint: String,
    pub iterations: usize,
    pub tables: BTreeMap<String, Vec<Vec<Value>>>,
}

impl Saturated {
    pub fn table(&self, name: &str) -> &[Vec<Value>] {
        self.tables.get(name).map(Vec::as_slice).unwrap_or_default()
    }
}

/// One cell of a saturated table row, as the exported rows encode it.
///
/// Lives here because this module owns `Saturated` and its row convention.
pub(super) fn text(row: &[Value], index: usize) -> String {
    row.get(index)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Whether claims authored under this contract role commit the design.
pub fn commits(section: &str) -> bool {
    !NON_COMMITTING.contains(&section)
}

/// Build the program this tool evaluates, as text.
///
/// Exposed so a reader can see exactly what was run: the laws are fixed, and
/// everything else is a row derived from the export or from an accepted fact.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::SectionAwareClosure interface,constraints,cases
pub fn program(request: &Request, facts: &[Fact]) -> String {
    let mut out = String::from(include_str!("claims.egg"));
    let mut row = |text: String| {
        out.push('\n');
        out.push_str(&text);
    };

    for section in vocabulary::SECTIONS.iter().filter(|s| commits(s)) {
        row(format!("(commits {})", quote(section)));
    }
    for facet in &request.rows {
        row(format!(
            "(facet {} {} {} {})",
            quote(&facet.facet),
            quote(&facet.component),
            quote(&facet.section),
            quote(&facet.source)
        ));
    }
    for (component, section) in &request.declared {
        row(format!(
            "(section-declared {} {})",
            quote(component),
            quote(section)
        ));
    }
    for entity in &request.entities {
        row(format!(
            "(entity {} {} {} {} {})",
            quote(&entity.id),
            quote(&entity.kind),
            quote(&entity.label),
            quote(entity.owner.as_deref().unwrap_or_default()),
            quote(&entity.source)
        ));
    }

    // One Graph entity per component whose Logic section declared a step. It
    // has no returned row of its own -- a graph is what the section is, not
    // something the interpretation declares -- so it is minted here from the
    // steps that do exist, matching `identity.rs`.
    let mut graphed: BTreeMap<&str, ()> = BTreeMap::new();
    for fact in facts.iter().filter(|f| f.defects.is_empty()) {
        if matches!(fact.body, Body::Step { .. }) {
            graphed.entry(fact.component.as_str()).or_default();
        }
    }
    // A defective row suppresses its whole graph rather than being dropped
    // alone. The fact itself is excluded from saturation below, so the marker
    // has to be emitted from the defect list before that happens.
    for fact in facts.iter().filter(|f| !f.defects.is_empty()) {
        if fact.section == "logic" {
            row(format!(
                "(set (graph-suppressed {}) 1)",
                quote(&fact.component)
            ));
            graphed.entry(fact.component.as_str()).or_default();
        }
    }

    for component in graphed.keys() {
        let id = crate::sources::hash(
            &serde_json::to_vec(&("sigil-flow-graph-v1", component, "logic"))
                .expect("graph identity serialization"),
        );
        row(format!(
            "(entity {} {} {} {} {})",
            quote(&id),
            quote("Graph"),
            quote("flow"),
            quote(component),
            quote("")
        ));
    }

    for fact in facts {
        // A defect (degenerate subject/object, or an entity absent from this
        // Facet's grounding set) is reported directly from this list in
        // findings.rs and context.rs, never from the saturated tables. Only
        // Claim/Property/Measure rows carry defects; Reading rows never do.
        // A defective claim/property/measure is excluded here so it cannot
        // manufacture a violation, an ownership conflict, or an obligation
        // against an entity the Facet never actually named.
        if !fact.defects.is_empty() {
            continue;
        }
        let head = format!(
            "{} {} {}",
            quote(&fact.id),
            quote(&fact.facet),
            quote(&fact.section)
        );
        match &fact.body {
            Body::Claim {
                subject,
                relation,
                object,
                modality,
                expected,
            } => row(format!(
                "(claim {head} {} {} {} {} {})",
                quote(subject),
                quote(relation),
                quote(object),
                quote(modality),
                quote(expected)
            )),
            Body::Property {
                subject,
                property,
                value,
            } => row(format!(
                "(property {head} {} {} {})",
                quote(subject),
                quote(property),
                quote(value)
            )),
            Body::Measure {
                subject,
                property,
                number,
            } => {
                // Already bounded and parsed by the dialect reader; re-emitted
                // from that parsed value rather than from the returned text.
                let parsed: f64 = number.parse().unwrap_or_default();
                row(format!(
                    "(measure {head} {} {} {parsed:?})",
                    quote(subject),
                    quote(property)
                ))
            }
            Body::Reading { outcome } => row(format!(
                "(reading {} {})",
                quote(&fact.facet),
                quote(outcome)
            )),
            // A step is an entity this tool minted, so it is emitted as one.
            // This is the single place where an `entity` row stops meaning
            // "the design declares this" and starts meaning "the design
            // declares this, or the tool derived it". The one law that joins
            // `entity` filters on the literal kind "Tag", so nothing that
            // already reads the table changes behaviour.
            Body::Step { ordinal } => {
                row(format!(
                    "(entity {} {} {} {} {})",
                    quote(&fact.id),
                    quote("Step"),
                    quote(&format!("step {ordinal}")),
                    quote(&fact.component),
                    quote(&fact.facet)
                ));
                row(format!(
                    "(flow-step {} {} {})",
                    quote(&fact.id),
                    quote(&fact.component),
                    quote(&fact.facet)
                ));
            }
            Body::Guard {
                step,
                operand,
                value,
            } => row(format!(
                "(flow-guard {} {} {} {})",
                quote(&fact.id),
                quote(&step.to_string()),
                quote(operand),
                quote(value)
            )),
        }
    }
    out
}

/// Saturate the program against the tool's laws and export sorted tables.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::SectionAwareClosure interface,constraints,cases
pub fn saturate(
    request: &Request,
    facts: &[Fact],
    limits: eqval::Limits,
) -> Result<Saturated, String> {
    if facts.len() > limits.max_input_assertions {
        return Err("interpretation exceeds the accepted fact limit".into());
    }
    let started = Instant::now();
    let mut graph = EGraph::default();
    graph
        .parse_and_run_program(Some("sigil-claims".into()), &program(request, facts))
        .map_err(|e| e.to_string())?;
    let iterations = eqval::fixedpoint(&mut graph, limits, started)?;
    let mut tables = BTreeMap::new();
    for (name, arity) in EXPORTED {
        tables.insert(
            (*name).to_owned(),
            eqval::rows(&graph, name, *arity, limits)?,
        );
    }
    eqval::check_limits(&graph, limits, started)?;
    Ok(Saturated {
        guidance_fingerprint: super::guidance::fingerprint(),
        iterations,
        tables,
    })
}
