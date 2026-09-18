//! The data-only reader for a returned claims artifact.
//!
//! Adapted from the compiler's restricted assertion transport: the artifact is
//! parsed with egglog's own AST reader so its syntax is not re-implemented, and
//! then every command that is not a literal-argument call is refused. Nothing
//! here is ever evaluated — the host re-emits accepted rows into a program it
//! writes itself.
use super::vocabulary;

/// Bounds applied before the work they protect.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_document_bytes: usize,
    pub max_atoms: usize,
}

impl Default for Limits {
    fn default() -> Self {
        // Matched to the compiler's assertion transport so one interpretation
        // cannot be larger than the world it describes.
        Self {
            max_document_bytes: 1_000_000,
            max_atoms: 100_000,
        }
    }
}

/// A row exactly as the interpreter wrote it, before identity or grounding.
///
/// Carries no claim identity and no contract role: the host mints the first and
/// looks up the second.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Row {
    Claim {
        facet: String,
        subject: String,
        relation: String,
        object: String,
        modality: String,
        expected: String,
    },
    Property {
        facet: String,
        subject: String,
        property: String,
        value: String,
    },
    Measure {
        facet: String,
        subject: String,
        property: String,
        number: String,
    },
    Reading {
        facet: String,
        outcome: String,
    },
}

impl Row {
    pub fn facet(&self) -> &str {
        match self {
            Row::Claim { facet, .. }
            | Row::Property { facet, .. }
            | Row::Measure { facet, .. }
            | Row::Reading { facet, .. } => facet,
        }
    }

    pub fn relation_name(&self) -> &'static str {
        match self {
            Row::Claim { .. } => "claim",
            Row::Property { .. } => "property",
            Row::Measure { .. } => "measure",
            Row::Reading { .. } => "reading",
        }
    }
}

/// Read an artifact into rows, refusing the whole document on any defect.
///
/// Partial acceptance is deliberately impossible: an artifact that supplies a
/// law is not a partly usable interpretation, and keeping the valid rows beside
/// a rejected one would make the refusal advisory.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ReturnedClaims interface,constraints,cases
pub fn parse(source: &str, limits: Limits) -> Result<Vec<Row>, String> {
    if source.len() > limits.max_document_bytes {
        return Err(format!(
            "claims artifact exceeds byte limit: {} > {}",
            source.len(),
            limits.max_document_bytes
        ));
    }
    refuse_deep_nesting(source)?;
    let atoms = atoms(source, limits)?;
    let mut rows = Vec::new();
    for (name, values) in atoms {
        rows.push(row(&name, &values)?);
    }
    Ok(rows)
}

/// The nesting depth beyond which an artifact is refused before parsing.
///
/// Every accepted row is one flat call with literal-only arguments, so a
/// well-formed artifact never nests past depth 1. This leaves generous slack.
const MAX_NESTING_DEPTH: usize = 8;

/// Bound nesting depth with one linear scan, before egglog's own parser ever
/// sees the text.
///
/// `EGraph::parse_program` recurses once per level of paren nesting with no
/// depth guard of its own, so a payload well inside the byte limit can still
/// exhaust the native stack and crash the process before this validator's
/// atom-count check, or any row check, ever runs. This scan is the actual
/// bound: it is cheap, and it runs first.
fn refuse_deep_nesting(source: &str) -> Result<(), String> {
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escaped = false;
    for ch in source.chars() {
        if in_string {
            match (escaped, ch) {
                (false, '\\') => escaped = true,
                (false, '"') => in_string = false,
                _ => escaped = false,
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '(' => {
                depth += 1;
                if depth > MAX_NESTING_DEPTH {
                    return Err(format!(
                        "claims artifact nests more than {MAX_NESTING_DEPTH} levels deep"
                    ));
                }
            }
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    Ok(())
}

/// Every call atom in the artifact, with its literal string arguments.
///
/// Refuses anything that is not a call whose arguments are all string literals:
/// a rule, a ruleset, a command, a schedule, a nested expression, or a number.
fn atoms(source: &str, limits: Limits) -> Result<Vec<(String, Vec<String>)>, String> {
    use egglog::{
        EGraph,
        ast::{Action, Command, Expr, Literal},
    };
    let commands = EGraph::default()
        .parse_program(None, source)
        .map_err(|e| e.to_string())?;
    if commands.len() > limits.max_atoms {
        return Err(format!(
            "claims artifact exceeds atom limit: {} > {}",
            commands.len(),
            limits.max_atoms
        ));
    }
    let mut atoms = Vec::new();
    for command in commands {
        let Command::Action(Action::Expr(_, Expr::Call(_, name, args))) = command else {
            return Err(
                "claims artifacts contain claim data only, never commands, rules or schedules"
                    .into(),
            );
        };
        let values = args
            .into_iter()
            .map(|arg| match arg {
                Expr::Lit(_, Literal::String(value)) => Ok(value.to_string()),
                _ => Err(format!(
                    "every argument of ({name} ...) must be a quoted string literal"
                )),
            })
            .collect::<Result<Vec<_>, _>>()?;
        atoms.push((name.to_string(), values));
    }
    Ok(atoms)
}

/// One atom checked against the published vocabulary.
fn row(name: &str, values: &[String]) -> Result<Row, String> {
    let shape = vocabulary::returned(name).ok_or_else(|| {
        format!(
            "unknown row ({name} ...); the vocabulary publishes {}",
            vocabulary::RETURNED
                .iter()
                .map(|r| r.name)
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;
    if values.len() != shape.arity() {
        return Err(format!(
            "({name} ...) takes {} columns ({}), got {}: {}",
            shape.arity(),
            shape.columns.join(", "),
            values.len(),
            atom(name, values)
        ));
    }
    let get = |index: usize| values[index].clone();
    match name {
        "claim" => {
            expect(&get(4), vocabulary::MODALITIES, "modality", name, values)?;
            expect(&get(5), vocabulary::EXPECTATIONS, "expected", name, values)?;
            let relation = get(2);
            if !vocabulary::relations().contains(relation.as_str()) {
                return Err(format!(
                    "unknown relation {relation:?} in {}",
                    atom(name, values)
                ));
            }
            Ok(Row::Claim {
                facet: get(0),
                subject: get(1),
                relation,
                object: get(3),
                modality: get(4),
                expected: get(5),
            })
        }
        "property" => {
            let property = get(2);
            if !vocabulary::boolean_properties().contains(property.as_str()) {
                return Err(format!(
                    "unknown boolean property {property:?} in {}",
                    atom(name, values)
                ));
            }
            expect(&get(3), vocabulary::EXPECTATIONS, "value", name, values)?;
            Ok(Row::Property {
                facet: get(0),
                subject: get(1),
                property,
                value: get(3),
            })
        }
        "measure" => {
            let property = get(2);
            if !vocabulary::numeric_properties().contains(property.as_str()) {
                return Err(format!(
                    "unknown numeric property {property:?} in {}",
                    atom(name, values)
                ));
            }
            let number =
                number(&get(3), &property).map_err(|e| format!("{e} in {}", atom(name, values)))?;
            Ok(Row::Measure {
                facet: get(0),
                subject: get(1),
                property,
                number: number.to_string(),
            })
        }
        "reading" => {
            expect(
                &get(1),
                vocabulary::READING_OUTCOMES,
                "outcome",
                name,
                values,
            )?;
            Ok(Row::Reading {
                facet: get(0),
                outcome: get(1),
            })
        }
        _ => unreachable!("vocabulary::returned admitted an unhandled row"),
    }
}

/// Numbers follow the compiler's ontology bounds: finite, non-negative, within
/// exact integer range, and risk no greater than one.
fn number(value: &str, property: &str) -> Result<f64, String> {
    let parsed: f64 = value
        .parse()
        .map_err(|_| format!("{value:?} is not a number"))?;
    if !parsed.is_finite() {
        return Err(format!("{value:?} is not finite"));
    }
    if parsed < 0.0 {
        return Err(format!("{value:?} is negative"));
    }
    if parsed > 9_007_199_254_740_991.0 {
        return Err(format!("{value:?} exceeds the exact integer range"));
    }
    if property == "risk" && parsed > 1.0 {
        return Err(format!("risk {value:?} is greater than one"));
    }
    Ok(parsed)
}

fn expect(
    value: &str,
    allowed: &[&str],
    column: &str,
    name: &str,
    values: &[String],
) -> Result<(), String> {
    if allowed.contains(&value) {
        return Ok(());
    }
    Err(format!(
        "{column} {value:?} is not one of {} in {}",
        allowed.join(", "),
        atom(name, values)
    ))
}

/// The offending atom, written back the way it was read, so a message names it.
fn atom(name: &str, values: &[String]) -> String {
    let rendered: Vec<String> = values.iter().map(|v| format!("{v:?}")).collect();
    format!("({name} {})", rendered.join(" "))
}
