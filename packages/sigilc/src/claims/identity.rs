//! Mint identities, admit entities, and decide grounding.
//!
//! Identity is the tool's alone: the interpreter names entities the design
//! already declares and never coins one. Grounding asks a narrower question
//! than admission does — admission asks whether an entity exists in the
//! design's closure, grounding asks whether *this Facet* could have been
//! talking about it.
use super::{
    dialect::Row,
    prepare::{FacetRow, Request},
    vocabulary,
};
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
    /// A declared step of its Facet's Logic section.
    Step {
        ordinal: u32,
    },
    /// A guard a step applies.
    Guard {
        step: u32,
        operand: String,
        value: String,
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

/// The flow entities one artifact declares, minted before anything resolves.
///
/// Built in a pass of its own because a reference resolves across Facets: an
/// edge may run from a step in one paragraph to a step in another, and the
/// ordinal it names is positioned across the whole section. Nothing can be
/// resolved until every step in the section has an identity.
struct Flow {
    /// Owning component to ordinal to minted step identity.
    steps: BTreeMap<String, BTreeMap<u32, String>>,
    /// Owning component to minted graph identity.
    graphs: BTreeMap<String, String>,
    /// Every identity minted here, for the grounding carve-out below.
    minted: BTreeSet<String>,
}

impl Flow {
    fn build(rows: &[Row], roles: &BTreeMap<&str, (&str, &str)>) -> Result<Self, String> {
        let mut flow = Self {
            steps: BTreeMap::new(),
            graphs: BTreeMap::new(),
            minted: BTreeSet::new(),
        };
        // Which Facet claimed each ordinal, so a collision can name both.
        let mut claimed: BTreeMap<(String, u32), String> = BTreeMap::new();
        for row in rows {
            let Row::Step { facet, ordinal } = row else {
                continue;
            };
            let Some((component, section)) = roles.get(facet.as_str()) else {
                continue; // the main loop refuses this, with a better message
            };
            if *section != "logic" {
                return Err(format!(
                    "(step {facet:?} {ordinal}) declares a step in a {section} Facet;                      a flow is Logic prose"
                ));
            }
            // An ordinal runs across the whole section, so a collision between
            // two Facets of one section is the case worth catching: without
            // uniqueness a bare ordinal does not resolve to one identity.
            if let Some(first) = claimed.insert(((*component).to_owned(), *ordinal), facet.clone())
            {
                return Err(format!(
                    "two steps of one Logic section both claim ordinal {ordinal}:                      {first:?} and {facet:?}. An ordinal is that step's position across                      the section, so it names exactly one step"
                ));
            }
            let id = Fact::mint(facet, component, section, &Body::Step { ordinal: *ordinal });
            flow.minted.insert(id.clone());
            flow.steps
                .entry((*component).to_owned())
                .or_default()
                .insert(*ordinal, id);
        }
        for component in flow.steps.keys() {
            let id = sources::hash(
                &serde_json::to_vec(&("sigil-flow-graph-v1", component, "logic"))
                    .expect("graph identity serialization"),
            );
            flow.minted.insert(id.clone());
            flow.graphs.insert(component.clone(), id);
        }
        Ok(flow)
    }

    /// Resolve a reference the interpretation wrote to a minted identity.
    fn resolve(&self, name: &str, component: &str) -> Result<String, String> {
        if name == vocabulary::GRAPH_REF {
            return self.graphs.get(component).cloned().ok_or_else(|| {
                format!("{name:?} names the flow of a section that declares no step")
            });
        }
        let ordinal = vocabulary::step_ordinal(name)
            .ok_or_else(|| format!("{name:?} is not a step ordinal"))?;
        self.steps
            .get(component)
            .and_then(|byord| byord.get(&ordinal))
            .cloned()
            .ok_or_else(|| {
                format!(
                    "{name:?} names a step this section never declares;                      a row pointing at an undeclared step would read as a dead end"
                )
            })
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
    let flow = Flow::build(rows, &roles)?;

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
                // A step or a graph reference resolves through the flow pass,
                // never through entity-name lookup: that lookup refuses an
                // unknown name by refusing the whole artifact, so routing a
                // reference through it unchanged would reject every flow.
                let flow_subject = vocabulary::is_flow_ref(subject);
                let flow_object = vocabulary::is_flow_ref(object);
                let subject = if flow_subject {
                    flow.resolve(subject, component)?
                } else {
                    names.resolve(subject)?
                };
                let object = if flow_object {
                    flow.resolve(object, component)?
                } else {
                    names.resolve(object)?
                };

                // Same subject and object is a claim that asserts nothing --
                // unless both are steps, in which case it is an edge from a
                // step to itself, an ordinary loop. Flagging a loop would
                // suppress its whole graph's reachability check under the
                // defect rule, and do it without erroring.
                if subject == object && !(flow_subject && flow_object) {
                    defects.push(Defect::Degenerate);
                }

                // Grounding asks whether the entity a row names could have come
                // from the Facet naming it. A minted step or graph could only
                // have come from here, so it grounds by construction; checking
                // it against the export's references would flag every flow
                // claim and, again, silently switch the graph's check off.
                for named in [&subject, &object] {
                    if !flow.minted.contains(named) && !grounding.grounds(facet, named) {
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
            // U2 owns minting a Step entity from this row and grounding what
            // refers to it. Admitted unchanged here so the crate compiles with
            // the row kinds registered and the admission still to come.
            Row::Step { ordinal, .. } => {
                // Resolving proves the section declared it, which Flow::build
                // has already checked; this keeps the body beside its identity.
                flow.resolve(&format!("{}{ordinal}", vocabulary::STEP_REF), component)?;
                Body::Step { ordinal: *ordinal }
            }
            Row::Guard {
                step,
                operand,
                value,
                ..
            } => {
                flow.resolve(&format!("{}{step}", vocabulary::STEP_REF), component)?;
                let value = match operand.as_str() {
                    // A state operand is a declared entity and grounds like
                    // any other. An input is a literal and never resolves. A
                    // constraint names a Facet, which the request already
                    // bounds, so it is checked against that rather than
                    // against the entity set.
                    "state" => {
                        let resolved = names.resolve(value)?;
                        if !grounding.grounds(facet, &resolved) {
                            defects.push(Defect::Ungrounded(resolved.clone()));
                        }
                        resolved
                    }
                    "constraint" => {
                        if !roles.contains_key(value.as_str()) {
                            return Err(format!(
                                "a guard names the Constraints Facet it guards on;                                  {value:?} is not a Facet this request presented"
                            ));
                        }
                        value.clone()
                    }
                    _ => value.clone(),
                };
                Body::Guard {
                    step: *step,
                    operand: operand.clone(),
                    value,
                }
            }
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
    // Coverage is the selected source's alone. The request presents the whole
    // resolved closure so a claim in one component can be checked against a
    // flow graph in a component it depends on, but a dependency's Facet is
    // context the interpreter was given, never a gap this report names.
    // Without this line a run answering only its own source reports a gap for
    // every role in every dependency -- 56 of them on `pipeline.sigil`.
    let own = |row: &&FacetRow| row.source == request.binding.source;

    let mut gaps = BTreeSet::new();
    for row in request.rows.iter().filter(own) {
        if !satisfied.contains(row.facet.as_str()) {
            gaps.insert((row.component.clone(), row.section.clone()));
        }
    }
    // A role stays covered when any of its Facets was interpreted; the gap is
    // reported per role, as R15 words it, not per Facet.
    let covered: BTreeSet<(String, String)> = request
        .rows
        .iter()
        .filter(own)
        .filter(|r| satisfied.contains(r.facet.as_str()))
        .map(|r| (r.component.clone(), r.section.clone()))
        .collect();
    gaps.retain(|gap| !covered.contains(gap));
    gaps.into_iter().collect()
}
