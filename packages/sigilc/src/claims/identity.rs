//! Mint identities, admit entities, and decide grounding.
//!
//! Identity is the tool's alone: the interpreter names entities the design
//! already declares and never coins one. Grounding asks a narrower question
//! than admission does — admission asks whether an entity exists in the
//! request's entity list, grounding asks whether *this Facet* could have been
//! talking about it.
use super::{
    canon::Issue,
    dialect::{Row, render_row},
    prepare::{FacetRow, Request},
    vocabulary,
};
use crate::{
    sources,
    structure::{DesignInput, ImportStatus, ReferenceStatus},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// A defect a row carries without being refused.
///
/// It stops the row from satisfying its unit and is reported, but it is not a
/// reason to discard the interpretation: a reader needs to see what the model
/// actually said. A name outside the Facet's list is not one of these. It
/// refuses the unit, so the unit is asked again.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Defect {
    /// Subject and object are the same entity.
    Degenerate,
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
    /// A name the Facet's prose relies on that its list does not carry. It
    /// reaches no law: it is reported as a warning about the design.
    Undeclared {
        /// The name as the prose writes it.
        name: String,
        /// The design entity of that name when the design declares one the Facet
        /// does not reference, which is a missing reference rather than a
        /// missing Tag.
        declared: Option<String>,
    },
}

/// An accepted fact: tool-minted identity, tool-filled role, resolved entities.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub id: String,
    pub facet: String,
    pub component: String,
    /// Filled from the workspace, never from anything the interpreter returned.
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
pub(super) struct Grounding {
    /// Facet identity to the entities reachable from that Facet.
    per_facet: BTreeMap<String, BTreeSet<String>>,
}

impl Grounding {
    /// Built from what the trees already resolved, not from matching names
    /// against prose. The resolver has already done the hard part.
    ///
    /// This set is what a request publishes as each Facet's list and what
    /// admission checks a row against, so the two cannot disagree.
    pub(super) fn build(input: &DesignInput, rows: &[FacetRow]) -> Self {
        // Provider components of each source, through its resolved imports.
        let mut providers: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        for import in &input.imports {
            if import.status == ImportStatus::Resolved
                && let Some(id) = &import.provider_id
            {
                providers
                    .entry(import.source.as_str())
                    .or_default()
                    .insert(id.clone());
            }
        }

        let mut per_facet: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for row in rows {
            let mut set = BTreeSet::new();
            // The Facet's own component. Without this, a claim relating a
            // component to its own capability would be refused, which is what
            // a Goal Facet almost always says.
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

    /// The entity ids a Facet may name.
    pub(super) fn allowed(&self, facet: &str) -> Option<&BTreeSet<String>> {
        self.per_facet.get(facet)
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
}

impl Flow {
    fn build(rows: &[Row], roles: &BTreeMap<&str, (&str, &str)>) -> (Self, Vec<Issue>) {
        let mut flow = Self {
            steps: BTreeMap::new(),
            graphs: BTreeMap::new(),
        };
        let mut issues = Vec::new();
        // Which Facet claimed each ordinal, so a collision can name both.
        let mut claimed: BTreeMap<(String, u32), String> = BTreeMap::new();
        for row in rows {
            let Row::Step { facet, ordinal } = row else {
                continue;
            };
            let Some((component, section)) = roles.get(facet.as_str()) else {
                continue; // the row loop refuses this, with a better message
            };
            if *section != "logic" {
                issues.push(Issue {
                    facet: Some(facet.clone()),
                    row: render_row(row),
                    reason: format!("declares a step in a {section} Facet; a flow is Logic prose"),
                });
                continue;
            }
            // An ordinal runs across the whole section, so a collision between
            // two Facets of one section is the case worth catching: without
            // uniqueness a bare ordinal does not resolve to one identity.
            if let Some(first) = claimed.insert(((*component).to_owned(), *ordinal), facet.clone())
            {
                issues.push(Issue {
                    facet: Some(facet.clone()),
                    row: render_row(row),
                    reason: format!(
                        "two steps of one Logic section both claim ordinal {ordinal}: {first:?} \
                         and {facet:?}. An ordinal is that step's position across the section, \
                         so it names exactly one step"
                    ),
                });
                continue;
            }
            let id = Fact::mint(facet, component, section, &Body::Step { ordinal: *ordinal });
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
            flow.graphs.insert(component.clone(), id);
        }
        (flow, issues)
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
                    "{name:?} names a step this section never declares; \
                     a row pointing at an undeclared step would read as a dead end"
                )
            })
    }
}

/// Admit rows against the design, minting identity and filling the role.
///
/// Refuses the rows when one speaks about a Facet the request did not ask
/// about, or names an entity its Facet's list does not carry. A degenerate row
/// is accepted and flagged, because it is a finding a reader has to see rather
/// than a transport error.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ReturnedClaims interface,constraints,cases
pub fn admit(request: &Request, input: &DesignInput, rows: &[Row]) -> Result<Vec<Fact>, String> {
    Admitter::new(request, input).admit(rows)
}

/// Everything admission reads, built once so it can be run over many sets of
/// rows. `prepare` runs it as a dry admission over each stored reading whose
/// grounding context moved; `ingest` runs it over the rows it keeps. It is the
/// same code both times, so a dry run cannot disagree with the real one.
pub struct Admitter<'a> {
    roles: BTreeMap<&'a str, (&'a str, &'a str)>,
    prose: BTreeMap<&'a str, &'a str>,
    names: EntityNames,
    labels: BTreeMap<&'a str, &'a str>,
    kinds: BTreeMap<&'a str, &'a str>,
    grounding: Grounding,
}

impl<'a> Admitter<'a> {
    pub fn new(request: &'a Request, input: &DesignInput) -> Self {
        Self {
            roles: request
                .rows
                .iter()
                .map(|r| (r.facet.as_str(), (r.component.as_str(), r.section.as_str())))
                .collect(),
            prose: request
                .rows
                .iter()
                .map(|r| (r.facet.as_str(), r.prose.as_str()))
                .collect(),
            names: EntityNames::build(request),
            labels: request
                .entities
                .iter()
                .map(|e| (e.id.as_str(), e.label.as_str()))
                .collect(),
            kinds: request
                .entities
                .iter()
                .map(|e| (e.id.as_str(), e.kind.as_str()))
                .collect(),
            grounding: Grounding::build(input, &request.rows),
        }
    }

    /// Admit `rows`, refusing them on the first problem; see [`admit`].
    pub fn admit(&self, rows: &[Row]) -> Result<Vec<Fact>, String> {
        let (facts, issues) = self.admit_all(rows);
        match issues.into_iter().next() {
            Some(issue) => Err(issue.reason),
            None => Ok(facts),
        }
    }

    /// Admit every row that can be, and say what was wrong with the rest.
    ///
    /// The facts are those of the rows that admitted cleanly. A caller that
    /// refuses a unit on any issue discards them with it.
    pub fn admit_all(&self, rows: &[Row]) -> (Vec<Fact>, Vec<Issue>) {
        let (flow, mut issues) = Flow::build(rows, &self.roles);
        let mut facts = Vec::new();
        for row in rows {
            match self.admit_row(&flow, row) {
                Ok(fact) => facts.push(fact),
                Err(reason) => issues.push(Issue {
                    facet: Some(row.facet().to_owned()),
                    row: render_row(row),
                    reason,
                }),
            }
        }
        facts.sort();
        facts.dedup();
        issues.sort();
        issues.dedup();
        (facts, issues)
    }

    /// The ids on a Facet's own list that something called `raw` could mean:
    /// the id itself, or an entity with that label.
    fn on_list(&self, facet: &str, raw: &str) -> Vec<&String> {
        self.grounding
            .allowed(facet)
            .into_iter()
            .flatten()
            .filter(|id| id.as_str() == raw || self.labels.get(id.as_str()) == Some(&raw))
            .collect()
    }

    /// The entity a Facet's row names, from that Facet's own list.
    ///
    /// The list comes first so a label two entities of the design share still
    /// resolves for a Facet that can name only one of them.
    fn resolve_name(&self, facet: &str, raw: &str) -> Result<String, String> {
        match self.on_list(facet, raw).as_slice() {
            [one] => Ok((*one).clone()),
            [] => match self.names.resolve(raw) {
                Ok(_) => Err(format!(
                    "{raw:?} is declared in this design but is not on this Facet's list: a \
                     Facet may name its own component, the components its source imports from, \
                     and the Tags its prose references or introduces. If its prose relies on \
                     {raw:?}, say so with an (undeclared ...) row instead"
                )),
                Err(unknown) => Err(unknown),
            },
            _ => Err(format!(
                "{raw:?} names more than one entity on this Facet's list"
            )),
        }
    }

    fn admit_row(&self, flow: &Flow, row: &Row) -> Result<Fact, String> {
        let facet = row.facet();
        let (component, section) = *self.roles.get(facet).ok_or_else(|| {
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
                // unknown name, so routing a reference through it unchanged
                // would reject every flow.
                let flow_subject = vocabulary::is_flow_ref(subject);
                let flow_object = vocabulary::is_flow_ref(object);
                if (flow_subject || flow_object) && section != "logic" {
                    return Err(format!(
                        "a {section} Facet names a step; only a Logic Facet can"
                    ));
                }
                let subject = if flow_subject {
                    flow.resolve(subject, component)?
                } else {
                    self.resolve_name(facet, subject)?
                };
                let object = if flow_object {
                    flow.resolve(object, component)?
                } else {
                    self.resolve_name(facet, object)?
                };
                // Only a component, or a step for a flow, can require, provide,
                // own, depend on or exclude something. A Tag in that place
                // raises an obligation nothing can meet, or a ban that reaches
                // every step touching its object.
                if vocabulary::ACTOR_RELATIONS.contains(&relation.as_str())
                    && !flow_subject
                    && self.kinds.get(subject.as_str()) != Some(&"Component")
                {
                    return Err(format!(
                        "the subject of {relation:?} must be a component or a step, and \
                         {:?} is a Tag; if the rule only limits when or how, return a reading instead",
                        self.labels
                            .get(subject.as_str())
                            .copied()
                            .unwrap_or(&subject)
                    ));
                }

                // Same subject and object is a claim that asserts nothing --
                // unless both are steps, in which case it is an edge from a
                // step to itself, an ordinary loop. Flagging a loop would
                // suppress its whole graph's reachability check under the
                // defect rule, and do it without erroring.
                if subject == object && !(flow_subject && flow_object) {
                    defects.push(Defect::Degenerate);
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
            } => Body::Property {
                subject: self.resolve_name(facet, subject)?,
                property: property.clone(),
                value: value.clone(),
            },
            Row::Measure {
                subject,
                property,
                number,
                ..
            } => Body::Measure {
                subject: self.resolve_name(facet, subject)?,
                property: property.clone(),
                number: number.clone(),
            },
            Row::Reading { outcome, .. } => Body::Reading {
                outcome: outcome.clone(),
            },
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
                let ordinal = vocabulary::step_ordinal(step)
                    .ok_or_else(|| format!("{step:?} is not a resolved step"))?;
                flow.resolve(step, component)?;
                let value = match operand.as_str() {
                    // A state operand is a declared entity and resolves like
                    // any other. An input is a literal and never resolves. A
                    // constraint names a Facet, which the request already
                    // bounds, so it is checked against that rather than
                    // against the entity set.
                    "state" => self.resolve_name(facet, value)?,
                    "constraint" => {
                        if !self.roles.contains_key(value.as_str()) {
                            return Err(format!(
                                "a guard names the Constraints Facet it guards on; \
                                 {value:?} is not a Facet this request presented"
                            ));
                        }
                        value.clone()
                    }
                    _ => value.clone(),
                };
                Body::Guard {
                    step: ordinal,
                    operand: operand.clone(),
                    value,
                }
            }
            Row::End { .. } => {
                return Err("an end row is resolved into an edge before admission".into());
            }
            Row::Undeclared { name, .. } => {
                let prose = self.prose.get(facet).copied().unwrap_or_default();
                if !squash(prose).contains(&squash(name)) {
                    return Err(format!(
                        "the prose of this Facet does not contain {name:?}; an undeclared row \
                         names what the prose relies on, as the prose writes it"
                    ));
                }
                if !self.on_list(facet, name).is_empty() {
                    return Err(format!(
                        "{name:?} is on this Facet's list; state the claim it supports instead \
                         of calling it undeclared"
                    ));
                }
                Body::Undeclared {
                    name: name.clone(),
                    declared: self.names.resolve(name).ok(),
                }
            }
        };

        defects.sort();
        defects.dedup();
        Ok(Fact {
            id: Fact::mint(facet, component, section, &body),
            facet: facet.to_owned(),
            component: component.to_owned(),
            section: section.to_owned(),
            body,
            defects,
        })
    }
}

/// Text with every run of whitespace collapsed and its case folded, so a name
/// matches the prose wherever the prose wrapped the line.
fn squash(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Entity names a claim may use, and what they resolve to.
///
/// The interpreter reads labels, so labels are accepted and resolved to the
/// identity the reader minted. An exact identity is accepted too. Nothing
/// else is: an unknown name is either an entity outside the request or one the
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
                // A label shared by two entities in one request cannot be
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
                "{raw:?} names more than one entity in this request"
            )),
            None => Err(format!(
                "{raw:?} is not an entity this design declares in the presented request"
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
    // Coverage is the selected source's alone. Imported interface Facets are
    // presented as context so a claim can be read against the names they
    // expose, but they are never a gap this report names: their own source's
    // run owns them, and `uninterpreted_context` lists the ones it has not
    // read yet.
    let own = |row: &&FacetRow| !row.context;

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

/// Imported interface Facets no stored reading satisfies, as
/// `(component, Facet)` pairs.
///
/// These are context, not targets: this source's run never requests them, so
/// the report names them as uninterpreted context until their own source has
/// been prepared and ingested.
pub fn uninterpreted_context(request: &Request, facts: &[Fact]) -> Vec<(String, String)> {
    let satisfied: BTreeSet<&str> = facts
        .iter()
        .filter(|f| f.satisfies_unit())
        .map(|f| f.facet.as_str())
        .collect();
    request
        .rows
        .iter()
        .filter(|r| r.context && !satisfied.contains(r.facet.as_str()))
        .map(|r| (r.component.clone(), r.facet.clone()))
        .collect()
}
