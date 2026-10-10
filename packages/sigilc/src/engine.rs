//! Shared bounded egglog execution and data encoding.
use egglog::{EGraph, Term, ast::Literal};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Instant;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_input_assertions: usize,
    pub max_rows: usize,
    pub max_iterations: usize,
    pub max_elapsed_ms: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_assertions: 100_000,
            max_rows: 1_000_000,
            max_iterations: 10_000,
            max_elapsed_ms: 60_000,
        }
    }
}

pub(crate) fn fixedpoint(
    graph: &mut EGraph,
    limits: Limits,
    started: Instant,
) -> Result<usize, String> {
    let mut iterations = 0;
    for ruleset in ["closure", "diagnostics"] {
        loop {
            check_limits(graph, limits, started)?;
            if iterations >= limits.max_iterations {
                return Err("closure iteration limit exceeded".into());
            }
            iterations += 1;
            let report = graph.step_rules(ruleset).map_err(|e| e.to_string())?;
            check_limits(graph, limits, started)?;
            if !report.updated {
                break;
            }
        }
    }
    Ok(iterations)
}

pub(crate) fn rows(
    graph: &EGraph,
    name: &str,
    arity: usize,
    limits: Limits,
) -> Result<Vec<Vec<Value>>, String> {
    let (terms, _, dag) = graph
        .function_to_dag(name, limits.max_rows.saturating_add(1), false)
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for term in terms {
        let Term::App(_, children) = dag.get(term) else {
            return Err("invalid native row".into());
        };
        if children.len() != arity {
            return Err(format!("invalid native {name} arity"));
        }
        rows.push(
            children
                .iter()
                .map(|id| match dag.get(*id) {
                    Term::Lit(Literal::String(s)) => Ok(json!(s)),
                    Term::Lit(Literal::Float(n)) if n.0.is_finite() => Ok(json!(n.0)),
                    _ => Err("invalid native scalar".to_string()),
                })
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    rows.sort_by_cached_key(|row| serde_json::to_string(row).expect("scalar rows"));
    Ok(rows)
}

pub(crate) fn check_limits(graph: &EGraph, limits: Limits, started: Instant) -> Result<(), String> {
    if graph.num_tuples() > limits.max_rows {
        return Err("closure row limit exceeded".into());
    }
    if started.elapsed().as_millis() >= u128::from(limits.max_elapsed_ms) {
        return Err("closure elapsed limit exceeded".into());
    }
    Ok(())
}

/// Egglog accepts four escapes; JSON's additional \r/\u escapes are invalid here.
pub fn quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\t', "\\t")
    )
}
