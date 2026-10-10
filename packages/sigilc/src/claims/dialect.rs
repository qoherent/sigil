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
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    /// Declares a step of its Facet's Logic section. The ordinal is the step's
    /// number within its own Facet as written, and its position across the
    /// section once [`super::canon`] has resolved it.
    Step {
        facet: String,
        ordinal: u32,
    },
    /// A guard a step applies, comparing it against one operand. The step is a
    /// step reference, `step:K` or `step:#N.K` as written and `step:N` once
    /// resolved.
    Guard {
        facet: String,
        step: String,
        operand: String,
        value: String,
    },
    /// The step that ends its Facet's flow, as written. Resolving turns it into
    /// an edge from that step to the graph.
    End {
        facet: String,
        ordinal: u32,
    },
    /// A name the Facet's prose relies on that its list does not carry.
    Undeclared {
        facet: String,
        name: String,
    },
}

impl Row {
    pub fn facet(&self) -> &str {
        match self {
            Row::Claim { facet, .. }
            | Row::Property { facet, .. }
            | Row::Measure { facet, .. }
            | Row::Reading { facet, .. }
            | Row::Step { facet, .. }
            | Row::Guard { facet, .. }
            | Row::End { facet, .. }
            | Row::Undeclared { facet, .. } => facet,
        }
    }

    /// The same row about another Facet.
    pub fn with_facet(&self, facet: String) -> Row {
        let mut row = self.clone();
        match &mut row {
            Row::Claim { facet: slot, .. }
            | Row::Property { facet: slot, .. }
            | Row::Measure { facet: slot, .. }
            | Row::Reading { facet: slot, .. }
            | Row::Step { facet: slot, .. }
            | Row::Guard { facet: slot, .. }
            | Row::End { facet: slot, .. }
            | Row::Undeclared { facet: slot, .. } => *slot = facet,
        }
        row
    }

    pub fn relation_name(&self) -> &'static str {
        match self {
            Row::Claim { .. } => "claim",
            Row::Property { .. } => "property",
            Row::Measure { .. } => "measure",
            Row::Reading { .. } => "reading",
            Row::Step { .. } => "step",
            Row::Guard { .. } => "guard",
            Row::End { .. } => "end",
            Row::Undeclared { .. } => "undeclared",
        }
    }
}

/// A row the reader could not accept, with the Facet it was about.
///
/// The Facet is the row's first argument as written, which may be a handle, a
/// full id, or nothing at all. It is how a refusal finds the unit it belongs to.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowError {
    pub facet: String,
    pub row: String,
    pub reason: String,
}

/// What an artifact held: the rows that read cleanly and the rows that did not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub rows: Vec<Row>,
    pub errors: Vec<RowError>,
}

/// Read an artifact, refusing the whole document when it holds anything that is
/// not data, and setting aside a row that is data but wrong.
///
/// A rule, command, schedule, nested expression or unreadable text refuses the
/// whole artifact: an artifact that supplies a law is not a partly usable
/// interpretation, and keeping the valid rows beside it would make the refusal
/// advisory. A row that is plain data but names the wrong thing is a mistake in
/// one unit, so it is reported and the other rows are kept.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ReturnedClaims interface,constraints,cases
pub fn read(source: &str, limits: Limits) -> Result<Parsed, String> {
    if source.len() > limits.max_document_bytes {
        return Err(format!(
            "claims artifact exceeds byte limit: {} > {}",
            source.len(),
            limits.max_document_bytes
        ));
    }
    if matches!(source.trim_start().chars().next(), Some('[' | '{')) {
        return Err(
            "a claims artifact is plain egglog rows, one per line, and not JSON: \
                    write each row as (claim \"#1\" ...) with nothing around it"
                .into(),
        );
    }
    refuse_deep_nesting(source)?;
    let atoms = atoms(source, limits)?;
    let mut parsed = Parsed::default();
    for (name, values) in atoms {
        match row(&name, &values) {
            Ok(row) => parsed.rows.push(row),
            Err(reason) => parsed.errors.push(RowError {
                facet: values.first().map(Arg::text).unwrap_or_default(),
                row: render(&name, &values),
                reason,
            }),
        }
    }
    Ok(parsed)
}

/// Read an artifact into rows, refusing it on any defect at all.
///
/// The strict form of [`read`], for a caller that has no way to set a row
/// aside.
pub fn parse(source: &str, limits: Limits) -> Result<Vec<Row>, String> {
    let parsed = read(source, limits)?;
    match parsed.errors.into_iter().next() {
        Some(error) => Err(error.reason),
        None => Ok(parsed.rows),
    }
}

/// The shared data-only transport, without either side's row vocabulary.
/// Callers admit the flat string columns against their own published shapes.
pub fn literal_calls(source: &str, limits: Limits) -> Result<Vec<(String, Vec<String>)>, String> {
    if source.len() > limits.max_document_bytes {
        return Err(format!(
            "claims artifact exceeds byte limit: {} > {}",
            source.len(),
            limits.max_document_bytes
        ));
    }
    refuse_deep_nesting(source)?;
    atoms(source, limits)?.into_iter().map(|(name, args)| {
        let values = args.into_iter().map(|arg| match arg {
            Arg::Text(value) => Ok(value),
            Arg::Other(value) => Err(format!("every argument of ({name} ...) must be a quoted string literal; {value} is not")),
        }).collect::<Result<Vec<_>, _>>()?;
        Ok((name, values))
    }).collect()
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

/// One argument of a call atom: a quoted string, or a literal of another kind.
///
/// A bare number is data in the wrong form, which is a mistake in one row. It
/// is carried here so that row can be reported, while anything that is not a
/// literal at all still refuses the artifact.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Arg {
    Text(String),
    Other(String),
}

impl Arg {
    fn text(&self) -> String {
        match self {
            Arg::Text(value) | Arg::Other(value) => value.clone(),
        }
    }
}

/// Every call atom in the artifact, with its literal arguments.
///
/// Refuses anything that is not a call whose arguments are all literals: a
/// rule, a ruleset, a command, a schedule or a nested expression.
fn atoms(source: &str, limits: Limits) -> Result<Vec<(String, Vec<Arg>)>, String> {
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
                Expr::Lit(_, Literal::String(value)) => Ok(Arg::Text(value.to_string())),
                Expr::Lit(_, other) => Ok(Arg::Other(other.to_string())),
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
fn row(name: &str, args: &[Arg]) -> Result<Row, String> {
    let values: Vec<String> = args.iter().map(Arg::text).collect();
    let values = values.as_slice();
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
    if let Some(Arg::Other(value)) = args.iter().find(|a| matches!(a, Arg::Other(_))) {
        return Err(format!(
            "every argument of ({name} ...) must be a quoted string literal; {value} is not, in {}",
            render(name, args)
        ));
    }
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
            // A claim about a step is a fact the prose states, not a
            // commitment with a modality: a step either reads a state or it
            // does not. Fixing the pair keeps flow facts out of the laws that
            // fire on disagreeing expectations, while still populating `holds`
            // so the step laws can read them.
            let (subject, object) = (get(1), get(3));
            for operand in [&subject, &object] {
                if operand == vocabulary::GRAPH_REF {
                    return Err(format!(
                        "{operand:?} is not a name a claim may use; mark where a flow ends with \
                         (end \"<facet>\" \"<step>\") in {}",
                        atom(name, values)
                    ));
                }
            }
            if vocabulary::is_flow_ref(&subject) || vocabulary::is_flow_ref(&object) {
                if get(4) != "required" || get(5) != "true" {
                    return Err(format!(
                        "a claim about a step is required and expected to hold; \
                         got {:?}/{:?} in {}",
                        get(4),
                        get(5),
                        atom(name, values)
                    ));
                }
                for operand in [&subject, &object] {
                    if operand.starts_with(vocabulary::STEP_REF)
                        && vocabulary::local_step_ref(operand).is_none()
                    {
                        return Err(format!(
                            "{operand:?} is not a step reference (step:K, or step:#N.K for \
                             another Facet) in {}",
                            atom(name, values)
                        ));
                    }
                }
            }
            Ok(Row::Claim {
                facet: get(0),
                subject,
                relation,
                object,
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
        "step" => Ok(Row::Step {
            facet: get(0),
            ordinal: local_ordinal(&get(1), "a step's ordinal", name, values)?,
        }),
        "end" => Ok(Row::End {
            facet: get(0),
            ordinal: local_ordinal(
                &get(1),
                "the ordinal of the step a flow ends at",
                name,
                values,
            )?,
        }),
        "guard" => {
            expect(&get(2), vocabulary::GUARD_OPERANDS, "operand", name, values)?;
            let step = get(1);
            if vocabulary::local_step_ref(&step).is_none() {
                return Err(format!(
                    "a guard names its step as step:K, or step:#N.K for another Facet; got {step:?} in {}",
                    atom(name, values)
                ));
            }
            Ok(Row::Guard {
                facet: get(0),
                step,
                operand: get(2),
                value: get(3),
            })
        }
        "undeclared" => {
            let named = get(1);
            if named.trim().is_empty() {
                return Err(format!(
                    "an undeclared row names the thing the prose relies on; got an empty name in {}",
                    atom(name, values)
                ));
            }
            Ok(Row::Undeclared {
                facet: get(0),
                name: named,
            })
        }
        _ => unreachable!("vocabulary::returned admitted an unhandled row"),
    }
}

/// A step's number within its Facet, counting from 1.
fn local_ordinal(value: &str, what: &str, name: &str, values: &[String]) -> Result<u32, String> {
    vocabulary::positive(value).ok_or_else(|| {
        format!(
            "{what} is its position within its own Facet, counting from 1; got {value:?} in {}",
            atom(name, values)
        )
    })
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

/// The offending atom as it was written, a bare literal left unquoted.
fn render(name: &str, args: &[Arg]) -> String {
    let rendered: Vec<String> = args
        .iter()
        .map(|arg| match arg {
            Arg::Text(value) => format!("{value:?}"),
            Arg::Other(value) => value.clone(),
        })
        .collect();
    format!("({name} {})", rendered.join(" "))
}

/// A row written back the way it is read, so a refusal can name it.
pub fn render_row(row: &Row) -> String {
    let quoted = |values: &[&str]| -> String {
        values
            .iter()
            .map(|value| format!("{value:?}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let name = row.relation_name();
    let columns = match row {
        Row::Claim {
            facet,
            subject,
            relation,
            object,
            modality,
            expected,
        } => quoted(&[facet, subject, relation, object, modality, expected]),
        Row::Property {
            facet,
            subject,
            property,
            value,
        } => quoted(&[facet, subject, property, value]),
        Row::Measure {
            facet,
            subject,
            property,
            number,
        } => quoted(&[facet, subject, property, number]),
        Row::Reading { facet, outcome } => quoted(&[facet, outcome]),
        Row::Step { facet, ordinal } | Row::End { facet, ordinal } => {
            quoted(&[facet, &ordinal.to_string()])
        }
        Row::Guard {
            facet,
            step,
            operand,
            value,
        } => quoted(&[facet, step, operand, value]),
        Row::Undeclared { facet, name } => quoted(&[facet, name]),
    };
    format!("({name} {columns})")
}
