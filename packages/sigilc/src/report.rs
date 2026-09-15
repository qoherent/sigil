//! Presentation of native findings; never a second semantic evaluator.
use crate::{
    comparison::Comparison,
    design::{DesignReport, SourceStatus},
    eqval::DesignWorld,
    frontend::{DesignInput, Range},
    implementation::ImplementationReport,
    store::Freshness,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const MAX_FINDINGS: usize = 1000;
const MAX_LOCATIONS: usize = 8;

// @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::NativeFindings interface,constraints
pub fn unavailable_comparison() -> Diagnostics {
    Diagnostics {
        items: vec![Finding {
            code: "COMPARISON_UNAVAILABLE".into(),
            side: "implementation",
            severity: "warning",
            message: "Current Design catalog unavailable; reconstruct current Design before comparing Implementation.".into(),
            locations: Vec::new(),
            omitted_locations: 0,
            witness: None,
        }],
        omitted: 0,
        frontend: Vec::new(),
    }
}

#[derive(Debug, Serialize, Default)]
pub struct Diagnostics {
    pub items: Vec<Finding>,
    pub omitted: usize,
    /// Complete frontend diagnostics retain stages and related source evidence.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub frontend: Vec<crate::frontend::Diagnostic>,
}
#[derive(Debug, Serialize)]
pub struct Location {
    pub side: &'static str,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
    pub coordinate_system: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_range: Option<crate::frontend::ImplementationRange>,
}
#[derive(Debug, Serialize)]
pub struct Finding {
    pub code: String,
    pub side: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub locations: Vec<Location>,
    pub omitted_locations: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub witness: Option<Witness>,
}
#[derive(Debug, Default, Serialize)]
pub struct Witness {
    pub table: &'static str,
    pub row: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obligation: Option<Vec<Value>>,
    pub because: Vec<Vec<Value>>,
    pub omitted_because: usize,
}

impl Diagnostics {
    fn take<'a, T>(&mut self, rows: &'a [T]) -> &'a [T] {
        let count = rows.len().min(MAX_FINDINGS - self.items.len());
        self.omitted += rows.len() - count;
        &rows[..count]
    }
    fn push(&mut self, finding: Finding) {
        if self.items.len() < MAX_FINDINGS {
            self.items.push(finding);
        } else {
            self.omitted += 1;
        }
    }
}

struct Locations<'a> {
    input: &'a DesignInput,
    design: &'a BTreeMap<String, Vec<String>>,
    implementation: Option<&'a BTreeMap<String, Vec<String>>>,
}
impl Locations<'_> {
    fn resolve(&self, references: &[Value]) -> (Vec<Location>, usize) {
        // Physical ranges belong only to authored units. A file-only witness
        // does not claim a corresponding Implementation line or declaration.
        let mut rows = BTreeMap::new();
        for reference in references.iter().filter_map(Value::as_str) {
            if let Some(unit) = self.input.units.iter().find(|u| u.id == reference) {
                rows.insert(
                    (
                        "design",
                        unit.source.clone(),
                        Some(unit.range.start),
                        Some(unit.range.end),
                    ),
                    Location {
                        side: "design",
                        source: unit.source.clone(),
                        range: Some(unit.range.clone()),
                        coordinate_system: "utf8-bytes",
                        source_digest: source_digest(self.input, &unit.source),
                        implementation_range: None,
                    },
                );
            } else if let Some(entity) = self.input.entities.iter().find(|e| e.id == reference) {
                rows.insert(
                    ("design", entity.source.clone(), None, None),
                    Location {
                        side: "design",
                        source: entity.source.clone(),
                        range: None,
                        coordinate_system: "utf8-bytes",
                        source_digest: source_digest(self.input, &entity.source),
                        implementation_range: None,
                    },
                );
            }
            for (side, map) in [
                ("design", Some(self.design)),
                ("implementation", self.implementation),
            ] {
                for source in map.and_then(|m| m.get(reference)).into_iter().flatten() {
                    rows.insert(
                        (side, source.clone(), None, None),
                        Location {
                            side,
                            source: source.clone(),
                            range: None,
                            coordinate_system: if side == "design" {
                                "utf8-bytes"
                            } else {
                                "utf16-lines"
                            },
                            source_digest: if side == "design" {
                                source_digest(self.input, source)
                            } else {
                                None
                            },
                            implementation_range: None,
                        },
                    );
                }
            }
        }
        // Prefer an exact range to a redundant file-only location on that side.
        let ranged: BTreeSet<_> = rows
            .values()
            .filter(|l| l.range.is_some())
            .map(|l| (l.side, l.source.clone()))
            .collect();
        let rows: Vec<_> = rows
            .into_values()
            .filter(|l| l.range.is_some() || !ranged.contains(&(l.side, l.source.clone())))
            .collect();
        let omitted = rows.len().saturating_sub(MAX_LOCATIONS);
        (rows.into_iter().take(MAX_LOCATIONS).collect(), omitted)
    }
    fn finding(
        &self,
        side: &'static str,
        severity: &'static str,
        code: &str,
        message: String,
        witness: Witness,
    ) -> Finding {
        let mut references = witness.row.clone();
        references.extend(witness.obligation.iter().flatten().cloned());
        references.extend(witness.because.iter().flatten().cloned());
        let (locations, omitted_locations) = self.resolve(&references);
        Finding {
            code: code.into(),
            side,
            severity,
            message,
            locations,
            omitted_locations,
            witness: Some(witness),
        }
    }
}

fn source_findings(result: &mut Diagnostics, side: &'static str, sources: &[SourceStatus]) {
    let sources: Vec<_> = sources
        .iter()
        .filter(|s| s.status != Freshness::Fresh)
        .collect();
    for source in result.take(&sources) {
        let status = serde_json::to_value(&source.status).expect("freshness serializes");
        result.push(Finding {
            code: "SOURCE_NOT_FRESH".into(),
            side,
            severity: "warning",
            message: format!(
                "{side} projection is {}: {}",
                status.as_str().unwrap_or("unavailable"),
                source.source
            ),
            locations: vec![Location {
                side,
                source: source.source.clone(),
                range: None,
                coordinate_system: if side == "design" {
                    "utf8-bytes"
                } else {
                    "utf16-lines"
                },
                source_digest: None,
                implementation_range: None,
            }],
            omitted_locations: 0,
            witness: None,
        });
    }
}
/*
 *
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::NativeFindings interface,constraints
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::Attribution interface,cases
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::Bounds interface,cases
 */
pub fn design(
    input: &DesignInput,
    world: &DesignWorld,
    sources: &[SourceStatus],
    assertion_sources: &BTreeMap<String, Vec<String>>,
) -> Diagnostics {
    let locations = Locations {
        input,
        design: assertion_sources,
        implementation: None,
    };
    let mut result = Diagnostics::default();
    for row in result.take(&world.closure.tables["violation"]) {
        result.push(locations.finding(
            "design",
            "error",
            "DESIGN_CONTRADICTION",
            format!("Design contradiction: {}", row[0]),
            Witness {
                table: "violation",
                row: row.clone(),
                obligation: None,
                ..Witness::default()
            },
        ));
    }
    source_findings(&mut result, "design", sources);
    for row in result.take(&world.closure.tables["design-unresolved"]) {
        result.push(locations.finding(
            "design",
            "warning",
            "DESIGN_UNRESOLVED",
            format!(
                "Unresolved Design requirement: {} {} {}",
                row[1], row[2], row[3]
            ),
            Witness {
                table: "design-unresolved",
                row: row.clone(),
                obligation: None,
                ..Witness::default()
            },
        ));
    }
    result.frontend = input
        .diagnostics
        .iter()
        .take(MAX_FINDINGS)
        .cloned()
        .collect();
    for diagnostic in result.take(&input.diagnostics) {
        result.push(Finding {
            code: diagnostic.code.clone(),
            side: "design",
            severity: match diagnostic.severity {
                crate::frontend::Severity::Error => "error",
                crate::frontend::Severity::Warning => "warning",
                crate::frontend::Severity::Info => "info",
            },
            message: diagnostic.message.clone(),
            locations: diagnostic
                .file_path
                .iter()
                .map(|source| Location {
                    side: "design",
                    source: source.clone(),
                    range: diagnostic.range.clone(),
                    coordinate_system: if diagnostic.implementation_range.is_some() {
                        "utf16-lines"
                    } else {
                        "utf8-bytes"
                    },
                    source_digest: source_digest(input, source)
                        .or_else(|| diagnostic.source_digest.clone()),
                    implementation_range: diagnostic.implementation_range.clone(),
                })
                .collect(),
            omitted_locations: 0,
            witness: None,
        });
    }
    result
}
/*
 *
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::NativeFindings interface,constraints
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::Attribution interface,cases
 * @sigil implements packages/sigilc/report.sigil::SigilGateDiagnostics::Bounds interface,cases
 */
pub fn implementation(
    input: &DesignInput,
    design: &DesignReport,
    implementation: &ImplementationReport,
    comparison: &Comparison,
) -> Diagnostics {
    let locations = Locations {
        input,
        design: &design.assertion_sources,
        implementation: Some(&implementation.assertion_sources),
    };
    let mut result = Diagnostics::default();
    for row in result.take(&comparison.implementation_contradictions) {
        result.push(locations.finding(
            "implementation",
            "error",
            "IMPLEMENTATION_CONTRADICTION",
            format!("Implementation contradiction: {}", row[0]),
            Witness {
                table: "violation",
                row: row.clone(),
                obligation: None,
                ..Witness::default()
            },
        ));
    }
    for row in result.take(&comparison.disagreements) {
        let obligation = row[0]
            .as_str()
            .and_then(|id| comparison.obligations.get(id))
            .cloned();
        let mut witness = Witness {
            table: "disagreement",
            row: row.clone(),
            obligation,
            ..Witness::default()
        };
        if let Some(obligation) = &witness.obligation
            && obligation.len() == 6
        {
            for because in &implementation.world.tables["because"] {
                let relevant = if obligation[2] == "multiple-owners" {
                    because[1] == "owns" && because[2] == obligation[1]
                } else {
                    because[..3] == obligation[1..4]
                };
                if relevant {
                    if witness.because.len() < 8 {
                        witness.because.push(because.clone());
                    } else {
                        witness.omitted_because += 1;
                    }
                }
            }
        }
        result.push(locations.finding(
            "implementation",
            "error",
            "IMPLEMENTATION_DISAGREEMENT",
            format!("Implementation disagrees with Design: {}", row[1]),
            witness,
        ));
    }
    source_findings(&mut result, "implementation", &implementation.sources);
    for id in result.take(&comparison.unresolved) {
        result.push(locations.finding(
            "implementation",
            "warning",
            "IMPLEMENTATION_UNRESOLVED",
            format!("Implementation does not establish Design obligation {id}"),
            Witness {
                table: "unresolved",
                row: vec![Value::String(id.clone())],
                obligation: comparison.obligations.get(id).cloned(),
                ..Witness::default()
            },
        ));
    }
    result
}

fn source_digest(input: &DesignInput, source: &str) -> Option<String> {
    use sha2::{Digest, Sha256};
    let text = input
        .sources
        .iter()
        .find(|s| s.path == source)
        .map(|s| s.text.as_str())
        .or_else(|| {
            input
                .context
                .iter()
                .find(|c| c.path == source)
                .and_then(|c| c.text.as_deref())
        })?;
    Some(
        Sha256::digest(text.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}
