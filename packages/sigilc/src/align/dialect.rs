//! Strict data-only code readings. Nothing supplied here is evaluated.
use super::vocabulary;
pub use crate::claims::dialect::Limits;
use serde::{Deserialize, Serialize};

/// Element names remain file-local; admitted design references become IDs.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Row {
    Element {
        name: String,
        kind: String,
    },
    Realizes {
        element: String,
        design_name: String,
    },
    Act {
        element: String,
        relation: String,
        design_name: String,
    },
    Measure {
        element: String,
        measure_name: String,
        number: String,
    },
}

impl Row {
    pub fn element(&self) -> &str {
        match self {
            Self::Element { name, .. } => name,
            Self::Realizes { element, .. }
            | Self::Act { element, .. }
            | Self::Measure { element, .. } => element,
        }
    }

    /// Stored rows enter through admission too; deserialization alone proves
    /// their enum shape, not their vocabulary or numeric grammar.
    pub fn validate(&self) -> Result<(), String> {
        if self.element().trim().is_empty() {
            return Err("code row requires a nonempty local element name".into());
        }
        match self {
            Self::Element { kind, .. } => expect(kind, vocabulary::ELEMENT_KINDS, "element kind"),
            Self::Act { relation, .. } => {
                expect(relation, vocabulary::RELATIONS, "action relation")
            }
            Self::Measure {
                measure_name,
                number,
                ..
            } => {
                expect(measure_name, vocabulary::MEASURES, "measure name")?;
                numeric(measure_name, number).map(|_| ())
            }
            Self::Realizes { .. } => Ok(()),
        }
    }

    pub fn design_name(&self) -> Option<&str> {
        match self {
            Self::Realizes { design_name, .. } | Self::Act { design_name, .. } => Some(design_name),
            _ => None,
        }
    }
}

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::FileReadings interface,constraints
pub fn parse(source: &str, limits: Limits) -> Result<Vec<Row>, String> {
    crate::claims::dialect::literal_calls(source, limits)?
        .into_iter()
        .map(|(name, args)| {
            let arity = match name.as_str() {
                "element" | "realizes" => 2,
                "act" | "measure" => 3,
                _ => {
                    return Err(format!(
                        "unknown code row {name:?}; the vocabulary publishes {}",
                        vocabulary::RETURNED.join(", ")
                    ));
                }
            };
            if args.len() != arity {
                return Err(format!(
                    "({name} ...) takes {arity} columns, got {}",
                    args.len()
                ));
            }
            let get = |i: usize| args[i].clone();
            if get(0).trim().is_empty() {
                return Err(format!(
                    "({name} ...) requires a nonempty local element name"
                ));
            }
            match name.as_str() {
                "element" => {
                    expect(&get(1), vocabulary::ELEMENT_KINDS, "element kind")?;
                    Ok(Row::Element {
                        name: get(0),
                        kind: get(1),
                    })
                }
                "realizes" => Ok(Row::Realizes {
                    element: get(0),
                    design_name: get(1),
                }),
                "act" => {
                    expect(&get(1), vocabulary::RELATIONS, "action relation")?;
                    Ok(Row::Act {
                        element: get(0),
                        relation: get(1),
                        design_name: get(2),
                    })
                }
                "measure" => {
                    expect(&get(1), vocabulary::MEASURES, "measure name")?;
                    let number = numeric(&get(1), &get(2))?;
                    Ok(Row::Measure {
                        element: get(0),
                        measure_name: get(1),
                        number: number.to_string(),
                    })
                }
                _ => unreachable!(),
            }
        })
        .collect()
}

fn expect(value: &str, allowed: &[&str], column: &str) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "{column} {value:?} is not one of {}",
            allowed.join(", ")
        ))
    }
}

fn numeric(measure: &str, raw: &str) -> Result<f64, String> {
    let number: f64 = raw
        .parse()
        .map_err(|_| format!("{raw:?} is not a number"))?;
    if !number.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&number) {
        return Err(format!(
            "{raw:?} must be finite, nonnegative and within the exact integer range"
        ));
    }
    if measure != "latencyMs" && number.fract() != 0.0 {
        return Err(format!("{measure} is measured in whole days"));
    }
    Ok(number)
}
