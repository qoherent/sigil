//! Resolve what the interpretation wrote against the request it answered.
//!
//! An interpretation names Facets by handle and numbers a flow's steps within
//! the Facet that states them, because neither the 64-character id nor a count
//! kept across a whole Logic section is something a model copies reliably. This
//! pass turns that into the form everything downstream reads: full Facet ids,
//! step positions across the section, and an edge to the graph where a flow
//! ends. Stored readings hold that resolved form, so a handle never outlives
//! the presentation it was written for.
//!
//! A row that cannot be resolved becomes an [`Issue`] for the unit it belongs
//! to. Nothing here refuses the artifact: that decision is the caller's.
use super::{
    dialect::{self, Parsed, Row},
    prepare::Request,
    vocabulary,
};
use std::collections::{BTreeMap, BTreeSet};

/// A row that could not be accepted, and the Facet it was about when that
/// Facet is one this request asked for.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Issue {
    /// The full Facet id, or `None` when the row names no Facet the request
    /// asked about, which leaves it with no unit to refuse.
    pub facet: Option<String>,
    pub row: String,
    pub reason: String,
}

impl Issue {
    /// The issue as one line, the row and then why it was set aside.
    pub fn line(&self) -> String {
        format!("{}: {}", self.row, self.reason)
    }
}

/// The rows of an interpretation in their resolved form, and what was left out.
#[derive(Debug, Clone, Default)]
pub struct Resolved {
    pub rows: Vec<Row>,
    pub issues: Vec<Issue>,
}

/// Where a Logic Facet sits: its component's section and its place in it.
struct Place<'a> {
    component: &'a str,
    position: usize,
}

/// Resolve `parsed` against the request it answers.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ReturnedClaims interface,constraints,cases
pub fn resolve(request: &Request, parsed: Parsed) -> Resolved {
    let own: BTreeSet<&str> = request.own_rows().map(|r| r.facet.as_str()).collect();
    let by_handle: BTreeMap<&str, &str> = request
        .own_rows()
        .filter(|r| !r.handle.is_empty())
        .map(|r| (r.handle.as_str(), r.facet.as_str()))
        .collect();
    let places: BTreeMap<&str, Place> = request
        .flows
        .iter()
        .flat_map(|flow| {
            flow.facets.iter().enumerate().map(|(position, facet)| {
                (
                    facet.as_str(),
                    Place {
                        component: flow.component.as_str(),
                        position,
                    },
                )
            })
        })
        .collect();

    // A handle becomes its Facet's id; an id is taken as written.
    let facet_of = |raw: &str| -> Result<String, String> {
        if raw.starts_with(vocabulary::HANDLE_PREFIX) {
            by_handle
                .get(raw)
                .map(|facet| (*facet).to_owned())
                .ok_or_else(|| format!("{raw:?} is not a handle this request assigned"))
        } else {
            Ok(raw.to_owned())
        }
    };

    let mut out = Resolved::default();

    // Rows that did not read cleanly keep the Facet they were about.
    for error in &parsed.errors {
        let facet = facet_of(&error.facet)
            .ok()
            .filter(|f| own.contains(f.as_str()));
        out.issues.push(Issue {
            facet,
            row: error.row.clone(),
            reason: error.reason.clone(),
        });
    }

    // Rows about a Facet this request did not ask about have no unit.
    let mut rows: Vec<(String, Row)> = Vec::new();
    for row in parsed.rows {
        match facet_of(row.facet()) {
            Ok(facet) if own.contains(facet.as_str()) => rows.push((facet, row)),
            Ok(facet) => out.issues.push(Issue {
                facet: None,
                row: dialect::render_row(&row),
                reason: format!(
                    "names {facet:?}, which this request did not ask about; Facets marked \
                     context are shown for their names and answered by their own source"
                ),
            }),
            Err(reason) => out.issues.push(Issue {
                facet: None,
                row: dialect::render_row(&row),
                reason,
            }),
        }
    }

    // Step declarations first: every reference resolves against them.
    let mut declared: BTreeMap<&str, BTreeSet<(usize, u32)>> = BTreeMap::new();
    let mut seen: BTreeSet<(String, u32)> = BTreeSet::new();
    let mut skipped: BTreeSet<usize> = BTreeSet::new();
    for (index, (facet, row)) in rows.iter().enumerate() {
        let Row::Step { ordinal, .. } = row else {
            continue;
        };
        let Some(place) = places.get(facet.as_str()) else {
            out.issues.push(issue(
                facet,
                row,
                "declares a step in a Facet that is not Logic prose; a flow is Logic prose".into(),
            ));
            skipped.insert(index);
            continue;
        };
        if !seen.insert((facet.clone(), *ordinal)) {
            out.issues.push(issue(
                facet,
                row,
                format!("declares step {ordinal} of this Facet a second time"),
            ));
            skipped.insert(index);
            continue;
        }
        declared
            .entry(place.component)
            .or_default()
            .insert((place.position, *ordinal));
    }
    // A step's position across its section: the Facet's place, then its number.
    let mut section_ordinal: BTreeMap<(&str, usize, u32), u32> = BTreeMap::new();
    for (component, steps) in &declared {
        for (rank, (position, ordinal)) in steps.iter().enumerate() {
            section_ordinal.insert((*component, *position, *ordinal), rank as u32 + 1);
        }
    }

    // `step:K` and `step:#N.K` as the step's position across its section, from
    // the Facet that wrote the reference.
    let step_position = |from: &str, written: &str| -> Result<u32, String> {
        let reference = vocabulary::local_step_ref(written)
            .ok_or_else(|| format!("{written:?} is not a step reference"))?;
        let home = places.get(from).ok_or_else(|| {
            format!("{written:?} names a step, and only a Logic Facet can name one")
        })?;
        let target = match &reference.facet {
            Some(raw) => facet_of(raw)?,
            None => from.to_owned(),
        };
        let place = places
            .get(target.as_str())
            .filter(|p| p.component == home.component);
        let ordinal = place.and_then(|p| {
            section_ordinal
                .get(&(p.component, p.position, reference.ordinal))
                .copied()
        });
        ordinal.ok_or_else(|| {
            format!(
                "{written:?} names a step its Logic section never declares; a row pointing \
                 at an undeclared step would read as a dead end"
            )
        })
    };
    // The same position, written as the section-wide `step:N` a row carries on.
    let resolve_step = |from: &str, written: &str| -> Result<String, String> {
        step_position(from, written).map(|n| format!("{}{n}", vocabulary::STEP_REF))
    };

    for (index, (facet, row)) in rows.iter().enumerate() {
        if skipped.contains(&index) {
            continue;
        }
        let resolved: Result<Row, String> = match row {
            Row::Claim {
                subject,
                relation,
                object,
                modality,
                expected,
                ..
            } => {
                let name = |raw: &str| {
                    if vocabulary::is_flow_ref(raw) {
                        resolve_step(facet, raw)
                    } else {
                        Ok(raw.to_owned())
                    }
                };
                name(subject).and_then(|subject| {
                    name(object).map(|object| Row::Claim {
                        facet: facet.clone(),
                        subject,
                        relation: relation.clone(),
                        object,
                        modality: modality.clone(),
                        expected: expected.clone(),
                    })
                })
            }
            Row::Property { .. }
            | Row::Measure { .. }
            | Row::Reading { .. }
            | Row::Undeclared { .. } => Ok(row.with_facet(facet.clone())),
            Row::Step { ordinal, .. } => {
                step_position(facet, &format!("{}{ordinal}", vocabulary::STEP_REF)).map(|ordinal| {
                    Row::Step {
                        facet: facet.clone(),
                        ordinal,
                    }
                })
            }
            Row::End { ordinal, .. } => {
                resolve_step(facet, &format!("{}{ordinal}", vocabulary::STEP_REF)).map(|step| {
                    // The edge to the graph is what declares an end. The row says
                    // which step the prose ends at; the tool writes the edge.
                    Row::Claim {
                        facet: facet.clone(),
                        subject: step,
                        relation: "to".into(),
                        object: vocabulary::GRAPH_REF.into(),
                        modality: "required".into(),
                        expected: "true".into(),
                    }
                })
            }
            Row::Guard {
                step,
                operand,
                value,
                ..
            } => resolve_step(facet, step).and_then(|step| {
                let value = if operand == "constraint" {
                    facet_of(value)?
                } else {
                    value.clone()
                };
                Ok(Row::Guard {
                    facet: facet.clone(),
                    step,
                    operand: operand.clone(),
                    value,
                })
            }),
        };
        match resolved {
            Ok(row) => out.rows.push(row),
            Err(reason) => out.issues.push(issue(facet, row, reason)),
        }
    }
    out.issues.sort();
    out.issues.dedup();
    out
}

fn issue(facet: &str, row: &Row, reason: String) -> Issue {
    Issue {
        facet: Some(facet.to_owned()),
        row: dialect::render_row(row),
        reason,
    }
}
