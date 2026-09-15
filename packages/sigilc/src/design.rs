//! Current Design assembly; external reconstruction enters only through ingest.
use crate::{
    catalog::{self, DesignIdentities, FrozenCatalog},
    eqval::{self, DesignState, DesignWorld, Limits},
    frontend::{EntityType, Severity},
    inputs::DesignSnapshot,
    sources::hash,
    store::{Freshness, LockedStore},
    turtle::{Assertion, ONTOLOGY, Object, RDF_TYPE, XSD},
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub struct SourceStatus {
    pub source: String,
    pub status: Freshness,
}

#[derive(Debug, Serialize)]
pub struct DesignReport {
    pub version: u32,
    pub interpretation_limit: &'static str,
    pub input_fingerprint: String,
    pub design_fingerprint: String,
    pub all_fresh: bool,
    pub intentional_empty: bool,
    pub sources: Vec<SourceStatus>,
    pub assertion_sources: BTreeMap<String, Vec<String>>,
    pub diagnostics: crate::report::Diagnostics,
    pub world: DesignWorld,
    pub catalog: Option<FrozenCatalog>,
}

pub fn inspect(
    snapshot: &DesignSnapshot,
    store: &LockedStore,
) -> Result<Vec<SourceStatus>, String> {
    let mut rows = snapshot
        .input()
        .sources
        .iter()
        .map(|source| {
            Ok(SourceStatus {
                source: source.path.clone(),
                status: store.inspect(&snapshot.binding(&source.path)?)?.status,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let selected = snapshot
        .input()
        .sources
        .iter()
        .map(|s| s.path.as_str())
        .collect();
    rows.extend(
        store
            .deleted_sources("design", &selected)?
            .into_iter()
            .map(|source| SourceStatus {
                source,
                status: Freshness::Deleted,
            }),
    );
    rows.sort_by(|a, b| a.source.cmp(&b.source));
    Ok(rows)
}

// @sigil implements packages/sigilc/store.sigil::SigilProjectionStore::CurrentDesign interface
pub fn compile(
    snapshot: &DesignSnapshot,
    store: &LockedStore,
    limits: Limits,
    allow_empty: bool,
) -> Result<DesignReport, String> {
    valid_frontend(snapshot)?;
    let input = snapshot.input();
    if input.sources.is_empty() && !allow_empty {
        return Err("empty Design selection requires explicit allow-empty".into());
    }
    let mut assertion_count = input.entities.len().saturating_mul(2);
    if assertion_count > limits.max_input_assertions
        || input.units.len() > limits.max_input_assertions
    {
        return Err("structural Design input limit exceeded".into());
    }
    let mut projections = BTreeMap::new();
    let mut sources = Vec::new();
    for source in &input.sources {
        let binding = snapshot.binding(&source.path)?;
        let inspection = store.inspect(&binding)?;
        if inspection.status == Freshness::Fresh {
            assertion_count = assertion_count.saturating_add(inspection.assertions.len());
            if assertion_count > limits.max_input_assertions {
                return Err("aggregate Design assertion limit exceeded".into());
            }
            catalog::validate_design(&source.path, input, &inspection.assertions)?;
            projections.insert(source.path.clone(), inspection.assertions);
        }
        sources.push(SourceStatus {
            source: source.path.clone(),
            status: inspection.status,
        });
    }
    sources.sort_by(|a, b| a.source.cmp(&b.source));
    let all_fresh = sources.iter().all(|s| s.status == Freshness::Fresh);
    let identities = if all_fresh {
        Some(DesignIdentities::collect(input, &projections)?)
    } else {
        None
    };
    let mut assertion_sources: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (source, facts) in &projections {
        for fact in facts {
            assertion_sources
                .entry(fact.id())
                .or_default()
                .push(source.clone());
        }
    }
    let mut assertions: Vec<_> = projections.values().flatten().cloned().collect();
    for entity in &input.entities {
        let kind = match entity.kind {
            EntityType::Component => "Component",
            EntityType::Tag => "Tag",
        };
        assertions.push(Assertion {
            subject: entity.id.clone(),
            predicate: RDF_TYPE.into(),
            object: Object::Iri {
                value: format!("{ONTOLOGY}{kind}"),
            },
        });
        assertions.push(Assertion {
            subject: entity.id.clone(),
            predicate: format!("{ONTOLOGY}label"),
            object: Object::Literal {
                value: entity.label.clone(),
                datatype: format!("{XSD}string"),
                language: String::new(),
            },
        });
    }
    let units = input
        .units
        .iter()
        .map(|u| {
            Ok([
                u.id.clone(),
                u.owner
                    .clone()
                    .ok_or_else(|| format!("unresolved authored owner: {}", u.id))?,
            ])
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut world = eqval::design(&assertions, &units, limits)?;
    world.structure =
        Some(input.structural_records(&input.sources.iter().map(|s| s.path.clone()).collect()));
    if !all_fresh && world.state == DesignState::Coherent {
        world.state = DesignState::Loose;
    }
    let input_fingerprint = snapshot.fingerprint()?;
    let design_fingerprint = hash(
        &serde_json::to_vec(&(
            "sigil-design-world-v2",
            &input_fingerprint,
            &projections,
            &world.closure.kernel_fingerprint,
        ))
        .map_err(|e| e.to_string())?,
    );
    let catalog = if world.state != DesignState::Disjoint {
        identities
            .map(|ids| ids.freeze(world.state, design_fingerprint.clone(), true))
            .transpose()?
    } else {
        None
    };
    let diagnostics = crate::report::design(input, &world, &sources, &assertion_sources);
    Ok(DesignReport {
        version: 2,
        interpretation_limit: "Authored-unit coverage does not prove faithful interpretation of every sentence.",
        input_fingerprint,
        design_fingerprint,
        all_fresh,
        intentional_empty: input.sources.is_empty(),
        sources,
        assertion_sources,
        diagnostics,
        world,
        catalog,
    })
}

pub fn valid_frontend(snapshot: &DesignSnapshot) -> Result<(), String> {
    if let Some(error) = snapshot
        .input()
        .diagnostics
        .iter()
        .find(|d| matches!(d.severity, Severity::Error))
    {
        return Err(format!("frontend error {}: {}", error.code, error.message));
    }
    let input = snapshot.input();
    if input
        .entities
        .iter()
        .any(|e| !e.valid || !e.complete || !e.identity_resolved)
        || input
            .units
            .iter()
            .any(|u| !u.valid || !u.complete || u.owner.is_none())
        || input.groups.iter().any(|g| !g.valid || !g.complete)
        || input
            .introductions
            .iter()
            .any(|i| !i.valid || !i.complete || i.tag.is_none())
        || input.references.iter().any(|r| r.tag.is_none())
        || input.imports.iter().any(|i| {
            !i.valid
                || !i.complete
                || i.status != crate::frontend::ImportStatus::Resolved
                || i.names
                    .iter()
                    .any(|n| n.status != crate::frontend::SelectionStatus::Resolved)
        })
    {
        return Err("frontend contains unresolved or incomplete language structure".into());
    }
    Ok(())
}
