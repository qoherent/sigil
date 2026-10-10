//! Tool-authored implementation laws over independent observations and scoped promises.
use super::{admit::Fact as CodeFact, dialect::Row};
use crate::{
    claims::{
        identity::{Body, Fact},
        prepare::AdmissibleEntity,
    },
    engine::{self, quote},
};
use egglog::EGraph;
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, time::Instant};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saturated {
    pub iterations: usize,
    pub tables: BTreeMap<String, Vec<Vec<Value>>>,
}
impl Saturated {
    pub fn table(&self, name: &str) -> &[Vec<Value>] {
        self.tables.get(name).map(Vec::as_slice).unwrap_or_default()
    }
}
fn measure(property: &str) -> Option<&'static str> {
    match property {
        "latencyBudgetMs" => Some("latencyMs"),
        "maxDurationDays" => Some("durationDays"),
        "maxLeadDays" => Some("leadDays"),
        "maxSpanDays" => Some("spanDays"),
        _ => None,
    }
}
/// No returned program is evaluated: every string here passed the dialect and
/// name admission gates. Component realization alone establishes membership.
pub fn program(entities: &[AdmissibleEntity], design: &[Fact], code: &[CodeFact]) -> String {
    let mut out = include_str!("laws.egg").to_owned();
    let mut emit = |name: &str, values: &[&str]| {
        out.push('\n');
        out.push_str(&format!(
            "({name} {})",
            values
                .iter()
                .map(|v| quote(v))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    };
    for e in entities {
        emit(
            "entity",
            &[&e.id, &e.kind, e.owner.as_deref().unwrap_or_default()],
        );
    }
    let members: BTreeMap<&str, Vec<&str>> = code
        .iter()
        .filter(|f| f.kind != "test")
        .filter_map(|f| match &f.row {
            Row::Realizes { design_name, .. }
                if entities
                    .iter()
                    .any(|e| e.id == *design_name && e.kind == "Component") =>
            {
                Some((f.element.as_str(), design_name.as_str()))
            }
            _ => None,
        })
        .fold(BTreeMap::new(), |mut m, (e, c)| {
            m.entry(e).or_default().push(c);
            m
        });
    for f in code.iter().filter(|f| f.kind != "test") {
        match &f.row {
            Row::Realizes { design_name, .. } => {
                if let Some(e) = entities.iter().find(|e| e.id == *design_name) {
                    emit(
                        if e.kind == "Component" {
                            "member"
                        } else {
                            "delivery"
                        },
                        &[&f.element, design_name, &f.id],
                    );
                }
            }
            Row::Act {
                relation,
                design_name,
                ..
            } => {
                emit("action", &[&f.element, relation, design_name, &f.id]);
                if relation == "owns" {
                    match members.get(f.element.as_str()) {
                        Some(components) => {
                            for c in components {
                                emit("owner", &[c, design_name, &f.id]);
                            }
                        }
                        None => emit("owner", &[&f.element, design_name, &f.id]),
                    }
                }
            }
            _ => {}
        }
    }
    for f in design
        .iter()
        .filter(|f| f.defects.is_empty() && crate::claims::program::commits(&f.section))
    {
        let required = !matches!(f.section.as_str(), "logic" | "cases");
        match &f.body {
            Body::Claim {
                subject,
                relation,
                object,
                modality,
                expected,
            } => {
                if relation == "owns" && expected == "true" && modality != "assumed" {
                    emit("rightful", &[object, subject]);
                }
                if modality != "required" {
                    continue;
                }
                if expected == "false" {
                    let rel = if relation == "requires" {
                        "provides"
                    } else {
                        relation
                    };
                    if ["uses", "owns", "invokes", "dependsOn", "provides"].contains(&rel) {
                        emit(
                            "forbidden",
                            &[&f.id, subject, rel, object, "prohibited-relation"],
                        );
                    }
                } else if relation == "excludes" {
                    emit(
                        "forbidden",
                        &[&f.id, subject, "uses", object, "excluded-use"],
                    );
                    emit(
                        "forbidden",
                        &[&f.id, subject, "provides", object, "excluded-capability"],
                    );
                } else if required
                    && entities
                        .iter()
                        .any(|e| e.id == *subject && e.kind == "Component")
                    && [
                        "uses",
                        "owns",
                        "invokes",
                        "dependsOn",
                        "provides",
                        "requires",
                    ]
                    .contains(&relation.as_str())
                {
                    emit(
                        "obligation",
                        &[
                            &f.id,
                            subject,
                            if relation == "requires" {
                                "provides"
                            } else {
                                relation
                            },
                            object,
                            relation,
                        ],
                    );
                }
            }
            Body::Property {
                subject,
                property,
                value,
            } if value == "true" => {
                if property == "exclusive" {
                    emit("exclusive", &[&f.id, subject]);
                }
                if property == "required"
                    && required
                    && entities.iter().any(|e| e.id == *subject && e.kind == "Tag")
                {
                    emit(
                        "obligation",
                        &[&f.id, subject, "owner", subject, "required-state-owner"],
                    );
                }
            }
            _ => {}
        }
    }
    // Float literals are re-emitted only from already admitted numeric strings.
    for f in code.iter().filter(|f| f.kind != "test") {
        if let Row::Measure {
            measure_name,
            number,
            ..
        } = &f.row
        {
            out.push_str(&format!(
                "\n(observed-number {} {} {:?} {})",
                quote(&f.element),
                quote(measure_name),
                number.parse::<f64>().expect("admitted measure"),
                quote(&f.id)
            ));
        }
    }
    for f in design
        .iter()
        .filter(|f| f.defects.is_empty() && crate::claims::program::commits(&f.section))
    {
        if let Body::Measure {
            subject,
            property,
            number,
        } = &f.body
            && let Some(p) = measure(property)
        {
            if !matches!(f.section.as_str(), "logic" | "cases") {
                out.push_str(&format!("\n(required-budget {})", quote(&f.id)));
            }
            out.push_str(&format!(
                "\n(budget {} {} {} {:?})",
                quote(&f.id),
                quote(subject),
                quote(p),
                number.parse::<f64>().expect("admitted design measure")
            ));
        }
    }
    out
}
// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::ImplementationLaws interface
pub fn saturate(
    entities: &[AdmissibleEntity],
    design: &[Fact],
    code: &[CodeFact],
    limits: engine::Limits,
) -> Result<Saturated, String> {
    if design.len().saturating_add(code.len()) > limits.max_input_assertions {
        return Err("alignment exceeds the accepted fact limit".into());
    }
    let started = Instant::now();
    let mut graph = EGraph::default();
    graph
        .parse_and_run_program(Some("sigil-align".into()), &program(entities, design, code))
        .map_err(|e| e.to_string())?;
    let iterations = engine::fixedpoint(&mut graph, limits, started)?;
    let mut tables = BTreeMap::new();
    for (name, arity) in [
        ("actual", 4),
        ("actual-number", 4),
        ("breach", 6),
        ("unanswered", 4),
    ] {
        tables.insert(name.into(), engine::rows(&graph, name, arity, limits)?);
    }
    engine::check_limits(&graph, limits, started)?;
    Ok(Saturated { iterations, tables })
}
