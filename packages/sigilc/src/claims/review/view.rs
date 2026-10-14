//! The view: the projection written as short lines a judge reads whole.
use super::super::{
    context::SUBSUMED_CLAIM,
    findings::{Class, serde_name},
    identity::Body,
    program,
};
use super::{
    Inputs,
    evidence::UnitEntry,
    project::{Names, Projection, number},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
};

/// Write the view. `evidence_file` is the name of the evidence file beside it.
pub(super) fn render(inputs: &Inputs, projection: &Projection, evidence_file: &str) -> String {
    let (report, context) = (inputs.report, inputs.context);
    let names = &projection.names;
    let totals = &projection.totals;
    let mut out = String::new();
    let mut line = |text: String| {
        out.push_str(&text);
        out.push('\n');
    };

    line("# Sigil review view".into());
    line(String::new());
    line(format!(
        "Computation: whole workspace ({} sources); report filter: {}.",
        inputs.input.sources.len(),
        match inputs.filter {
            Some(source) => format!("{source} (findings below are those it authored part of)"),
            None => "none".into(),
        }
    ));
    line(format!(
        "State: {}. Findings: {}. Units: {} (interpreted {}, read-without-commitment {}, uninterpreted {}, unread {}, refused {}). Unresolved imports: {}.",
        serde_name(&report.state),
        report.findings.len(),
        totals.units,
        totals.interpreted,
        totals.read_without_commitment,
        totals.uninterpreted,
        totals.unread,
        totals.refused,
        totals.unresolved_imports,
    ));
    line(format!(
        "Evidence: {evidence_file} (report {}, context {}).",
        inputs.report_artifact.file, inputs.context_artifact.file
    ));
    line(String::new());
    line(
        "Aliases are local to this check. A claim is required and expected to hold unless marked. \
         A step is named by its claim alias. A conclusion a claim states directly is not repeated. \
         No prose is shown: retrieve a unit's prose through the evidence file."
            .into(),
    );

    line(String::new());
    line("## Vocabulary".into());
    for entity in &projection.entities {
        let mut text = format!(
            "{} {} {:?}",
            entity.alias,
            entity.kind.to_lowercase(),
            entity.label
        );
        if let Some(owner) = &entity.owner {
            let _ = write!(text, " of {owner}");
        } else if !entity.source.is_empty() {
            let _ = write!(text, " in {}", entity.source);
        }
        line(text);
    }

    // Units in source order, each with its claims beneath it.
    line(String::new());
    line("## Units and claims".into());
    let position: BTreeMap<&str, (&str, usize)> = inputs
        .input
        .units
        .iter()
        .map(|u| (u.id.as_str(), (u.source.as_str(), u.prose_range.start)))
        .collect();
    let mut ordered: Vec<usize> = (0..context.units.len()).collect();
    ordered.sort_by_key(|&u| {
        position
            .get(context.units[u].facet.as_str())
            .copied()
            .unwrap_or_default()
    });
    let entry_of: BTreeMap<&str, &UnitEntry> = projection
        .units
        .iter()
        .map(|u| (u.facet.as_str(), u))
        .collect();
    let mut source = "";
    for u in ordered {
        let unit = &context.units[u];
        let entry = entry_of[unit.facet.as_str()];
        if entry.source != source {
            source = &entry.source;
            line(format!("### {source}"));
        }
        let mut text = format!(
            "{} {} {} · {}",
            entry.alias,
            entry.component,
            entry.section,
            serde_name(&entry.coverage)
        );
        if !program::commits(&entry.section) {
            text.push_str(" · non-committing");
        }
        line(text);
        // A flow reads in step order: each step, then what it does and what
        // guards it. Every other claim comes first.
        let mut asserted: Vec<_> = unit.asserted.iter().collect();
        asserted.sort_by_cached_key(|a| {
            let place = match &a.body {
                Body::Step { ordinal } => (*ordinal, 0),
                Body::Claim { subject, .. } => names.steps.get(subject).map_or((0, 0), |o| (*o, 1)),
                Body::Guard { step, .. } => (*step, 2),
                _ => (0, 0),
            };
            (place, number(&names.claim(&a.claim)))
        });
        for asserted in asserted {
            let mut text = format!(
                "  {} {}",
                names.claim(&asserted.claim),
                body(&asserted.body, names)
            );
            if !asserted.satisfies_unit {
                text.push_str(" [defective]");
            }
            line(text);
        }
    }

    if !projection.conclusions.is_empty() {
        line(String::new());
        line("## Conclusions".into());
        for conclusion in &projection.conclusions {
            let laws: BTreeSet<&str> = conclusion
                .derivations
                .iter()
                .map(|d| d.law.as_str())
                .collect();
            let mut premises: Vec<&str> = Vec::new();
            for derivation in &conclusion.derivations {
                for premise in &derivation.premises {
                    if !premises.contains(&premise.as_str()) {
                        premises.push(premise);
                    }
                }
            }
            let mut text = format!(
                "{} {} {} {} ({})",
                conclusion.alias,
                names.of(&conclusion.subject),
                conclusion.relation,
                names.of(&conclusion.object),
                laws.into_iter().collect::<Vec<_>>().join(", ")
            );
            if !premises.is_empty() {
                text.push_str(" · from ");
                text.push_str(&premises.join(" "));
            }
            line(text);
        }
    }

    if !projection.obligations.is_empty() {
        line(String::new());
        line("## Obligations".into());
        for (entry, obligation) in &projection.obligations {
            line(format!(
                "{} {}: {} {} {} · {}",
                entry.alias,
                names.at(&obligation.promise.claim),
                names.of(&obligation.subject),
                obligation.relation,
                names.of(&obligation.object),
                if entry.filled { "filled" } else { "unmet" }
            ));
        }
    }

    line(String::new());
    line("## Findings".into());
    if report.findings.is_empty() {
        line("None.".into());
    }
    // A detail sentence shared by many findings is written once, as a note.
    let mut notes: Vec<&str> = Vec::new();
    for (entry, finding) in &projection.findings {
        let class = serde_name(&finding.class);
        let mut text = format!(
            "{} {class} {}: {} → {}",
            entry.alias,
            finding.law,
            names.of(&finding.subject),
            if finding.object.is_empty() {
                "—".to_owned()
            } else {
                names.of(&finding.object)
            }
        );
        if finding.claims.is_empty() {
            let _ = write!(
                text,
                " · {} {}",
                names.of(&finding.component),
                finding.section
            );
        } else {
            let _ = write!(
                text,
                " · {}",
                finding
                    .claims
                    .iter()
                    .map(|c| names.at(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        if !entry.obligations.is_empty() {
            let _ = write!(text, " · {}", entry.obligations.join(", "));
        }
        // A gap's detail restates its name, and an unmet obligation's restates
        // the obligation named beside it.
        let restated = finding.class == Class::Gap || finding.class == Class::UnmetObligation;
        if !restated && !finding.detail.is_empty() {
            let index = notes
                .iter()
                .position(|n| *n == finding.detail)
                .unwrap_or_else(|| {
                    notes.push(&finding.detail);
                    notes.len() - 1
                });
            let _ = write!(text, " · note {}", index + 1);
        }
        line(text);
    }
    if !notes.is_empty() {
        line(String::new());
        line("Notes:".into());
        for (n, note) in notes.iter().enumerate() {
            line(format!("note {}: {note}", n + 1));
        }
    }

    if !projection.simplifications.is_empty() {
        line(String::new());
        line("## Simplification candidates".into());
        for (entry, ids) in &projection.simplifications {
            let claims: Vec<String> = ids.iter().map(|id| names.at(id)).collect();
            let mut text = format!("{} {}: {}", entry.alias, entry.kind, claims.join(", "));
            if entry.kind == SUBSUMED_CLAIM {
                text.push_str(" (already derived by another route)");
            }
            line(text);
        }
    }

    line(String::new());
    line("## Coverage".into());
    if projection.unread.is_empty() {
        line("Unread: none.".into());
    }
    for (entry, unit) in &projection.unread {
        line(format!(
            "{} {} {} in {}: {}",
            if unit.refusal.is_some() {
                "Refused"
            } else {
                "Unread"
            },
            entry.units.join(", "),
            unit.section,
            unit.source,
            unit.refusal.as_deref().unwrap_or("no stored reading"),
        ));
    }
    let unresolved = report.unresolved_imports.as_deref().unwrap_or_default();
    if unresolved.is_empty() {
        line("Unresolved imports: none.".into());
    }
    for import in unresolved {
        line(format!(
            "Unresolved import in {}: {} from {} ({})",
            import.source, import.provider, import.path, import.status
        ));
    }
    line(format!(
        "Non-committing roles: {}.",
        context.non_committing_roles.join(", ")
    ));
    out
}

/// One claim body, every column kept.
fn body(body: &Body, names: &Names) -> String {
    match body {
        Body::Claim {
            subject,
            relation,
            object,
            modality,
            expected,
        } => {
            let mut text = format!("{} {relation} {}", names.of(subject), names.of(object));
            let mut marks = Vec::new();
            if modality != "required" {
                marks.push(modality.clone());
            }
            if expected != "true" {
                marks.push(format!("expected {expected}"));
            }
            if !marks.is_empty() {
                let _ = write!(text, " ({})", marks.join(", "));
            }
            text
        }
        Body::Property {
            subject,
            property,
            value,
        } => format!("property {} {property} = {value}", names.of(subject)),
        Body::Measure {
            subject,
            property,
            number,
        } => format!("measure {} {property} = {number}", names.of(subject)),
        Body::Reading { outcome } => format!("reading {outcome}"),
        Body::Step { ordinal } => format!("step {ordinal}"),
        Body::Guard {
            step,
            operand,
            value,
        } => format!("guard step {step}: {operand} = {}", names.of(value)),
        Body::Undeclared { name, declared } => match declared {
            Some(entity) => format!(
                "undeclared {name:?} (declared as {}, not referenced here)",
                names.of(entity)
            ),
            None => format!("undeclared {name:?}"),
        },
    }
}
