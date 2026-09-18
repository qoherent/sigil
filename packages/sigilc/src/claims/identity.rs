//! Mint identities, admit entities, and decide grounding.
//!
//! Identity is the tool's alone: the interpreter names entities the design
//! already declares and never coins one. Grounding asks a narrower question
//! than admission does — admission asks whether an entity exists in the
//! design's closure, grounding asks whether *this Facet* could have been
//! talking about it.
use super::{dialect::Row, prepare::Request};
use crate::{
    frontend::{DesignInput, ReferenceStatus},
    sources,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// A defect a row carries without being refused.
///
/// Both stop the row from satisfying its unit, and both are reported, but
/// neither is a reason to discard the interpretation: a reader needs to see
/// what the model actually said.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Defect {
    /// Subject and object are the same entity.
    Degenerate,
    /// The named entity could not have come from this Facet.
    Ungrounded(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Body {
    Claim {
        subject: String,
        relation: String,
        object: String,
        modality: String,
        expected: String,
    },
    Property {
        subject: String,
        property: String,
        value: String,
    },
    Measure {
        subject: String,
        property: String,
        number: String,
    },
    Reading {
        outcome: String,
    },
}

/// An accepted fact: tool-minted identity, tool-filled role, resolved entities.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub id: String,
    pub facet: String,
    pub component: String,
    /// Filled from the export, never from anything the interpreter returned.
    pub section: String,
    pub body: Body,
    pub defects: Vec<Defect>,
}

impl Fact {
    fn mint(facet: &str, component: &str, section: &str, body: &Body) -> String {
        sources::hash(
            &serde_json::to_vec(&("sigil-claim-v1", facet, component, section, body))
                .expect("claim serialization"),
        )
    }

    /// Whether this fact can count as an interpretation of its Facet.
    pub fn satisfies_unit(&self) -> bool {
        self.defects.is_empty()
    }
}

/// Entity names a Facet could legitimately be talking about.
struct Grounding {
    /// Facet identity to the entities reachable from that Facet.
    per_facet: BTreeMap<String, BTreeSet<String>>,
}

impl Grounding {
    /// Built from what the export already resolved, not from matching names
    /// against prose. The resolver has already done the hard part.
    fn build(input: &DesignInput, request: &Request) -> Self {
        // Provider components of each source, through its resolved imports.
        let mut providers: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        for import in &input.imports {
            if let Some(id) = &import.provider_id {
                providers
                    .entry(import.source.as_str())
                    .or_default()
                    .insert(id.clone());
            }
        }

        let mut per_facet: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for row in &request.rows {
            let mut set = BTreeSet::new();
            // The Facet's own component. Without this, a claim relating a
            // component to its own capability reads as ungrounded, which is
            // what a Goal Facet almost always says.
            set.insert(row.component.clone());
            if let Some(from_source) = providers.get(row.source.as_str()) {
                set.extend(from_source.iter().cloned());
            }
            per_facet.insert(row.facet.clone(), set);
        }

        // Tags the resolver attached to this Facet. An ambiguous reference is
        // not grounding evidence: the resolver could not say what it names.
        for reference in &input.references {
            if reference.status == ReferenceStatus::Resolved
                && let Some(tag) = reference.tag.as_ref()
                && let Some(set) = per_facet.get_mut(reference.facet.as_str())
            {
                set.insert(tag.clone());
            }
        }
        for introduction in &input.introductions {
            if let Some(tag) = introduction.tag.as_ref()
                && let Some(facet) = introduction.facet.as_ref()
                && let Some(set) = per_facet.get_mut(facet.as_str())
            {
                set.insert(tag.clone());
            }
        }
        Self { per_facet }
    }

    fn grounds(&self, facet: &str, entity: &str) -> bool {
        self.per_facet
            .get(facet)
            .is_some_and(|set| set.contains(entity))
    }
}

/// Admit rows against the design, minting identity and filling the role.
///
/// Refuses the artifact when a row speaks about a Facet the request did not ask
/// about, or names an entity the design does not declare in the recorded
/// closure. Degenerate and ungrounded rows are accepted and flagged, because
/// they are findings a reader has to see rather than transport errors.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ReturnedClaims interface,constraints,cases
pub fn admit(request: &Request, input: &DesignInput, rows: &[Row]) -> Result<Vec<Fact>, String> {
    let roles: BTreeMap<&str, (&str, &str)> = request
        .rows
        .iter()
        .map(|r| (r.facet.as_str(), (r.component.as_str(), r.section.as_str())))
        .collect();
    let names = EntityNames::build(request);
    let grounding = Grounding::build(input, request);

    let mut facts = Vec::new();
    for row in rows {
        let facet = row.facet();
        let (component, section) = *roles.get(facet).ok_or_else(|| {
            format!(
                "row ({} ...) names {facet:?}, which this request did not ask about",
                row.relation_name()
            )
        })?;

        let mut defects = Vec::new();
        let body = match row {
            Row::Claim {
                subject,
                relation,
                object,
                modality,
                expected,
                ..
            } => {
                let subject = names.resolve(subject)?;
                let object = names.resolve(object)?;
                if subject == object {
                    defects.push(Defect::Degenerate);
                }
                for named in [&subject, &object] {
                    if !grounding.grounds(facet, named) {
                        defects.push(Defect::Ungrounded(named.clone()));
                    }
                }
                Body::Claim {
                    subject,
                    relation: relation.clone(),
                    object,
                    modality: modality.clone(),
                    expected: expected.clone(),
                }
            }
            Row::Property {
                subject,
                property,
                value,
                ..
            } => {
                let subject = names.resolve(subject)?;
                if !grounding.grounds(facet, &subject) {
                    defects.push(Defect::Ungrounded(subject.clone()));
                }
                Body::Property {
                    subject,
                    property: property.clone(),
                    value: value.clone(),
                }
            }
            Row::Measure {
                subject,
                property,
                number,
                ..
            } => {
                let subject = names.resolve(subject)?;
                if !grounding.grounds(facet, &subject) {
                    defects.push(Defect::Ungrounded(subject.clone()));
                }
                Body::Measure {
                    subject,
                    property: property.clone(),
                    number: number.clone(),
                }
            }
            Row::Reading { outcome, .. } => Body::Reading {
                outcome: outcome.clone(),
            },
        };

        defects.sort();
        defects.dedup();
        facts.push(Fact {
            id: Fact::mint(facet, component, section, &body),
            facet: facet.to_owned(),
            component: component.to_owned(),
            section: section.to_owned(),
            body,
            defects,
        });
    }
    facts.sort();
    facts.dedup();
    Ok(facts)
}

/// Entity names a claim may use, and what they resolve to.
///
/// The interpreter reads labels, so labels are accepted and resolved to the
/// identity the frontend minted. An exact identity is accepted too. Nothing
/// else is: an unknown name is either an entity outside the closure or one the
/// interpreter coined, and both are refused.
struct EntityNames {
    by_id: BTreeSet<String>,
    by_label: BTreeMap<String, Option<String>>,
}

impl EntityNames {
    fn build(request: &Request) -> Self {
        let mut by_id = BTreeSet::new();
        let mut by_label: BTreeMap<String, Option<String>> = BTreeMap::new();
        for entity in &request.entities {
            by_id.insert(entity.id.clone());
            by_label
                .entry(entity.label.clone())
                // A label shared by two entities in one closure cannot be
                // resolved, so it is recorded as ambiguous rather than guessed.
                .and_modify(|slot| *slot = None)
                .or_insert_with(|| Some(entity.id.clone()));
        }
        Self { by_id, by_label }
    }

    fn resolve(&self, raw: &str) -> Result<String, String> {
        if self.by_id.contains(raw) {
            return Ok(raw.to_owned());
        }
        match self.by_label.get(raw) {
            Some(Some(id)) => Ok(id.clone()),
            Some(None) => Err(format!(
                "{raw:?} names more than one entity in this design's closure"
            )),
            None => Err(format!(
                "{raw:?} is not an entity this design declares in the selected closure"
            )),
        }
    }
}

/// Contract roles that declared a Facet but drew no interpreted row at all.
///
/// A Facet the interpreter read and recorded a reading for is interpreted; one
/// that produced nothing is the gap R15 reports. Degenerate and ungrounded rows
/// do not count, which is what makes them fail to satisfy their unit.
pub fn uninterpreted(request: &Request, facts: &[Fact]) -> Vec<(String, String)> {
    let satisfied: BTreeSet<&str> = facts
        .iter()
        .filter(|f| f.satisfies_unit())
        .map(|f| f.facet.as_str())
        .collect();
    let mut gaps = BTreeSet::new();
    for row in &request.rows {
        if !satisfied.contains(row.facet.as_str()) {
            gaps.insert((row.component.clone(), row.section.clone()));
        }
    }
    // A role stays covered when any of its Facets was interpreted; the gap is
    // reported per role, as R15 words it, not per Facet.
    let covered: BTreeSet<(String, String)> = request
        .rows
        .iter()
        .filter(|r| satisfied.contains(r.facet.as_str()))
        .map(|r| (r.component.clone(), r.section.clone()))
        .collect();
    gaps.retain(|gap| !covered.contains(gap));
    gaps.into_iter().collect()
}
